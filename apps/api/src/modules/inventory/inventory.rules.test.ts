import { describe, expect, it } from 'vitest';
import { calculateNextQuantity } from './inventory.rules';

describe('inventory rules', () => {
  it('calculates a valid next quantity', () => expect(calculateNextQuantity(5, -2, 'فروش ثبت‌نشده')).toBe(3));
  it('rejects negative stock', () => expect(() => calculateNextQuantity(1, -2, 'اصلاح')).toThrow());
  it('requires a reason for negative adjustments', () => expect(() => calculateNextQuantity(5, -1)).toThrow());
  it('rejects zero changes', () => expect(() => calculateNextQuantity(5, 0, 'اشتباه')).toThrow());
});
