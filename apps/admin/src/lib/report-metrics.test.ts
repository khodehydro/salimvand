import { describe, expect, it } from 'vitest';
import { monthlySales, profitShare } from './report-metrics';

describe('report metrics', () => {
  it('buckets invoices into Jalali months oldest first', () => {
    const buckets = monthlySales([
      { issuedAt: '2026-03-21T10:00:00Z', total: '1000', paidAmount: '600' },
      { issuedAt: '2026-02-10T10:00:00Z', total: '2000', paidAmount: '0' },
      { issuedAt: '2026-03-25T10:00:00Z', total: '500', paidAmount: '500' },
    ]);
    expect(buckets).toHaveLength(2);
    expect(buckets[0].invoiceCount).toBe(1);
    expect(buckets[1]).toMatchObject({ revenue: 1500, paid: 1100, invoiceCount: 2 });
    expect(buckets[1].date).toContain('فروردین');
  });

  it('ignores rows without a parsable date and negative amounts', () => {
    expect(
      monthlySales([
        { issuedAt: 'not-a-date', total: '10' },
        { issuedAt: '2026-03-21T10:00:00Z', total: -50 },
      ]),
    ).toEqual([expect.objectContaining({ revenue: 0, invoiceCount: 1 })]);
  });

  it('clamps negative margins and sorts brands by profit', () => {
    expect(
      profitShare([
        { brand: 'اصلی', profit: '-400' },
        { brand: 'ایرانی', profit: '900' },
        { brand: 'چینی', profit: '1500' },
      ]),
    ).toEqual([
      { name: 'چینی', value: 1500 },
      { name: 'ایرانی', value: 900 },
    ]);
    expect(profitShare([])).toEqual([]);
  });
});
