import { describe, expect, it } from 'vitest';
import { InvoiceService } from './invoice.service';
import { matchesPublicToken } from './public-token';

describe('InvoiceService', () => {
  it('builds an immutable invoice draft with secure public token', () => { const draft = new InvoiceService().buildDraft('INV-0001', [{ inventoryItemId: 'i1', productName: 'قاب ستون', quantity: 2, unitPrice: 125000n }]); expect(draft).toMatchObject({ number: 'INV-0001', subtotal: 250000n, total: 250000n, items: [{ lineTotal: 250000n }] }); expect(matchesPublicToken(draft.publicToken, draft.publicTokenHash)).toBe(true); });
  it('keeps product name and unit price as invoice snapshots', () => { const line = { inventoryItemId: 'i1', productName: 'قاب اولیه', quantity: 1, unitPrice: 90000n }; const draft = new InvoiceService().buildDraft('INV-0002', [line]); line.productName = 'نام تغییرکرده'; line.unitPrice = 1n; expect(draft.items[0]).toMatchObject({ productName: 'قاب اولیه', unitPrice: 90000n, lineTotal: 90000n }); });
  it('rejects malformed or unsafe invoice drafts', () => { const service = new InvoiceService(); const line = { inventoryItemId: 'i1', productName: 'قطعه', quantity: 1, unitPrice: 100n }; expect(() => service.buildDraft('bad', [line])).toThrow(); expect(() => service.buildDraft('INV-0003', [])).toThrow(); expect(() => service.buildDraft('INV-0004', [line, line])).toThrow('قلم موجودی نمی‌تواند در چند ردیف تکرار شود'); });
});
