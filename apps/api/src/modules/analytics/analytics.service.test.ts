import { describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from './analytics.service';

/** Minimal Prisma stub covering the aggregate surface the service uses. */
type CreateVisitInput = {
  data: { kind: string; path: string; term?: string | null; productId?: string | null };
};

function makePrisma(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    pageVisit: {
      create: vi.fn(async (_input: CreateVisitInput) => ({})),
      count: vi.fn(async () => 3),
      groupBy: vi.fn(async () => []),
      ...(overrides.pageVisit as object),
    },
    product: {
      findMany: vi.fn(async () => []),
      ...(overrides.product as object),
    },
    $queryRaw: vi.fn(async () => []),
    ...(overrides as object),
  };
}

describe('AnalyticsService', () => {
  it('records page/product/search visits and clamps long paths', async () => {
    const prisma = makePrisma();
    const service = new AnalyticsService(prisma as never);
    await service.record({ kind: 'page', path: '/category/abcd'.repeat(60) });
    await service.record({ kind: 'search', path: '/catalog', term: 'لنت جلو' });
    await service.record({ kind: 'product', path: '/product/x', productId: 'p1' });
    expect(prisma.pageVisit.create).toHaveBeenCalledTimes(3);
    const firstCall = prisma.pageVisit.create.mock.calls.at(0);
    expect(firstCall?.at(0)?.data.path.length).toBeLessThanOrEqual(300);

    // Unknown kinds are ignored — the endpoint is public, so it must not be
    // able to create arbitrary rows.
    await service.record({ kind: 'bogus', path: '/x' });
    expect(prisma.pageVisit.create).toHaveBeenCalledTimes(3);
  });

  it('builds the overview payload from aggregates with gap-free series', async () => {
    const today = new Date();
    const iso = (date: Date) =>
      new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    const prisma = makePrisma({
      pageVisit: {
        create: vi.fn(async () => ({})),
        count: vi.fn(async ({ where }: { where: { createdAt: { gte: Date } } }) => 5),
        groupBy: vi.fn(async (args: { by: string[] }) => {
          if (args.by.includes('path'))
            return [
              { path: '/', _count: { _all: 12 } },
              { path: '/product/a', _count: { _all: 4 } },
            ];
          if (args.by.includes('productId'))
            return [{ productId: 'p1', _count: { _all: 9 } }];
          return [{ term: 'لنت', _count: { _all: 7 } }];
        }),
      },
      product: { findMany: vi.fn(async () => [{ id: 'p1', name: 'لنت جلو', code: 'P-1', slug: 'p1' }]) },
    });
    // Two days of raw data inside a 7-day window; the rest must be zero-filled.
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([
      { day: new Date(), views: 4n },
    ]);
    const service = new AnalyticsService(prisma as never);
    const overview = await service.overview(7);
    expect(overview.rangeDays).toBe(7);
    expect(overview.series).toHaveLength(7);
    expect(overview.series.at(-1)?.views).toBe(4);
    expect(overview.series[0].views).toBe(0);
    expect(overview.kpi.today).toBe(5);
    expect(overview.topPages[0]).toEqual({ path: '/', views: 12 });
    expect(overview.topProducts[0]?.name).toBe('لنت جلو');
    expect(overview.topSearches[0]).toEqual({ term: 'لنت', searches: 7 });
    expect(iso(new Date())).toBeTruthy();
  });

  it('never lets analytics failures escape — a broken db returns an empty overview', async () => {
    const prisma = {
      pageVisit: {
        create: vi.fn(async () => {
          throw new Error('db down');
        }),
        count: vi.fn(async () => {
          throw new Error('db down');
        }),
        groupBy: vi.fn(async () => {
          throw new Error('db down');
        }),
      },
      product: { findMany: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => {
        throw new Error('db down');
      }),
    };
    const service = new AnalyticsService(prisma as never);
    await expect(service.record({ kind: 'page', path: '/' })).resolves.toBeUndefined();
    const overview = await service.overview(7);
    expect(overview.series.every((row) => row.views === 0)).toBe(true);
    expect(overview.topProducts).toEqual([]);
  });
});
