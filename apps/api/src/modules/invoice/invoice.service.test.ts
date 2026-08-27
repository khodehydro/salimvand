import { describe, expect, it, vi } from 'vitest';
import { InvoiceService } from './invoice.service';
import { matchesPublicToken } from './public-token';

describe('InvoiceService', () => {
  it('builds an immutable invoice draft with secure public token', () => { const draft = new InvoiceService({} as never).buildDraft('INV-0001', [{ inventoryItemId: 'i1', productName: 'قاب ستون', quantity: 2, unitPrice: 125000n }]); expect(draft).toMatchObject({ number: 'INV-0001', subtotal: 250000n, total: 250000n, items: [{ lineTotal: 250000n }] }); expect(matchesPublicToken(draft.publicToken, draft.publicTokenHash)).toBe(true); });
  it('keeps product name and unit price as invoice snapshots', () => { const line = { inventoryItemId: 'i1', productName: 'قاب اولیه', quantity: 1, unitPrice: 90000n }; const draft = new InvoiceService({} as never).buildDraft('INV-0002', [line]); line.productName = 'نام تغییرکرده'; line.unitPrice = 1n; expect(draft.items[0]).toMatchObject({ productName: 'قاب اولیه', unitPrice: 90000n, lineTotal: 90000n }); });
  it('returns a public invoice without internal inventory identifiers', async () => {
    const invoice = { id: 'inv-1', number: 'INV-0005', status: 'issued', publicTokenExpiresAt: new Date(Date.now() + 86_400_000), customerName: 'علی', customerMobile: '0912', subtotal: 100n, discount: 0n, total: 100n, paymentStatus: 'unpaid', paymentMethod: null, paidAmount: 0n, paidAt: null, issuedAt: new Date(), voidedAt: null, items: [{ productName: 'لنت', quantity: 1, unitPrice: 100n, lineTotal: 100n, inventoryItem: { brand: { name: 'اصلی' } } }] };
    const prisma = { invoice: { findFirst: async () => invoice } };
    const result = await new InvoiceService(prisma as never).getPublic('short-code');
    expect(result.data.items[0]).toMatchObject({ productName: 'لنت', brand: 'اصلی' });
    expect(result.data.items[0]).not.toHaveProperty('inventoryItemId');
    expect(result.data).not.toHaveProperty('id');
  });
  it('rejects malformed or unsafe invoice drafts', () => { const service = new InvoiceService({} as never); const line = { inventoryItemId: 'i1', productName: 'قطعه', quantity: 1, unitPrice: 100n }; expect(() => service.buildDraft('bad', [line])).toThrow(); expect(() => service.buildDraft('INV-0003', [])).toThrow(); expect(() => service.buildDraft('INV-0004', [line, line])).toThrow('قلم موجودی نمی‌تواند در چند ردیف تکرار شود'); });
  it('atomically decrements every stock item before creating the invoice', async () => {
    const invoiceCreate = vi.fn(async () => ({ id: 'invoice-1', number: 'INV-000001', items: [] }));
    const decrements = vi.fn(async (_args: unknown) => ({ count: 1 }));
    const tx = {
      counter: { upsert: vi.fn(async () => ({ lastValue: 1 })) },
      inventoryItem: { updateMany: decrements, findUniqueOrThrow: vi.fn(async () => ({ quantity: 3 })) },
      invoice: { create: invoiceCreate },
      inventoryTransaction: { create: vi.fn(), updateMany: vi.fn() },
    };
    const prisma = {
      inventoryItem: { findMany: vi.fn(async () => [
        { id: 'item-1', product: { name: 'لنت' } },
        { id: 'item-2', product: { name: 'فیلتر' } },
      ]) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const result = await new InvoiceService(prisma as never).create({ items: [
      { inventoryItemId: 'item-1', quantity: 2, unitPrice: 100 },
      { inventoryItemId: 'item-2', quantity: 1, unitPrice: 200 },
    ] }, 'user-1');
    expect(result.data.number).toBe('INV-000001');
    expect(decrements).toHaveBeenCalledTimes(2);
    expect(decrements.mock.calls[0][0]).toMatchObject({ where: { id: 'item-1', quantity: { gte: 2 }, isActive: true } });
    expect(decrements.mock.calls[1][0]).toMatchObject({ where: { id: 'item-2', quantity: { gte: 1 }, isActive: true } });
    expect(invoiceCreate).toHaveBeenCalledTimes(1);
  });

  it('does not create an invoice when a later stock decrement fails', async () => {
    const invoiceCreate = vi.fn();
    let call = 0;
    const tx = {
      counter: { upsert: vi.fn(async () => ({ lastValue: 2 })) },
      inventoryItem: { updateMany: vi.fn(async () => ({ count: ++call === 1 ? 1 : 0 })) },
      invoice: { create: invoiceCreate },
      inventoryTransaction: { create: vi.fn(), updateMany: vi.fn() },
    };
    const prisma = {
      inventoryItem: { findMany: vi.fn(async () => [
        { id: 'item-1', product: { name: 'لنت' } },
        { id: 'item-2', product: { name: 'فیلتر' } },
      ]) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    await expect(new InvoiceService(prisma as never).create({ items: [
      { inventoryItemId: 'item-1', quantity: 2, unitPrice: 100 },
      { inventoryItemId: 'item-2', quantity: 1, unitPrice: 200 },
    ] }, 'user-1')).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_STOCK' } });
    expect(invoiceCreate).not.toHaveBeenCalled();
    expect(tx.inventoryItem.updateMany).toHaveBeenCalledTimes(2);
  });
  it('rejects a payment that would exceed the invoice total', async () => {
    const update = vi.fn();
    const tx = { invoice: { findUnique: vi.fn(async () => ({ id: 'invoice-1', status: 'issued', paidAmount: 800n, total: 1000n })) , update }, payments: { create: vi.fn() } };
    const prisma = { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) };
    await expect(new InvoiceService(prisma as never).pay('invoice-1', 201, 'cash', 'user-1')).rejects.toThrow('مجموع پرداخت بیشتر از مبلغ فاکتور است');
    expect(update).not.toHaveBeenCalled();
  });

  it('records a partial payment atomically', async () => {
    const update = vi.fn(async () => ({ id: 'invoice-1', paymentStatus: 'partial', paidAmount: 600n, items: [] }));
    const executeRaw = vi.fn(async () => 1);
    const tx = { invoice: { findUnique: vi.fn(async () => ({ id: 'invoice-1', number: 'INV-1', status: 'issued', paidAmount: 500n, total: 1000n, paymentStatus: 'unpaid', customerMobile: null })), update }, payments: { create: vi.fn() }, $executeRawUnsafe: executeRaw };
    const prisma = { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) };
    const result = await new InvoiceService(prisma as never).pay('invoice-1', 100, 'card', 'user-1');
    expect(result.data.paymentStatus).toBe('partial');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ paidAmount: 600n, paymentStatus: 'partial', paymentMethod: 'card' }) }));
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects a return greater than the purchased quantity', async () => {
    const tx = { invoice: { findUnique: vi.fn(async () => ({ status: 'issued', items: [{ id: 'line-1', quantity: 2, unitPrice: 100n, inventoryItemId: 'item-1' }] })) , }, returnRecord: { aggregate: vi.fn(async () => ({ _sum: { quantity: 2, refundAmount: 200n } })) } };
    const prisma = { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) };
    await expect(new InvoiceService(prisma as never).returnItems('invoice-1', { invoiceItemId: 'line-1', quantity: 1, reason: 'تعویض' }, 'user-1')).rejects.toThrow('تعداد مرجوعی بیشتر از تعداد خریداری‌شده است');
  });

  it('restocks a valid partial return inside the transaction', async () => {
    const inventoryUpdate = vi.fn(async () => ({ quantity: 6 }));
    const returnCreate = vi.fn(async () => ({ id: 'return-1', quantity: 1, refundAmount: 100n }));
    const tx = { invoice: { findUnique: vi.fn(async () => ({ id: 'invoice-1', status: 'issued', items: [{ id: 'line-1', quantity: 2, unitPrice: 100n, inventoryItemId: 'item-1' }] })) }, returnRecord: { aggregate: vi.fn(async () => ({ _sum: { quantity: 0, refundAmount: 0n } })), create: returnCreate }, inventoryItem: { update: inventoryUpdate }, inventoryTransaction: { create: vi.fn() } };
    const prisma = { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) };
    const result = await new InvoiceService(prisma as never).returnItems('invoice-1', { invoiceItemId: 'line-1', quantity: 1, reason: 'تعویض' }, 'user-1');
    expect(result.data.quantityAfter).toBe(6);
    expect(inventoryUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'item-1' }, data: { quantity: { increment: 1 } } }));
    expect(returnCreate).toHaveBeenCalledTimes(1);
  });

  it('restores all invoice quantities when voiding', async () => {
    const updates = vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, quantity: 4 }));
    const invoiceUpdate = vi.fn(async () => ({ id: 'invoice-1', status: 'voided', items: [] }));
    const tx = { inventoryItem: { update: updates }, inventoryTransaction: { create: vi.fn() }, invoice: { update: invoiceUpdate } };
    const prisma = { invoice: { findUnique: vi.fn(async () => ({ id: 'invoice-1', status: 'issued', number: 'INV-1', items: [{ inventoryItemId: 'item-1', quantity: 2 }, { inventoryItemId: 'item-2', quantity: 1 }] })) }, $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) };
    const result = await new InvoiceService(prisma as never).void('invoice-1', 'user-1');
    expect(result.data.status).toBe('voided');
    expect(updates).toHaveBeenCalledTimes(2);
    expect(invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'voided' }) }));
  });
});
