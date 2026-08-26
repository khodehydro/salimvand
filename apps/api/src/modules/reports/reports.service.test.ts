import { describe, expect, it } from 'vitest';
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
});
