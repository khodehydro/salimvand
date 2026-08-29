import { describe, expect, it, vi } from 'vitest';
import { CustomersController } from './customers.controller';
import { CustomerPaymentMethod } from './customers.dto';
import { ROLES_KEY } from '../../common/auth/roles.decorator';

const request = { user: { id: 'user-1' }, ip: '127.0.0.1' } as never;

describe('CustomersController', () => {
  it('allows accountant reads and payments without customer or vehicle writes', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CustomersController)).toEqual(['seller', 'accountant']);
    expect(Reflect.getMetadata(ROLES_KEY, CustomersController.prototype.payment)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, CustomersController.prototype.create)).toEqual(['seller']);
    expect(Reflect.getMetadata(ROLES_KEY, CustomersController.prototype.addVehicle)).toEqual(['seller']);
  });

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
    const paymentBody = { amount: '500', method: CustomerPaymentMethod.cash, invoiceId: 'invoice-1' };
    await expect(controller.create(customer, request)).resolves.toEqual({ ok: true, data: { id: 'customer-1' } });
    await expect(controller.update('customer-1', { isActive: false }, request)).resolves.toEqual({ ok: true, data: { id: 'customer-1', isActive: false } });
    await expect(controller.payment('customer-1', paymentBody, request)).resolves.toEqual({ ok: true, data: { remainingDebt: 0n } });
    expect(create).toHaveBeenCalledWith(customer, 'user-1', '127.0.0.1');
    expect(update).toHaveBeenCalledWith('customer-1', { isActive: false }, 'user-1', '127.0.0.1');
    expect(payment).toHaveBeenCalledWith('customer-1', paymentBody, 'user-1', '127.0.0.1');
  });

  it('routes customer vehicles', async () => {
    const vehicles = vi.fn(async () => ({ ok: true, data: [] }));
    const addVehicle = vi.fn(async () => ({ ok: true, data: { id: 'v-1' } }));
    const removeVehicle = vi.fn(async () => ({ ok: true, data: { id: 'v-1' } }));
    const controller = new CustomersController({ vehicles, addVehicle, removeVehicle } as never);
    await controller.vehicles('customer-1');
    await controller.addVehicle('customer-1', { plate: '12-345-67' }, request);
    await controller.removeVehicle('customer-1', 'v-1', request);
    expect(vehicles).toHaveBeenCalledWith('customer-1');
    expect(addVehicle).toHaveBeenCalledWith('customer-1', { plate: '12-345-67' }, 'user-1');
    expect(removeVehicle).toHaveBeenCalledWith('customer-1', 'v-1', 'user-1');
  });
});
