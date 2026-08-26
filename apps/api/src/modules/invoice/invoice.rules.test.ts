import { describe, expect, it } from 'vitest';
import { calculateInvoiceTotals } from './invoice.rules';

describe('invoice rules', () => {
  it('calculates integer rial totals without floating point errors', () => { expect(calculateInvoiceTotals([{ quantity: 2, unitPrice: 125000n }, { quantity: 1, unitPrice: 99000n }], 10000n)).toEqual({ subtotal: 349000n, discount: 10000n, total: 339000n }); });
  it('rejects invalid quantities and prices', () => { expect(() => calculateInvoiceTotals([{ quantity: 0, unitPrice: 1n }])).toThrow(); expect(() => calculateInvoiceTotals([{ quantity: 1, unitPrice: -1n }])).toThrow(); });
  it('does not allow discount above subtotal', () => { expect(() => calculateInvoiceTotals([{ quantity: 1, unitPrice: 100n }], 101n)).toThrow('تخفیف نمی‌تواند از مبلغ فاکتور بیشتر باشد'); });
});
