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
    const decrements = vi.fn(async () => ({ count: 1 }));
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
      { inventoryItemId: 'item-1', quantity: 2, unitPrice: 100n },
      { inventoryItemId: 'item-2', quantity: 1, unitPrice: 200n },
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
      { inventoryItemId: 'item-1', quantity: 2, unitPrice: 100n },
      { inventoryItemId: 'item-2', quantity: 1, unitPrice: 200n },
    ] }, 'user-1')).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_STOCK' } });
    expect(invoiceCreate).not.toHaveBeenCalled();
    expect(tx.inventoryItem.updateMany).toHaveBeenCalledTimes(2);
  });
});
