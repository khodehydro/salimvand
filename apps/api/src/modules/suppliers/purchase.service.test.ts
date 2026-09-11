import { describe, expect, it, vi } from 'vitest';
import { calculatePurchaseDebt, PurchaseService } from './purchase.service';
import type { PrismaService } from '../../prisma.service';

describe('PurchaseService validation', () => {
  const service = new PurchaseService({} as PrismaService);

  it('requires a supplier and at least one line', async () => {
    await expect(service.create('', [], 0, 'actor-id')).rejects.toThrow(
      'تأمین‌کننده و حداقل یک قلم خرید الزامی است',
    );
  });

  it('rejects non-integer rial prices before opening a transaction', async () => {
    await expect(
      service.create(
        'supplier-id',
        [{ inventoryItemId: 'item-id', quantity: 1, unitPrice: '12.5' }],
        0,
        'actor-id',
      ),
    ).rejects.toThrow('قیمت خرید معتبر نیست');
  });

  it('rejects negative paid amounts', async () => {
    await expect(
      service.create(
        'supplier-id',
        [{ inventoryItemId: 'item-id', quantity: 1, unitPrice: 100 }],
        -1,
        'actor-id',
      ),
    ).rejects.toThrow('مبلغ پرداخت معتبر نیست');
  });

  it('rejects duplicate lines with conflicting prices', async () => {
    await expect(
      service.create(
        'supplier-id',
        [
          { inventoryItemId: 'item-id', quantity: 1, unitPrice: 100 },
          { inventoryItemId: 'item-id', quantity: 1, unitPrice: 120 },
        ],
        0,
        'actor-id',
      ),
    ).rejects.toThrow('برای هر قلم فقط یک قیمت خرید مجاز است');
  });

  it('calculates purchase debt without allowing negative balances', () => {
    expect(calculatePurchaseDebt(1000n, 300n)).toBe(700n);
    expect(calculatePurchaseDebt(1000n, 1200n)).toBe(0n);
  });

  it('rejects supplier invoice payment above the outstanding balance', async () => {
    const updateMany = vi.fn();
    const tx = {
      purchaseInvoice: {
        findUnique: vi.fn(async () => ({
          id: 'purchase-1',
          status: 'issued',
          supplierId: 'supplier-1',
          total: 1000n,
          paidAmount: 900n,
        })),
        updateMany,
      },
      supplierPayment: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    await expect(
      new PurchaseService(prisma as never).pay('purchase-1', 101, 'cash', undefined, 'actor-id'),
    ).rejects.toThrow('مبلغ پرداخت بیشتر از بدهی فاکتور است');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('updates the invoice and records a supplier payment atomically', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const supplierPayment = vi.fn(async () => ({ id: 'payment-1' }));
    const invoice = {
      id: 'purchase-1',
      status: 'issued',
      supplierId: 'supplier-1',
      total: 1000n,
      paidAmount: 400n,
    };
    const updated = { ...invoice, paidAmount: 700n };
    const findUnique = vi.fn().mockResolvedValueOnce(invoice).mockResolvedValueOnce(updated);
    const tx = {
      purchaseInvoice: { findUnique, updateMany },
      supplierPayment: { create: supplierPayment },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const result = await new PurchaseService(prisma as never).pay(
      'purchase-1',
      300,
      'transfer',
      'تسویه',
      'actor-id',
    );
    const purchaseResult = result.data as { invoice?: { paidAmount: bigint } };
    expect(purchaseResult.invoice).toBeDefined();
    expect(purchaseResult.invoice!.paidAmount).toBe(700n);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(supplierPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 300n, method: 'transfer' }),
      }),
    );
  });
});
