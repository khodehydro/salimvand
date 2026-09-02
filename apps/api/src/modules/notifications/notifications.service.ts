import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

export type NotificationJob = {
  type: 'invoice.issued' | 'invoice.paid' | 'low-stock';
  invoiceId?: string;
  mobile?: string;
  message: string;
  testChannel?: Channel;
};
type Channel = 'sms' | 'telegram' | 'bale';

export const SMS_PROVIDER_NAME = 'sms.ir';
export const SMS_IR_BASE_URL = 'https://api.sms.ir';

export function integrationConfigured(
  channel: Channel,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // sms.ir bulk send: the panel API key (X-API-KEY) plus the store's
  // subscription line number. Without both, SMS stays disabled and the
  // invoice queue simply runs its other channels (telegram/bale) or dry-runs.
  if (channel === 'sms') return Boolean(env.SMS_API_KEY && env.SMS_LINE_NUMBER);
  if (channel === 'telegram') return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
  return Boolean(env.BALE_BOT_TOKEN && env.BALE_CHAT_ID);
}

/** POST target for one invoice SMS: the sms.ir «ارسال گروهی» endpoint. */
export function smsIrSendUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${env.SMS_IR_BASE_URL ?? SMS_IR_BASE_URL}/v1/send/bulk`;
}

/** Body of a single-recipient sms.ir bulk send (docs §ارسال گروهی). */
export function smsIrPayload(
  mobile: string,
  message: string,
  env: NodeJS.ProcessEnv = process.env,
): { lineNumber: number; messageText: string; mobiles: string[] } {
  return {
    lineNumber: Number(env.SMS_LINE_NUMBER),
    messageText: message,
    mobiles: [mobile],
  };
}

/** Uniform sms.ir response: `{ status, message, data }` — status 1 is success. */
export type SmsIrResponse = { status?: number; message?: string };

/** Human-readable failure text for the queue's failed list and sms_logs. */
export function smsIrFailure(response: Response, body: SmsIrResponse | null): string {
  if (response.status === 401) return 'sms.ir: کلید API نامعتبر است (401)';
  if (response.status === 429) return 'sms.ir: تعداد درخواست زیاد است (429)';
  const detail = body?.message?.trim();
  if (detail) return `sms.ir: ${detail}`;
  return `sms.ir: HTTP ${response.status}`;
}

export function integrationUrl(
  channel: Exclude<Channel, 'sms'>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (channel === 'telegram')
    return `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
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

export function notificationChannels(
  job: NotificationJob,
  env: NodeJS.ProcessEnv = process.env,
): Channel[] {
  const channels: Channel[] = [];
  if (
    job.mobile &&
    (!job.testChannel || job.testChannel === 'sms') &&
    integrationConfigured('sms', env)
  )
    channels.push('sms');
  for (const channel of ['telegram', 'bale'] as const) {
    if ((!job.testChannel || job.testChannel === channel) && integrationConfigured(channel, env))
      channels.push(channel);
  }
  return channels;
}

