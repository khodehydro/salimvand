import { describe, expect, it, vi } from 'vitest';
import { CustomersController } from './customers.controller';

const request = { user: { id: 'user-1' }, ip: '127.0.0.1' } as never;

describe('CustomersController', () => {
  it('routes list, detail, and debtors', async () => {
    const list = vi.fn(async (search?: string) => ({ ok: true, data: [{ search }] }));
    const get = vi.fn(async (id: string) => ({ ok: true, data: { id, debt: 500n } }));
    const debtors = vi.fn(async () => ({ ok: true, data: [{ id: 'customer-1', debt: 500n }] }));
    const controller = new CustomersController({ list, get, debtors } as never);
    await expect(controller.list('علی')).resolves.toEqual({ ok: true, data: [{ search: 'علی' }] });
    await expect(controller.get('customer-1')).resolves.toEqual({ ok: true, data: { id: 'customer-1', debt: 500n } });
    await expect(controller.debtors()).resolves.toEqual({ ok: true, data: [{ id: 'customer-1', debt: 500n }] });
    expect(list).toHaveBeenCalledWith('علی');
    expect(get).toHaveBeenCalledWith('customer-1');
  });

  it('routes customer creation, update, and payment with actor context', async () => {
    const create = vi.fn(async () => ({ ok: true, data: { id: 'customer-1' } }));
    const update = vi.fn(async () => ({ ok: true, data: { id: 'customer-1', isActive: false } }));
    const payment = vi.fn(async () => ({ ok: true, data: { remainingDebt: 0n } }));
    const controller = new CustomersController({ create, update, payment } as never);
    const customer = { name: 'علی', mobile: '09120000000' };
    const paymentBody = { amount: '500', method: 'cash', invoiceId: 'invoice-1' };
    await expect(controller.create(customer, request)).resolves.toEqual({ ok: true, data: { id: 'customer-1' } });
    await expect(controller.update('customer-1', { isActive: false }, request)).resolves.toEqual({ ok: true, data: { id: 'customer-1', isActive: false } });
    await expect(controller.payment('customer-1', paymentBody, request)).resolves.toEqual({ ok: true, data: { remainingDebt: 0n } });
    expect(create).toHaveBeenCalledWith(customer, 'user-1', '127.0.0.1');
    expect(update).toHaveBeenCalledWith('customer-1', { isActive: false }, 'user-1', '127.0.0.1');
    expect(payment).toHaveBeenCalledWith('customer-1', paymentBody, 'user-1', '127.0.0.1');
  });
});
