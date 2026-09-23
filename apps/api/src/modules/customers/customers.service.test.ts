import { describe, expect, it, vi } from 'vitest';
import { CustomersService, calculateCustomerDebt } from './customers.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('customer payment accounting', () => {
  it('calculates outstanding debt from issued invoice balances', () => {
    expect(
      calculateCustomerDebt([
        { total: 1000n, paidAmount: 200n },
        { total: 500n, paidAmount: 500n },
      ]),
    ).toBe(800n);
  });
  it('does not produce a negative debt when invoices are fully settled', () => {
    expect(calculateCustomerDebt([{ total: 1000n, paidAmount: 1000n }])).toBe(0n);
  });
  it('stops counting returned items as debt', () => {
    // 50k debt + a 50k return → debt 0 (the «عملیات فاکتور و پرداخت» scenario).
    expect(
      calculateCustomerDebt([
        { total: 100_000n, paidAmount: 50_000n, returns: [{ refundAmount: 50_000n }] },
      ]),
    ).toBe(0n);
    expect(
      calculateCustomerDebt([
        { total: 100_000n, paidAmount: 0n, returns: [{ refundAmount: 30_000n }] },
      ]),
    ).toBe(70_000n);
    // no returns field at all (older payloads) keeps working
    expect(calculateCustomerDebt([{ total: 1000n, paidAmount: 200n }])).toBe(800n);
  });
  it('allocates a customer payment across oldest invoice balances', async () => {
    const invoiceUpdate = vi.fn(async () => ({}));
    const paymentCreate = vi.fn(async () => ({}));
    const receiptCreate = vi.fn(async () => ({
      id: 'receipt-1',
      amount: 1200n,
      paidAt: new Date('2026-09-01T10:00:00Z'),
    }));
    const customerRow = {
      id: 'customer-1',
      name: 'مشتری',
      mobile: '09351112233',
      address: null,
      notes: null,
      isActive: true,
      updatedAt: new Date('2026-09-17T00:00:00Z'),
      invoices: [
        { id: 'invoice-1', total: 1000n, paidAmount: 0n, paymentStatus: 'unpaid' },
        { id: 'invoice-2', total: 500n, paidAmount: 0n, paymentStatus: 'unpaid' },
      ],
    };
    const tx = {
      customer: {
        findFirst: vi.fn(async () => customerRow),
        findUnique: vi.fn(async () => customerRow),
      },
      customerPayment: { create: receiptCreate },
      invoice: { update: invoiceUpdate },
      payment: { create: paymentCreate },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const result = await new CustomersService(prisma as never).payment(
      'customer-1',
      { amount: '1200', method: 'cash' },
      'user-1',
    );
    expect(result.data.remainingDebt).toBe('300');
    // Regression guard for the 500 the panel hit: the response body must be
    // serializable WITHOUT the express bigint `json replacer`.
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.parse(JSON.stringify(result)).data.amount).toBe('1200');
    expect(invoiceUpdate).toHaveBeenCalledTimes(2);
    expect(invoiceUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'invoice-1' },
        data: expect.objectContaining({ paidAmount: 1000n, paymentStatus: 'paid' }),
      }),
    );
    expect(invoiceUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'invoice-2' },
        data: expect.objectContaining({ paidAmount: 200n, paymentStatus: 'partial' }),
      }),
    );
    expect(paymentCreate).toHaveBeenCalledTimes(2);
  });

  it('allocates a payment to the requested invoice only', async () => {
    const invoiceUpdate = vi.fn(async () => ({}));
    const customerRow = {
      id: 'customer-1',
      name: 'مشتری',
      mobile: '09351112233',
      address: null,
      notes: null,
      isActive: true,
      updatedAt: new Date('2026-09-17T00:00:00Z'),
      invoices: [
        { id: 'invoice-1', total: 1000n, paidAmount: 0n, paymentStatus: 'unpaid' },
        { id: 'invoice-2', total: 500n, paidAmount: 0n, paymentStatus: 'unpaid' },
      ],
    };
    const tx = {
      customer: {
        findFirst: vi.fn(async () => customerRow),
        findUnique: vi.fn(async () => customerRow),
      },
      customerPayment: { create: vi.fn(async () => ({ id: 'receipt-1' })) },
      invoice: { update: invoiceUpdate },
      payment: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    await new CustomersService(prisma as never).payment(
      'customer-1',
      { amount: 300, method: 'card', invoiceId: 'invoice-2' },
      'user-1',
    );
    expect(invoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'invoice-2' },
        data: expect.objectContaining({ paidAmount: 300n }),
      }),
    );
    expect(invoiceUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'invoice-1' } }),
    );
  });

  it('rejects incomplete and unknown customer vehicles before writing', async () => {
    const create = vi.fn();
    const prisma = {
      customer: { findUnique: vi.fn(async () => ({ id: 'customer-1' })) },
      vehicleTrim: { findUnique: vi.fn(async () => null) },
      customerVehicle: { create },
    };
    const service = new CustomersService(prisma as never);
    await expect(service.addVehicle('customer-1', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.addVehicle('customer-1', { trimId: 'missing' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.addVehicle('customer-1', { plate: '12-الف-345', year: 1200 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a customer payment above total outstanding debt', async () => {
    const receiptCreate = vi.fn();
    const tx = {
      customer: {
        findFirst: vi.fn(async () => ({
          id: 'customer-1',
          invoices: [{ id: 'invoice-1', total: 1000n, paidAmount: 700n, paymentStatus: 'partial' }],
        })),
      },
      customerPayment: { create: receiptCreate },
      invoice: { update: vi.fn() },
      payment: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    await expect(
      new CustomersService(prisma as never).payment(
        'customer-1',
        { amount: 301, method: 'cash' },
        'user-1',
      ),
    ).rejects.toThrow('مبلغ پرداخت بیشتر از بدهی مشتری است');
    expect(receiptCreate).not.toHaveBeenCalled();
  });
});

describe('customer profile sync', () => {
  it('broadcasts an address change through the sync pull payload', async () => {
    const before = {
      id: 'customer-1',
      name: 'حسن رضایی',
      mobile: '09121234567',
      address: 'تهران، خیابان نمونه، پلاک ۱۲',
      notes: null,
      isActive: true,
    };
    const updated = {
      ...before,
      address: 'تهران، خیابان جدید، پلاک ۲۰',
      updatedAt: new Date('2026-09-18T12:00:00Z'),
    };
    const customerUpdate = vi.fn(async () => updated);
    const syncChangeCreate = vi.fn(async () => ({}));
    const prisma = {
      customer: { findUnique: vi.fn(async () => before), update: customerUpdate },
      auditLog: { create: vi.fn(async () => ({})) },
      syncChange: { create: syncChangeCreate },
    };
    await new CustomersService(prisma as never).update(
      'customer-1',
      { address: 'تهران، خیابان جدید، پلاک ۲۰' },
      'user-1',
    );
    expect(customerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { address: 'تهران، خیابان جدید، پلاک ۲۰' } }),
    );
    // The sync change carries the full rebuildable snapshot so every Android
    // device pulls the new address on the next GET /sync/pull.
    expect(syncChangeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: 'customer',
          entityId: 'customer-1',
          action: 'updated',
          payload: expect.objectContaining({
            id: 'customer-1',
            address: 'تهران، خیابان جدید، پلاک ۲۰',
            updatedAt: '2026-09-18T12:00:00.000Z',
          }),
        }),
      }),
    );
  });
});
