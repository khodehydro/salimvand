import { describe, expect, it, vi } from 'vitest';
import { InvoiceController, PublicInvoiceController } from './invoice.controller';

const request = { user: { id: 'user-1' } } as never;

describe('InvoiceController', () => {
  it('routes invoice creation and payment to the service', async () => {
    const create = vi.fn(async () => ({ ok: true, data: { number: 'INV-1' } }));
    const pay = vi.fn(async () => ({ ok: true, data: { paymentStatus: 'paid' } }));
    const controller = new InvoiceController({ create, pay } as never);
    await expect(controller.create({ items: [{ inventoryItemId: 'item-1', quantity: 1, unitPrice: '100' }] }, request)).resolves.toEqual({ ok: true, data: { number: 'INV-1' } });
    await expect(controller.pay('invoice-1', { amount: '100', method: 'cash' }, request)).resolves.toEqual({ ok: true, data: { paymentStatus: 'paid' } });
    expect(create).toHaveBeenCalledWith({ items: [{ inventoryItemId: 'item-1', quantity: 1, unitPrice: '100' }] }, 'user-1');
    expect(pay).toHaveBeenCalledWith('invoice-1', '100', 'cash', 'user-1');
  });

  it('routes stock options, returns, and void operations', async () => {
    const options = vi.fn(async () => ({ ok: true, data: [] }));
    const returns = vi.fn(async () => ({ ok: true, data: { quantityAfter: 3 } }));
    const voidInvoice = vi.fn(async () => ({ ok: true, data: { status: 'voided' } }));
    const controller = new InvoiceController({ options, returnItems: returns, void: voidInvoice } as never);
    await expect(controller.options()).resolves.toEqual({ ok: true, data: [] });
    await expect(controller.returns('invoice-1', { invoiceItemId: 'line-1', quantity: 1, reason: 'تعویض' }, request)).resolves.toEqual({ ok: true, data: { quantityAfter: 3 } });
    await expect(controller.void('invoice-1', request)).resolves.toEqual({ ok: true, data: { status: 'voided' } });
    expect(returns).toHaveBeenCalledWith('invoice-1', { invoiceItemId: 'line-1', quantity: 1, reason: 'تعویض' }, 'user-1');
    expect(voidInvoice).toHaveBeenCalledWith('invoice-1', 'user-1');
  });

  it('routes public invoice reads', async () => {
    const getPublic = vi.fn(async (token: string) => ({ ok: true, data: { token } }));
    const controller = new InvoiceController({ getPublic } as never);
    await expect(controller.getPublic('short-code')).resolves.toEqual({ ok: true, data: { token: 'short-code' } });
  });
});

describe('PublicInvoiceController', () => {
  it('routes QR and short-code invoice requests', async () => {
    const qr = vi.fn(async (code: string) => ({ ok: true, data: { code } }));
    const getPublic = vi.fn(async (code: string) => ({ ok: true, data: { code } }));
    const controller = new PublicInvoiceController({ qr, getPublic } as never);
    await expect(controller.qr('ABC123')).resolves.toEqual({ ok: true, data: { code: 'ABC123' } });
    await expect(controller.getShort('ABC123')).resolves.toEqual({ ok: true, data: { code: 'ABC123' } });
    expect(qr).toHaveBeenCalledWith('ABC123');
    expect(getPublic).toHaveBeenCalledWith('ABC123');
  });
});
