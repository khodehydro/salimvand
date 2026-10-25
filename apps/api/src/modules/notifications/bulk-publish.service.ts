import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { setTimeout as sleep } from 'node:timers/promises';
import { PrismaService } from '../../prisma.service';
import { SocialPublisherService } from './social-publisher.service';
import { resolveMessagingEnv } from './messaging-config';
import { BulkPublishFilterDto, StartBulkPublishDto } from './bulk-publish.dto';
import {
  BULK_BATCH_DELAY_MS,
  BULK_BATCH_SIZE,
  BulkData,
  initialBulkProgress,
  runBulkPublish,
} from './bulk-publish.runner';

const QUEUE = 'salimvand-bulk-social';
const MAX_PRODUCTS = 20_000;
type BulkQueueData = Omit<BulkData, 'products'> & { total: number };
const snapshotKey = (id: string) => `${QUEUE}:snapshot:${id}`;

export function bulkProductWhere(filter: BulkPublishFilterDto): Prisma.ProductWhereInput {
  const groups: Prisma.ProductWhereInput[] = [];
  if (['vehicles', 'combined'].includes(filter.mode) && filter.vehicleModelIds?.length)
    groups.push({ compatibilities: { some: { modelId: { in: filter.vehicleModelIds } } } });
  if (['categories', 'combined'].includes(filter.mode) && filter.categoryIds?.length)
    groups.push({ categoryId: { in: filter.categoryIds } });
  if (['brands', 'combined'].includes(filter.mode) && filter.brandIds?.length)
    groups.push({ inventoryItems: { some: { isActive: true, brandId: { in: filter.brandIds } } } });
  if (filter.mode !== 'all' && !groups.length)
    throw new BadRequestException('حداقل یک مورد از گروه انتخاب‌شده را انتخاب کنید');
  if (filter.mode === 'combined' && groups.length < 2)
    throw new BadRequestException('برای ترکیب گروه‌ها حداقل دو نوع فیلتر را انتخاب کنید');
  const and: Prisma.ProductWhereInput[] = [];
  if (groups.length) and.push(filter.match === 'or' ? { OR: groups } : { AND: groups });
  if (filter.inStockOnly)
    and.push({ inventoryItems: { some: { isActive: true, quantity: { gt: 0 } } } });
  if (filter.withImageOnly) and.push({ images: { some: {} } });
  return { status: 'active', deletedAt: null, AND: and };
}

