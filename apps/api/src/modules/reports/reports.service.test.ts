import { describe, expect, it, vi } from 'vitest';
import { ReportsService } from './reports.service';
import type { PrismaService } from '../../prisma.service';

describe('ReportsService date filters', () => {
  const service = new ReportsService({} as PrismaService);

  it('rejects an invalid sales start date before querying the database', async () => {
    await expect(service.sales('not-a-date')).rejects.toThrow('از تاریخ معتبر نیست');
  });

  it('rejects an invalid profit end date before querying the database', async () => {
    await expect(service.profit(undefined, 'not-a-date')).rejects.toThrow('تا تاریخ معتبر نیست');
  });

  it('rejects a date range whose start is after its end', async () => {
    await expect(service.sales('2026-08-27', '2026-08-01')).rejects.toThrow(
      'بازهٔ تاریخ گزارش نامعتبر است',
    );
  });

  it('includes the complete UTC day for a date-only end filter', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await new ReportsService({ invoice: { findMany } } as unknown as PrismaService).sales(
      undefined,
      '2026-08-26',
    );
    expect(findMany.mock.calls[0][0].where.issuedAt.lte.toISOString()).toBe(
      '2026-08-26T23:59:59.999Z',
    );
  });
});
