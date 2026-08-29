import { describe, expect, it } from 'vitest';
import { brandComposition, debtReminderMessage, stockHealth, totalDebt } from './dashboard-metrics';

const item = (brand: string | null, quantity: number, minStock: number | null = null) => ({
  quantity,
  minStock,
  brand: brand ? { name: brand } : null,
});

describe('dashboard metrics', () => {
  it('merges the long tail of brands into one slice', () => {
    const items = [
      item('اصلی', 10),
      item('اصلی', 5),
      item('ایرانی', 4),
      item('a', 3),
      item('b', 2),
      item('c', 2),
      item('d', 1),
      item('e', 1),
      item('f', 1),
      item('g', 1),
    ];
    const slices = brandComposition(items, 3);
    expect(slices.slice(0, 3)).toEqual([
      { name: 'اصلی', value: 15 },
      { name: 'ایرانی', value: 4 },
      { name: 'a', value: 3 },
    ]);
    expect(slices.at(-1)).toEqual({ name: 'سایر برندها', value: 8 });
  });

  it('buckets items without a brand and skips empty slices', () => {
    expect(brandComposition([item(null, 2), item(' ', 0)])).toEqual([
      { name: 'بدون برند', value: 2 },
    ]);
  });

  it('separates out-of-stock, low and healthy shelves', () => {
    expect(
      stockHealth([item('x', 0, 5), item('x', 3, 5), item('x', 5, 5), item('x', 40, 5)]),
    ).toEqual({ out: 1, low: 2, healthy: 1 });
  });

  it('sums customer debt and ignores negative or broken values', () => {
    expect(totalDebt([{ debt: '1500000' }, { debt: -50 }, { debt: 'abc' }])).toBe(1_500_000);
    expect(totalDebt([])).toBe(0);
  });

  it('writes a Persian debt reminder with the formatted amount', () => {
    expect(debtReminderMessage('علی', 2_500_000, 'https://selimvand.ir/i/abc')).toContain(
      '۲٬۵۰۰٬۰۰۰ ریال',
    );
    expect(debtReminderMessage('علی', 100)).toContain('هماهنگ');
  });
});
