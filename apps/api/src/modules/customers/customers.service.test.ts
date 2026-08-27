import { describe, expect, it } from 'vitest';
import { calculateCustomerDebt } from './customers.service';

describe('customer payment accounting', () => {
  it('calculates outstanding debt from issued invoice balances', () => {
    expect(calculateCustomerDebt([{ total: 1000n, paidAmount: 200n }, { total: 500n, paidAmount: 500n }])).toBe(800n);
  });
  it('does not produce a negative debt when invoices are fully settled', () => {
    expect(calculateCustomerDebt([{ total: 1000n, paidAmount: 1000n }])).toBe(0n);
  });
});
