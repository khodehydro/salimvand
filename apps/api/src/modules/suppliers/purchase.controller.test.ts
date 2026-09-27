import { describe, expect, it, vi } from 'vitest';
import { PurchaseController } from './purchase.controller';
import { SupplierPaymentMethod } from './purchase.dto';
import { ROLES_KEY } from '../../common/auth/roles.decorator';

const request = { user: { id: 'user-1' }, ip: '127.0.0.1' } as never;

describe('PurchaseController', () => {
  it('limits purchase creation to managers while keeping accounting actions available', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PurchaseController.prototype.create)).toEqual([
      'manager',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, PurchaseController.prototype.pay)).toBeUndefined();
  });

  it('routes purchase listing and detail', async () => {
    const list = vi.fn(async (supplierId?: string) => ({ ok: true, data: [{ supplierId }] }));
    const get = vi.fn(async (id: string) => ({ ok: true, data: { id, debt: 500n } }));
    const controller = new PurchaseController({ list, get } as never);
    await expect(controller.list('supplier-1')).resolves.toEqual({
      ok: true,
      data: [{ supplierId: 'supplier-1' }],
    });
    await expect(controller.get('purchase-1')).resolves.toEqual({
      ok: true,
      data: { id: 'purchase-1', debt: 500n },
    });
    expect(list).toHaveBeenCalledWith('supplier-1');
    expect(get).toHaveBeenCalledWith('purchase-1');
  });

  it('routes purchase creation with authenticated actor', async () => {
    const create = vi.fn(async () => ({ ok: true, data: { id: 'purchase-1' } }));
    const controller = new PurchaseController({ create } as never);
    const body = {
      supplierId: 'supplier-1',
      paidAmount: '100',
      lines: [{ inventoryItemId: 'item-1', quantity: 2, unitPrice: '50' }],
    };
    await expect(controller.create(body, request)).resolves.toEqual({
      ok: true,
      data: { id: 'purchase-1' },
    });
    expect(create).toHaveBeenCalledWith('supplier-1', body.lines, '100', 'user-1', '127.0.0.1');
  });

  it('routes supplier payment with method and notes', async () => {
    const pay = vi.fn(async () => ({ ok: true, data: { invoice: { paidAmount: 700n } } }));
    const controller = new PurchaseController({ pay } as never);
    const body = { amount: '300', method: SupplierPaymentMethod.transfer, notes: 'تسویه' };
    await expect(controller.pay('purchase-1', body, request)).resolves.toEqual({
      ok: true,
      data: { invoice: { paidAmount: 700n } },
    });
    expect(pay).toHaveBeenCalledWith(
      'purchase-1',
      '300',
      'transfer',
      'تسویه',
      'user-1',
      '127.0.0.1',
      undefined,
    );
  });
});
