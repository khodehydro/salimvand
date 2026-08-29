import { describe, expect, it } from 'vitest';
import {
  discountedUnitPrice,
  invoiceTotals,
  isValidIranMobile,
  lineTotal,
  paymentTotal,
  remainingDebt,
} from './invoice-math';

describe('invoice math', () => {
  it('keeps a line total non negative when the discount exceeds the line', () => {
    expect(lineTotal(1_000_000, 2, 5_000_000)).toBe(0);
    expect(lineTotal(1_000_000, 3, 500_000)).toBe(2_500_000);
  });

  it('sums lines and clamps the invoice discount to the subtotal', () => {
    const lines = [
      { salePrice: 1_200_000, quantity: 2, lineDiscount: 100_000 },
      { salePrice: 800_000, quantity: 1, lineDiscount: 0 },
    ];
    expect(invoiceTotals(lines, 200_000)).toEqual({
      subtotal: 3_100_000,
      discount: 200_000,
      total: 2_900_000,
    });
    expect(invoiceTotals(lines, 9_999_999).total).toBe(0);
    expect(invoiceTotals([], 500)).toEqual({ subtotal: 0, discount: 0, total: 0 });
  });

  it('ignores negative or unparsable payment amounts', () => {
    expect(
      paymentTotal([
        { method: 'cash', amount: '1500000' },
        { method: 'card', amount: '-40' },
        { method: 'cash', amount: 'abc' },
      ]),
    ).toBe(1_500_000);
  });

  it('folds a line discount into the unit price the API accepts', () => {
    expect(discountedUnitPrice(1_000_000, 4, 400_000)).toBe('900000');
    expect(discountedUnitPrice(1_000_000, 2, 9_000_000)).toBe('0');
  });

  it('accepts only Iranian mobile numbers', () => {
    expect(isValidIranMobile('09123456789')).toBe(true);
    expect(isValidIranMobile('02112345678')).toBe(false);
    expect(isValidIranMobile('+989123456789')).toBe(false);
  });

  it('reports the debt left after mixed payments', () => {
    expect(
      remainingDebt(3_000_000, [
        { method: 'cash', amount: '1000000' },
        { method: 'card', amount: '1500000' },
      ]),
    ).toBe(500_000);
    expect(remainingDebt(3_000_000, [{ method: 'cash', amount: '4000000' }])).toBe(0);
  });
});
