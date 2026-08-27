import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

export type NotificationJob = { type: 'invoice.issued' | 'invoice.paid' | 'low-stock'; invoiceId?: string; mobile?: string; message: string; testChannel?: Channel };
type Channel = 'sms' | 'telegram' | 'bale';

export function integrationConfigured(channel: Channel, env: NodeJS.ProcessEnv = process.env): boolean {
  if (channel === 'sms') return Boolean(env.SMS_PROVIDER && env.SMS_API_KEY && env.SMS_API_URL);
  if (channel === 'telegram') return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
  return Boolean(env.BALE_BOT_TOKEN && env.BALE_CHAT_ID);
}

export function integrationUrl(channel: Exclude<Channel, 'sms'>, env: NodeJS.ProcessEnv = process.env): string {
  if (channel === 'telegram') return `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  return `https://tapi.bale.ai/bot${env.BALE_BOT_TOKEN}/sendMessage`;
}
type NotificationName = NotificationJob['type'];

export const NOTIFICATION_QUEUE_NAME = 'salimvand-notifications';
export const notificationJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

export function maskNotificationMobile(mobile: string | undefined): string | null {
  if (!mobile) return null;
  if (mobile.length <= 5) return `${mobile.slice(0, 1)}***`;
  return `${mobile.slice(0, 3)}***${mobile.slice(-2)}`;
}

export function normalizeFailedLimit(value: number): number {
  return Math.min(100, Math.max(1, Number.isFinite(value) ? Math.trunc(value) : 50));
}

export function notificationChannels(job: NotificationJob, env: NodeJS.ProcessEnv = process.env): Channel[] {
  const channels: Channel[] = [];
  if (job.mobile && (!job.testChannel || job.testChannel === 'sms') && integrationConfigured('sms', env)) channels.push('sms');
  for (const channel of ['telegram', 'bale'] as const) {
    if ((!job.testChannel || job.testChannel === channel) && integrationConfigured(channel, env)) channels.push(channel);
  }
  return channels;
}

export function buildInvoiceMessage(number: string, shortCode: string, total: string, paid = false): string {
  const siteUrl = (process.env.PUBLIC_SITE_URL ?? 'https://selimvand.ir').replace(/\/$/, '');
  return paid
    ? `پرداخت فاکتور ${number} ثبت شد. مبلغ پرداختی: ${total} ریال\n${siteUrl}/i/${shortCode}`
    : `فاکتور ${number} صادر شد. مبلغ: ${total} ریال\nمشاهده و دانلود: ${siteUrl}/i/${shortCode}`;
}

@Injectable()
export class NotificationsService implements OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queue: Queue<NotificationJob>;
  private readonly worker?: Worker<NotificationJob>;

  constructor() {
    this.connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null, lazyConnect: true });
    this.queue = new Queue<NotificationJob>(NOTIFICATION_QUEUE_NAME, { connection: this.connection });
    if (process.env.ENABLE_QUEUE_WORKER === 'true') {
      this.worker = new Worker<NotificationJob>('salimvand-notifications', async (job) => this.process(job), { connection: this.connection, concurrency: 4 });
    }
  }

  async enqueue(payload: NotificationJob) {
    return this.queue.add(payload.type as NotificationName, payload, notificationJobOptions);
  }

  async enqueueTest(channel: Channel, message: string, mobile?: string) {
    if (!integrationConfigured(channel)) throw new Error('این provider پیکربندی نشده است');
    if (channel === 'sms' && !mobile) throw new Error('شماره موبایل برای تست SMS الزامی است');
    return this.enqueue({ type: 'low-stock', testChannel: channel, mobile, message });
  }

  async counts() { return this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'); }

  async checkQueueConnection() {
    await this.connection.ping();
    return true;
  }

  async health() {
    const counts = await this.counts();
    return { channels: { sms: { configured: integrationConfigured('sms'), provider: process.env.SMS_PROVIDER ?? null }, telegram: { configured: integrationConfigured('telegram'), provider: 'telegram' }, bale: { configured: integrationConfigured('bale'), provider: 'bale' } }, queue: counts };
  }

  async failed(limit = 50) {
    const jobs = await this.queue.getFailed(0, normalizeFailedLimit(limit) - 1);
    return jobs.map((job) => ({ id: job.id, name: job.name, type: job.data.type, mobile: maskNotificationMobile(job.data.mobile), failedReason: job.failedReason ?? 'خطای نامشخص', attemptsMade: job.attemptsMade, timestamp: job.timestamp }));
  }

  async retry(id: string) {
    const job = await this.queue.getJob(id);
    if (!job) return false;
    await job.retry('failed');
    return true;
  }

  private async process(job: Job<NotificationJob>) {
    // Each adapter fails the job on provider errors so BullMQ can retry it.
    let delivered = false;
    for (const channel of notificationChannels(job.data)) {
      if (channel === 'sms') {
        const response = await fetch(process.env.SMS_API_URL!, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.SMS_API_KEY!}` }, body: JSON.stringify({ to: job.data.mobile, message: job.data.message, provider: process.env.SMS_PROVIDER }) });
        if (!response.ok) throw new Error(`SMS provider returned ${response.status}`);
        delivered = true;
        continue;
      }
      const chatId = channel === 'telegram' ? process.env.TELEGRAM_CHAT_ID! : process.env.BALE_CHAT_ID!;
      const response = await fetch(integrationUrl(channel), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: job.data.message, disable_web_page_preview: true }) });
      if (!response.ok) throw new Error(`${channel} provider returned ${response.status}`);
      delivered = true;
    }
    if (!delivered) console.info(`[notification:${job.data.type}] dry-run`);
  }

  async onModuleDestroy() { await this.worker?.close(); await this.queue.close(); await this.connection.quit(); }
}
