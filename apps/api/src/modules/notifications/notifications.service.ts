import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

export type NotificationJob = { type: 'invoice.issued' | 'invoice.paid' | 'low-stock'; invoiceId?: string; mobile?: string; message: string };
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
    // Provider adapters are isolated here. Without credentials, jobs remain observable and retryable.
    const endpoint = process.env.SMS_API_URL;
    if (!process.env.SMS_PROVIDER || !process.env.SMS_API_KEY || !endpoint || !job.data.mobile) {
      console.info(`[notification:${job.data.type}] ${job.data.message}`);
      return;
    }
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.SMS_API_KEY}` }, body: JSON.stringify({ to: job.data.mobile, message: job.data.message, provider: process.env.SMS_PROVIDER }) });
    if (!response.ok) throw new Error(`SMS provider returned ${response.status}`);
  }

  async onModuleDestroy() { await this.worker?.close(); await this.queue.close(); await this.connection.quit(); }
}
