import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

export type VisitSeriesRow = { date: string; views: number };
export type TopPageRow = { path: string; views: number };
export type TopProductRow = {
  productId: string;
  name: string;
  code: string;
  slug: string;
  views: number;
};
export type TopTermRow = { term: string; searches: number };

export type AnalyticsOverview = {
  rangeDays: number;
  kpi: {
    today: number;
    yesterday: number;
    last7: number;
    prev7: number;
    last30: number;
    total: number;
  };
  series: VisitSeriesRow[];
  topPages: TopPageRow[];
  topProducts: TopProductRow[];
  topSearches: TopTermRow[];
};

const VALID_KINDS = new Set(['page', 'product', 'search']);

/** Tehran stays on +03:30 year-round (DST abolished in 2022), so day
 * buckets are cut on a fixed offset — no DST edge cases. */
const TEHRAN_OFFSET = '+03:30';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Records one visit; analytics must never break a page render, so every
   * failure is swallowed. Called fire-and-forget from the public endpoints. */
  async record(input: {
    kind: string;
    path: string;
    term?: string | null;
    productId?: string | null;
  }): Promise<void> {
    if (!VALID_KINDS.has(input.kind)) return;
    const path = input.path.slice(0, 300).trim() || '/';
    try {
      await this.prisma.pageVisit.create({
        data: {
          kind: input.kind,
          path,
          term: input.term ? input.term.slice(0, 200).trim() || null : null,
          productId: input.productId ?? null,
        },
      });
    } catch {
      // Best-effort by design.
    }
  }

  /** Full payload for the «آمار و بازدیدها» screen. */
  async overview(rangeDays = 30): Promise<AnalyticsOverview> {
    const days = Math.min(90, Math.max(7, Math.floor(rangeDays) || 30));
    const since = new Date(Date.now() - (days - 1) * 86_400_000);
    since.setHours(0, 0, 0, 0);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
    const last7Start = new Date(startOfToday.getTime() - 6 * 86_400_000);
    const prev7Start = new Date(last7Start.getTime() - 7 * 86_400_000);
    const last30Start = new Date(startOfToday.getTime() - 29 * 86_400_000);

    const [today, yesterday, last7, prev7, last30, total, series, topPages, topProducts, topSearches] =
      await Promise.all([
        this.countSince(startOfToday),
        this.countSince(startOfYesterday, startOfToday),
        this.countSince(last7Start),
        this.countSince(prev7Start, last7Start),
        this.countSince(last30Start),
        this.countSince(new Date(0)),
        this.dailySeries(days),
        this.topPages(since),
        this.topProducts(since),
        this.topSearches(since),
      ]);

    return {
      rangeDays: days,
      kpi: { today, yesterday, last7, prev7, last30, total },
      series,
      topPages,
      topProducts,
      topSearches,
    };
  }

  /** Every aggregate is best-effort: a database hiccup must degrade the
   * analytics screen to zeros, never a 500. */
  private async countSince(since: Date, until?: Date): Promise<number> {
    try {
      return await this.prisma.pageVisit.count({
        where: { createdAt: { gte: since, ...(until ? { lt: until } : {}) } },
      });
    } catch {
      return 0;
    }
  }

  /** Daily visit counts for the chart — cut on Tehran midnight. */
  private async dailySeries(days: number): Promise<VisitSeriesRow[]> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ day: Date; views: bigint }>>`
        SELECT (date_trunc('day', "createdAt" AT TIME ZONE ${TEHRAN_OFFSET})) AS day,
               count(*)::bigint AS views
        FROM "page_visits"
        WHERE "createdAt" >= now() - ${`${days - 1} days`}::interval
        GROUP BY 1
        ORDER BY 1 ASC`;
      const byDay = new Map<string, number>(
        rows.map((row) => [new Date(row.day).toISOString().slice(0, 10), Number(row.views)]),
      );
      // Fill the gap-less day list the chart expects (zero days included).
      const series: VisitSeriesRow[] = [];
      const cursor = new Date();
      cursor.setHours(12, 0, 0, 0);
      cursor.setDate(cursor.getDate() - (days - 1));
      for (let index = 0; index < days; index += 1) {
        const key =
          new Date(cursor.getTime() - cursor.getTimezoneOffset() * 60_000)
            .toISOString()
            .slice(0, 10);
        series.push({ date: key, views: byDay.get(key) ?? 0 });
        cursor.setDate(cursor.getDate() + 1);
      }
      return series;
    } catch {
      return [];
    }
  }

  private async topPages(since: Date, limit = 8): Promise<TopPageRow[]> {
    let rows;
    try {
      rows = await this.prisma.pageVisit.groupBy({
      by: ['path'],
      where: { createdAt: { gte: since }, kind: { in: ['page', 'product'] } },
      _count: { _all: true },
        orderBy: { _count: { path: 'desc' } },
        take: limit,
      });
    } catch {
      return [];
    }
    return rows.map((row) => ({ path: row.path, views: row._count._all }));
  }

  private async topProducts(since: Date, limit = 10): Promise<TopProductRow[]> {
    let rows;
    try {
      rows = await this.prisma.pageVisit.groupBy({
        by: ['productId'],
        where: { createdAt: { gte: since }, kind: 'product', productId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { productId: 'desc' } },
        take: limit,
      });
    } catch {
      return [];
    }
    const ids = rows.map((row) => row.productId).filter((id): id is string => Boolean(id));
    if (!ids.length) return [];
    const products = await this.prisma.product
      .findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, code: true, slug: true },
      })
      .catch(() => []);
    const byId = new Map(products.map((product) => [product.id, product]));
    return rows
      .map((row) => {
        const product = byId.get(row.productId ?? '');
        if (!product) return null;
        return {
          productId: row.productId ?? '',
          name: product.name,
          code: product.code,
          slug: product.slug,
          views: row._count._all,
        };
      })
      .filter((row): row is TopProductRow => row !== null);
  }

  private async topSearches(since: Date, limit = 10): Promise<TopTermRow[]> {
    let rows;
    try {
      rows = await this.prisma.pageVisit.groupBy({
        by: ['term'],
        where: { createdAt: { gte: since }, kind: 'search', term: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { term: 'desc' } },
        take: limit,
      });
    } catch {
      return [];
    }
    return rows.map((row) => ({ term: row.term ?? '', searches: row._count._all }));
  }
}
