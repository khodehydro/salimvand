import { describe, expect, it } from 'vitest';
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
});
