import { afterEach, describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BulkPublishService, bulkProductWhere } from './bulk-publish.service';
import { BulkPublishFilterDto, StartBulkPublishDto } from './bulk-publish.dto';
import { BulkPublishController } from './bulk-publish.controller';
import { ROLES_KEY } from '../../common/auth/roles.decorator';

const requestId = '11111111-1111-4111-8111-111111111111';
const category = '22222222-2222-4222-8222-222222222222';
const model = '33333333-3333-4333-8333-333333333333';
const input: StartBulkPublishDto = { mode: 'all', platforms: ['telegram', 'bale'], requestId };

afterEach(() => vi.restoreAllMocks());

function setup() {
  const values = new Map<string, string>();
  const jobs = new Map<string, any>();
  const prisma = {
    product: {
      count: vi.fn(async () => 200),
      findMany: vi.fn(async () => [{ id: 'p1', code: 'P1' }]),
    },
    setting: {
      findUnique: vi.fn(async () => ({
        value: {
          telegram: { botToken: 'tg', chatId: '-1' },
          bale: { botToken: 'bale', chatId: '-2' },
        },
      })),
    },
  };
  const connection = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    }),
  };
  const queue = {
    getJob: vi.fn(async (id: string) => jobs.get(id)),
    getWorkers: vi.fn(async () => [{ id: 'worker1' }]),
    getJobCounts: vi.fn(async () => ({ waiting: 0, active: 0, delayed: 0 })),
    getJobs: vi.fn(async () => [...jobs.values()]),
    add: vi.fn(async (_name: string, data: unknown, opts: { jobId: string }) => {
      if (jobs.has(opts.jobId)) return jobs.get(opts.jobId);
      const job = {
        id: opts.jobId,
        data,
        timestamp: 1,
        getState: vi.fn(async () => 'waiting'),
        updateData: vi.fn(),
      };
      jobs.set(opts.jobId, job);
      return job;
    }),
  };
  const service = Object.assign(Object.create(BulkPublishService.prototype), {
    prisma,
    connection,
    queue,
  }) as BulkPublishService;
  return { service, prisma, queue, connection, values, jobs };
}

describe('bulk filter semantics', () => {
  it('always excludes deleted and inactive products', () => {
    expect(bulkProductWhere({ mode: 'all' })).toEqual({
      status: 'active',
      deletedAt: null,
      AND: [],
    });
  });
  it('uses a single product query with OR within each multi-select and AND across groups', () => {
    const where = bulkProductWhere({
      mode: 'combined',
      vehicleModelIds: [model],
      categoryIds: [category],
      match: 'and',
      inStockOnly: true,
      withImageOnly: true,
    });
    expect(where.AND).toEqual([
      {
        AND: [
          { compatibilities: { some: { modelId: { in: [model] } } } },
          { categoryId: { in: [category] } },
        ],
      },
      { inventoryItems: { some: { isActive: true, quantity: { gt: 0 } } } },
      { images: { some: {} } },
    ]);
  });
  it('supports union of groups without leaking filters from a different mode', () => {
    expect(
      bulkProductWhere({
        mode: 'combined',
        categoryIds: [category],
        vehicleModelIds: [model],
        match: 'or',
      }).AND,
    ).toHaveLength(1);
    expect(
      JSON.stringify(bulkProductWhere({ mode: 'all', categoryIds: [category] })),
    ).not.toContain(category);
    expect(bulkProductWhere({ mode: 'brands', brandIds: [category] }).AND).toEqual([
      { AND: [{ inventoryItems: { some: { isActive: true, brandId: { in: [category] } } } }] },
    ]);
  });
  it.each(['vehicles', 'categories', 'brands', 'combined'] as const)(
    'rejects empty %s selection instead of publishing everything',
    (mode) => {
      expect(() => bulkProductWhere({ mode })).toThrow('انتخاب');
    },
  );
  it('requires at least two groups in combined mode', () => {
    expect(() => bulkProductWhere({ mode: 'combined', categoryIds: [category] })).toThrow(
      'حداقل دو',
    );
  });
});

describe('bulk input validation and authorization', () => {
  it('rejects unsafe platforms, duplicate IDs, invalid UUIDs and non-boolean flags', async () => {
    for (const fields of [
      { platforms: [] },
      { platforms: ['sms'] },
      { platforms: ['bale', 'bale'] },
      { requestId: 'bad' },
      { categoryIds: [category, category] },
      { vehicleModelIds: ['bad'] },
      { inStockOnly: 'false' },
    ]) {
      const dto = plainToInstance(
        StartBulkPublishDto,
        { ...input, ...fields },
        { enableImplicitConversion: true },
      );
      expect((await validate(dto)).length).toBeGreaterThan(0);
    }
    expect(await validate(plainToInstance(StartBulkPublishDto, input))).toEqual([]);
    expect(await validate(plainToInstance(BulkPublishFilterDto, { mode: 'all' }))).toEqual([]);
  });
  it('guards every bulk route for manager/warehouse users', () => {
    expect(Reflect.getMetadata(ROLES_KEY, BulkPublishController)).toEqual(['manager', 'warehouse']);
    expect(
      Reflect.getMetadata('__guards__', BulkPublishController).map((guard: Function) => guard.name),
    ).toEqual(['JwtAuthGuard', 'RolesGuard']);
  });
});

describe('bulk queue service', () => {
  it('previews 200 products as 20 batches without enqueueing anything', async () => {
    const { service, queue } = setup();
    expect(await service.preview({ mode: 'all' })).toEqual({
      count: 200,
      batches: 20,
      batchSize: 10,
      batchDelaySeconds: 30,
    });
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('freezes product IDs once and uses a stable idempotency key', async () => {
    const { service, queue, prisma, connection } = setup();
    const first = await service.start(input);
    const second = await service.start(input);
    expect(first.id).toBe(second.id);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][1]).not.toHaveProperty('products');
    expect(queue.add.mock.calls[0][1]).toHaveProperty('total', 1);
    expect(JSON.stringify(connection.set.mock.calls[0])).toContain('p1');
    expect(first).not.toHaveProperty('products');
  });
  it('does not enqueue an empty group or start without a worker', async () => {
    const { service, prisma, queue } = setup();
    prisma.product.findMany.mockResolvedValue([]);
    await expect(service.start(input)).rejects.toThrow('پیدا نشد');
    expect(queue.add).not.toHaveBeenCalled();
    queue.getWorkers.mockResolvedValue([]);
    await expect(service.start(input)).rejects.toThrow('worker');
  });
  it('limits the backlog instead of growing an unbounded Redis queue', async () => {
    const { service, queue, prisma } = setup();
    queue.getJobCounts.mockResolvedValue({ waiting: 4, active: 1, delayed: 0 });
    await expect(service.start(input)).rejects.toThrow('پنج');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
  it('returns a clear error when Redis is unavailable', async () => {
    const { service, queue } = setup();
    queue.getJob.mockRejectedValueOnce(new Error('Redis connection refused'));
    await expect(service.start(input)).rejects.toThrow('صف انتشار');
  });
  it('cancels via a separate flag, without overwriting the worker progress', async () => {
    const { service, jobs } = setup();
    await service.start(input);
    const result = await service.cancel(requestId);
    expect(result.cancelRequested).toBe(true);
    expect(jobs.get(requestId).updateData).not.toHaveBeenCalled();
    await expect(service.cancel(category)).rejects.toThrow('پیدا نشد');
  });
});
