import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

export type NotificationJob = { type: 'invoice.issued' | 'invoice.paid' | 'low-stock'; invoiceId?: string; mobile?: string; message: string };
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
    this.queue = new Queue<NotificationJob>('salimvand-notifications', { connection: this.connection });
    if (process.env.ENABLE_QUEUE_WORKER === 'true') {
      this.worker = new Worker<NotificationJob>('salimvand-notifications', async (job) => this.process(job), { connection: this.connection, concurrency: 4 });
    }
  }

  async enqueue(payload: NotificationJob) {
    return this.queue.add(payload.type as NotificationName, payload, { attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 100, removeOnFail: 500 });
  }

  async counts() { return this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'); }

  async failed(limit = 50) {
    const jobs = await this.queue.getFailed(0, Math.min(100, Math.max(1, limit)) - 1);
    return jobs.map((job) => ({ id: job.id, name: job.name, type: job.data.type, mobile: job.data.mobile ? `${job.data.mobile.slice(0, 3)}***${job.data.mobile.slice(-2)}` : null, failedReason: job.failedReason ?? 'خطای نامشخص', attemptsMade: job.attemptsMade, timestamp: job.timestamp }));
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
    if (job.data.mobile && integrationConfigured('sms')) {
      const response = await fetch(process.env.SMS_API_URL!, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.SMS_API_KEY!}` }, body: JSON.stringify({ to: job.data.mobile, message: job.data.message, provider: process.env.SMS_PROVIDER }) });
      if (!response.ok) throw new Error(`SMS provider returned ${response.status}`);
      delivered = true;
    }
    for (const channel of ['telegram', 'bale'] as const) {
      if (!integrationConfigured(channel)) continue;
      const chatId = channel === 'telegram' ? process.env.TELEGRAM_CHAT_ID! : process.env.BALE_CHAT_ID!;
      const response = await fetch(integrationUrl(channel), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: job.data.message, disable_web_page_preview: true }) });
      if (!response.ok) throw new Error(`${channel} provider returned ${response.status}`);
      delivered = true;
    }
    if (!delivered) console.info(`[notification:${job.data.type}] dry-run`);
  }

  async onModuleDestroy() { await this.worker?.close(); await this.queue.close(); await this.connection.quit(); }
}
