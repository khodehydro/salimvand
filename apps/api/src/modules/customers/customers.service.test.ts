import { describe, expect, it, vi } from 'vitest';
import { CustomersService, calculateCustomerDebt } from './customers.service';

describe('customer payment accounting', () => {
  it('calculates outstanding debt from issued invoice balances', () => {
    expect(calculateCustomerDebt([{ total: 1000n, paidAmount: 200n }, { total: 500n, paidAmount: 500n }])).toBe(800n);
  });
  it('does not produce a negative debt when invoices are fully settled', () => {
    expect(calculateCustomerDebt([{ total: 1000n, paidAmount: 1000n }])).toBe(0n);
  });
  it('allocates a customer payment across oldest invoice balances', async () => {
    const invoiceUpdate = vi.fn(async () => ({}));
    const paymentCreate = vi.fn(async () => ({}));
    const receiptCreate = vi.fn(async () => ({ id: 'receipt-1', amount: 1200n }));
    const tx = {
      customer: { findFirst: vi.fn(async () => ({ id: 'customer-1', invoices: [
        { id: 'invoice-1', total: 1000n, paidAmount: 0n, paymentStatus: 'unpaid' },
        { id: 'invoice-2', total: 500n, paidAmount: 0n, paymentStatus: 'unpaid' },
      ] })) },
      customerPayment: { create: receiptCreate },
      invoice: { update: invoiceUpdate },
      payment: { create: paymentCreate },
    };
    const prisma = { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) };
    const result = await new CustomersService(prisma as never).payment('customer-1', { amount: '1200', method: 'cash' }, 'user-1');
    expect(result.data.remainingDebt).toBe(300n);
    expect(invoiceUpdate).toHaveBeenCalledTimes(2);
    expect(invoiceUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { id: 'invoice-1' }, data: expect.objectContaining({ paidAmount: 1000n, paymentStatus: 'paid' }) }));
    expect(invoiceUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { id: 'invoice-2' }, data: expect.objectContaining({ paidAmount: 200n, paymentStatus: 'partial' }) }));
    expect(paymentCreate).toHaveBeenCalledTimes(2);
  });

  it('rejects a customer payment above total outstanding debt', async () => {
    const receiptCreate = vi.fn();
    const tx = {
      customer: { findFirst: vi.fn(async () => ({ id: 'customer-1', invoices: [{ id: 'invoice-1', total: 1000n, paidAmount: 700n, paymentStatus: 'partial' }] })) },
      customerPayment: { create: receiptCreate }, invoice: { update: vi.fn() }, payment: { create: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) };
    await expect(new CustomersService(prisma as never).payment('customer-1', { amount: 301, method: 'cash' }, 'user-1')).rejects.toThrow('مبلغ پرداخت بیشتر از بدهی مشتری است');
    expect(receiptCreate).not.toHaveBeenCalled();
  });
});