@Injectable()
export class BulkPublishService implements OnModuleInit, OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queue: Queue<BulkQueueData>;
  private worker?: Worker<BulkQueueData>;
  private starting = false;
  private closing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly social: SocialPublisherService,
  ) {
    // API operations fail fast during a Redis outage instead of hanging HTTP.
    this.connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      commandTimeout: 5000,
      enableOfflineQueue: false,
    });
    this.connection.on('error', () => console.warn('[bulk-social] Redis unavailable'));
    this.queue = new Queue<BulkQueueData>(QUEUE, { connection: this.connection });
    this.queue.on('error', () => console.warn('[bulk-social] Queue unavailable'));
    this.connection.on('ready', () => void this.startWorker());
  }

  async onModuleInit() {
    await this.startWorker();
  }

  private async startWorker() {
    if (
      this.worker ||
      this.starting ||
      this.closing ||
      process.env.ENABLE_QUEUE_WORKER !== 'true' ||
      process.env.VITEST ||
      process.env.NODE_ENV === 'test'
    )
      return;
    this.starting = true;
    try {
      // Across ALL worker processes: never render/send two bulk campaigns at once.
      await this.queue.setGlobalConcurrency(1);
      if (this.closing) return;
      this.worker = new Worker<BulkQueueData>(
        QUEUE,
        async (job) => {
          // A process can stop after saving final progress but before BullMQ
          // acknowledges completion. Such a recovery must not need the snapshot.
          if (['completed', 'cancelled'].includes(job.data.progress.status)) return;
          const snapshot = await this.connection.get(snapshotKey(job.id!));
          if (!snapshot) throw new Error('Campaign snapshot missing');
          const { products } = JSON.parse(snapshot) as BulkData;
          await runBulkPublish(
            {
              data: { ...job.data, products },
              updateData: async ({ products: _products, ...checkpoint }) => {
                // Never rewrite the full product-ID snapshot on each progress tick.
                await job.updateData({ ...checkpoint, total: job.data.total });
              },
            },
            {
              publish: async (id, platform) =>
                (await this.social.publishProduct(id, [platform]))[platform],
              eligible: async (id) => {
                const product = await this.prisma.product.findUnique({
                  where: { id },
                  select: { status: true, deletedAt: true },
                });
                return Boolean(product && product.status === 'active' && !product.deletedAt);
              },
              cancelled: async () =>
                Boolean(await this.connection.get(`${QUEUE}:cancel:${job.id}`)),
              sleep: async (ms) => {
                await sleep(ms);
              },
              now: Date.now,
            },
          );
          await this.connection.del(snapshotKey(job.id!));
        },
        {
          connection: {
            ...this.connection.options,
            maxRetriesPerRequest: null,
            commandTimeout: undefined,
            enableOfflineQueue: true,
          },
          concurrency: 1,
          maxStalledCount: 3,
        },
      );
      this.worker.on('error', () => console.warn('[bulk-social] Worker connection error'));
      this.worker.on('failed', (job) =>
        console.warn(`[bulk-social] Campaign ${job?.id} stopped; inspect the campaign status`),
      );
    } catch {
      console.warn('[bulk-social] Worker will start when Redis reconnects');
    } finally {
      this.starting = false;
    }
  }

  private async queueCall<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'صف انتشار در دسترس نیست؛ Redis و سرویس worker را بررسی کنید',
      );
    }
  }

  async preview(filters: BulkPublishFilterDto) {
    const count = await this.prisma.product.count({ where: bulkProductWhere(filters) });
    return {
      count,
      batches: Math.ceil(count / BULK_BATCH_SIZE),
      batchSize: BULK_BATCH_SIZE,
      batchDelaySeconds: BULK_BATCH_DELAY_MS / 1000,
    };
  }

  async start(input: StartBulkPublishDto) {
    return this.queueCall(async () => {
      const existing = await this.queue.getJob(input.requestId);
      if (existing) return this.view(existing);
      const env = await resolveMessagingEnv(this.prisma.setting);
      for (const platform of input.platforms) {
        const prefix = platform === 'telegram' ? 'TELEGRAM' : 'BALE';
        if (!env[`${prefix}_BOT_TOKEN`] || !env[`${prefix}_CHAT_ID`])
          throw new BadRequestException(
            `کانال ${platform === 'telegram' ? 'تلگرام' : 'بله'} پیکربندی نشده است`,
          );
      }
      if (!(await this.queue.getWorkers()).length)
        throw new ServiceUnavailableException(
          'worker انتشار فعال نیست؛ سرویس salimvand-worker را راه‌اندازی کنید',
        );
      const counts = await this.queue.getJobCounts('waiting', 'active', 'delayed');
      if (Object.values(counts).reduce((sum, count) => sum + count, 0) >= 5)
        throw new BadRequestException('پنج نوبت در صف است؛ تا پایان یکی از نوبت‌ها صبر کنید');
      const products = await this.prisma.product.findMany({
        where: bulkProductWhere(input),
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        select: { id: true, code: true },
        take: MAX_PRODUCTS + 1,
      });
      if (!products.length) throw new BadRequestException('محصول فعالی مطابق انتخاب شما پیدا نشد');
      if (products.length > MAX_PRODUCTS)
        throw new BadRequestException('حداکثر ۲۰٬۰۰۰ محصول در هر نوبت؛ فیلتر محدودتری انتخاب کنید');
      const { requestId, platforms, ...filters } = input;
      const snapshot: BulkData = { products, filters, platforms, progress: initialBulkProgress() };
      const stored = await this.connection.set(
        snapshotKey(requestId),
        JSON.stringify(snapshot),
        'EX',
        30 * 86400,
        'NX',
      );
      const frozen: BulkData =
        stored === 'OK'
          ? snapshot
          : JSON.parse((await this.connection.get(snapshotKey(requestId)))!);
      const { products: frozenProducts, ...metadata } = frozen;
      const job = await this.queue.add(
        'publish-products',
        {
          ...metadata,
          total: frozenProducts.length,
        },
        {
          jobId: requestId,
          attempts: 1,
          removeOnComplete: { age: 7 * 86400, count: 30 },
          removeOnFail: { age: 7 * 86400, count: 30 },
        },
      );
      return this.view(job);
    });
  }

  private async view(job: Job<BulkQueueData>) {
    const state = await job.getState();
    return {
      id: job.id,
      createdAt: job.timestamp,
      total: job.data.total,
      batches: Math.ceil(job.data.total / BULK_BATCH_SIZE),
      batchSize: BULK_BATCH_SIZE,
      filters: job.data.filters,
      platforms: job.data.platforms,
      progress: job.data.progress,
      state,
      cancelRequested: Boolean(await this.connection.get(`${QUEUE}:cancel:${job.id}`)),
      error:
        state === 'failed'
          ? 'اجرای صف متوقف شد؛ ارسال‌های تأییدشده را دوباره منتشر نکنید و گزارش کانال را بررسی کنید'
          : undefined,
    };
  }

  async list() {
    return this.queueCall(async () => {
      const jobs = await this.queue.getJobs(
        ['waiting', 'active', 'delayed', 'completed', 'failed'],
        0,
        19,
        false,
      );
      return Promise.all(
        jobs
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 20)
          .map((job) => this.view(job)),
      );
    });
  }

  async get(id: string) {
    return this.queueCall(async () => {
      const job = await this.queue.getJob(id);
      if (!job) throw new NotFoundException('انتشار گروهی پیدا نشد');
      return this.view(job);
    });
  }

  async cancel(id: string) {
    return this.queueCall(async () => {
      const job = await this.queue.getJob(id);
      if (!job) throw new NotFoundException('انتشار گروهی پیدا نشد');
      const state = await job.getState();
      if (state !== 'completed' && state !== 'failed')
        await this.connection.set(`${QUEUE}:cancel:${id}`, '1', 'EX', 30 * 86400);
      return this.view(job);
    });
  }

  async onModuleDestroy() {
    this.closing = true;
    // Force-close does not wait for a long campaign; BullMQ recovers its durable
    // cursor after restart, with ambiguous in-flight sends marked for review.
    await this.worker?.close(true);
    await this.queue.close();
    this.connection.disconnect();
  }
}