/** Replaces {placeholders} in an operator-defined SMS template; unknown keys stay untouched. */
export function renderSmsTemplate(
  template: string | null | undefined,
  vars: Record<string, string | number>,
): string {
  if (!template || !template.trim()) return '';
  return template
    .replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match))
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function buildInvoiceMessage(
  number: string,
  shortCode: string,
  total: string,
  paid = false,
  template?: string | null,
): string {
  const siteUrl = (process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir').replace(/\/$/, '');
  const link = `${siteUrl}/i/${shortCode}`;
  const rendered = renderSmsTemplate(template, {
    invoice_number: number,
    amount: total,
    link,
    store: 'سلیم‌وند',
  });
  if (rendered) return rendered;
  return paid
    ? `پرداخت فاکتور ${number} ثبت شد. مبلغ پرداختی: ${total} ریال\n${link}`
    : `فاکتور ${number} صادر شد. مبلغ: ${total} ریال\nمشاهده و دانلود: ${link}`;
}

/** Parses a Telegram/Bale bot message into a command and its argument. */
export function parseTelegramCommand(text: string | undefined): {
  command: string;
  argument: string;
} {
  const clean = (text ?? '').trim();
  const match = /^\/([a-zA-Z]+)(?:@\w+)?(?:\s+(.*))?$/s.exec(clean);
  if (!match) return { command: '', argument: clean };
  return { command: match[1].toLowerCase(), argument: (match[2] ?? '').trim() };
}

@Injectable()
export class NotificationsService implements OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queue: Queue<NotificationJob>;
  private readonly worker?: Worker<NotificationJob>;

  constructor(@Optional() private readonly prisma?: PrismaService) {
    this.connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    // An unreachable Redis must not take down the whole API via an unhandled
    // 'error' event on the shared connection. Log it and keep serving; the
    // queue simply stays degraded until Redis is available again.
    this.connection.on('error', (err) =>
      console.error('[notifications] redis connection error:', (err as Error)?.message ?? err),
    );
    this.queue = new Queue<NotificationJob>(NOTIFICATION_QUEUE_NAME, {
      connection: this.connection,
    });
    if (
      process.env.ENABLE_QUEUE_WORKER === 'true' &&
      !process.env.VITEST &&
      process.env.NODE_ENV !== 'test'
    ) {
      this.worker = new Worker<NotificationJob>(
        'salimvand-notifications',
        async (job) => this.process(job),
        { connection: this.connection, concurrency: 4 },
      );
    }
  }

  async enqueue(payload: NotificationJob) {
    // Notifications are strictly best-effort: a down or degraded Redis must
    // never bubble up and fail the business operation (invoice issue, payment
    // registration, ...) that queued the message. Log and move on.
    try {
      return await this.queue.add(
        payload.type as NotificationName,
        payload,
        notificationJobOptions,
      );
    } catch (error) {
      console.error(
        '[notifications] enqueue skipped (queue unavailable):',
        (error as Error)?.message ?? error,
      );
      return null;
    }
  }

  async enqueueTest(channel: Channel, message: string, mobile?: string) {
    if (!integrationConfigured(channel)) throw new Error('این provider پیکربندی نشده است');
    if (channel === 'sms' && !mobile) throw new Error('شماره موبایل برای تست SMS الزامی است');
    return this.enqueue({ type: 'low-stock', testChannel: channel, mobile, message });
  }

  async counts() {
    return this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  }

  async checkQueueConnection() {
    await this.connection.ping();
    return true;
  }

  async health() {
    const counts = await this.counts();
    return {
      channels: {
        sms: {
          configured: integrationConfigured('sms'),
          provider: integrationConfigured('sms') ? SMS_PROVIDER_NAME : null,
        },
        telegram: { configured: integrationConfigured('telegram'), provider: 'telegram' },
        bale: { configured: integrationConfigured('bale'), provider: 'bale' },
      },
      queue: counts,
    };
  }

  async failed(limit = 50) {
    const jobs = await this.queue.getFailed(0, normalizeFailedLimit(limit) - 1);
    return jobs.map((job) => ({
      id: job.id,
      name: job.name,
      type: job.data.type,
      mobile: maskNotificationMobile(job.data.mobile),
      failedReason: job.failedReason ?? 'خطای نامشخص',
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
    }));
  }

  async retry(id: string) {
    const job = await this.queue.getJob(id);
    if (!job) return false;
    await job.retry('failed');
    return true;
  }

  /** Delivery log for the panel; silently skipped when Prisma is not wired (unit tests). */
  private async logSms(job: NotificationJob, status: 'sent' | 'failed', error?: string) {
    if (!this.prisma?.smsLog?.create || !job.mobile) return;
    await this.prisma.smsLog
      .create({
        data: {
          mobile: job.mobile,
          template: job.type,
          message: job.message.slice(0, 1000),
          status,
          provider: SMS_PROVIDER_NAME,
          error: error?.slice(0, 500) ?? null,
          refType: job.invoiceId ? 'invoice' : null,
          refId: job.invoiceId ?? null,
          sentAt: status === 'sent' ? new Date() : null,
        },
      })
      .catch(() => undefined);
  }

  private async logChannel(
    channel: 'telegram' | 'bale',
    message: string,
    status: 'sent' | 'failed',
    error?: string,
  ) {
    if (!this.prisma?.telegramLog?.create) return;
    const chatId =
      (channel === 'telegram' ? process.env.TELEGRAM_CHAT_ID : process.env.BALE_CHAT_ID) ??
      'unknown';
    await this.prisma.telegramLog
      .create({
        data: {
          channel,
          chatId: chatId.slice(0, 60),
          message: message.slice(0, 2000),
          status,
          error: error?.slice(0, 500) ?? null,
        },
      })
      .catch(() => undefined);
  }

  async smsLogs(limit = 50) {
    if (!this.prisma?.smsLog?.findMany) return [];
    const rows = await this.prisma.smsLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: normalizeFailedLimit(limit),
    });
    return rows.map(
      (row: {
        id: bigint;
        mobile: string;
        template: string;
        status: string;
        provider: string | null;
        error: string | null;
        createdAt: Date;
      }) => ({
        id: String(row.id),
        mobile: maskNotificationMobile(row.mobile),
        template: row.template,
        status: row.status,
        provider: row.provider,
        error: row.error,
        createdAt: row.createdAt,
      }),
    );
  }

  async telegramLogs(limit = 50) {
    if (!this.prisma?.telegramLog?.findMany) return [];
    const rows = await this.prisma.telegramLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: normalizeFailedLimit(limit),
    });
    return rows.map(
      (row: {
        id: bigint;
        channel: string;
        status: string;
        message: string;
        error: string | null;
        createdAt: Date;
      }) => ({
        id: String(row.id),
        channel: row.channel,
        status: row.status,
        preview: row.message.slice(0, 80),
        error: row.error,
        createdAt: row.createdAt,
      }),
    );
  }

  /** Answers the bot commands listed in the architecture doc §6.2. */
  async answerCommand(text: string): Promise<string> {
    const { command, argument } = parseTelegramCommand(text);
    const read = this.prisma as unknown as
      | {
          inventoryItem?: {
            count: (args: unknown) => Promise<number>;
            aggregate?: (args: unknown) => Promise<{ _sum: { quantity: number | null } }>;
          };
          invoice?: {
            count: (args: unknown) => Promise<number>;
            aggregate: (args: unknown) => Promise<{ _sum: { total: bigint | null } }>;
          };
        }
      | undefined;
    if (!read) return 'پنل داده در دسترس نیست.';
    if (command === 'stock' || command === 'موجودی') {
      const count = await (read.inventoryItem?.count({ where: { isActive: true } }) ??
        Promise.resolve(0));
      return `اقلام فعال انبار: ${count}`;
    }
    if (command === 'low') {
      const count = await (read.inventoryItem?.count({
        where: { isActive: true, quantity: { lte: 0 } },
      }) ?? Promise.resolve(0));
      return `اقلام بدون موجودی: ${count}`;
    }
    if (command === 'sales') {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const result = await (read.invoice?.aggregate({
        where: { status: 'issued', issuedAt: { gte: from } },
        _sum: { total: true },
      }) ?? Promise.resolve({ _sum: { total: null } }));
      const count = await (read.invoice?.count({
        where: { status: 'issued', issuedAt: { gte: from } },
      }) ?? Promise.resolve(0));
      return `فروش امروز: ${count} فاکتور به مبلغ ${result._sum.total ?? 0} ریال`;
    }
    if (command === 'invoice') {
      const siteUrl = (process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir').replace(/\/$/, '');
      return argument
        ? `لینک فاکتور: ${siteUrl}/i/${argument}`
        : 'کد کوتاه فاکتور را بعد از /invoice بنویسید.';
    }
    return 'دستورهای موجود: /stock /low /sales /invoice <کد> /help';
  }

  private async process(job: Job<NotificationJob>) {
    // Each adapter fails the job on provider errors so BullMQ can retry it.
    let delivered = false;
    for (const channel of notificationChannels(job.data)) {
      if (channel === 'sms') {
        // sms.ir «ارسال گروهی» with a single recipient: the invoice SMS
        // carries a dynamic link, so the line-number bulk endpoint is used
        // (the Verify endpoint only accepts ≤25-char template parameters).
        // Failing the job lets BullMQ retry with backoff; sms.ir 401/429 get
        // a Persian reason so the failed list in the panel is readable.
        const response = await fetch(smsIrSendUrl(), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'x-api-key': process.env.SMS_API_KEY!,
          },
          body: JSON.stringify(smsIrPayload(job.data.mobile!, job.data.message)),
        });
        const body = (await response.json().catch(() => null)) as SmsIrResponse | null;
        if (!response.ok || body?.status !== 1) {
          const reason = smsIrFailure(response, body);
          await this.logSms(job.data, 'failed', reason);
          throw new Error(reason);
        }
        await this.logSms(job.data, 'sent');
        delivered = true;
        continue;
      }
      const chatId =
        channel === 'telegram' ? process.env.TELEGRAM_CHAT_ID! : process.env.BALE_CHAT_ID!;
      const response = await fetch(integrationUrl(channel), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: job.data.message,
          disable_web_page_preview: true,
        }),
      });
      if (!response.ok) {
        await this.logChannel(channel, job.data.message, 'failed', `provider ${response.status}`);
        throw new Error(`${channel} provider returned ${response.status}`);
      }
      await this.logChannel(channel, job.data.message, 'sent');
      delivered = true;
    }
    if (!delivered) console.info(`[notification:${job.data.type}] dry-run`);
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue.close();
    await this.connection.quit();
  }
}
