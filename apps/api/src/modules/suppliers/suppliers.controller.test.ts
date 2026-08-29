import { describe, expect, it, vi } from 'vitest';
import { SuppliersController } from './suppliers.controller';
import { ROLES_KEY } from '../../common/auth/roles.decorator';

describe('SuppliersController', () => {
  it('keeps supplier writes manager-only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SuppliersController.prototype.create)).toEqual(['manager']);
    expect(Reflect.getMetadata(ROLES_KEY, SuppliersController.prototype.update)).toEqual(['manager']);
    expect(Reflect.getMetadata(ROLES_KEY, SuppliersController.prototype.remove)).toEqual(['manager']);
  });

  it('returns supplier debtors', async () => {
    const debtors = vi.fn(async () => ({ ok: true, data: [{ id: 'supplier-1', name: 'تأمین‌کننده', debt: 4000n, invoiceCount: 2 }] }));
    const controller = new SuppliersController({ debtors } as never);
    await expect(controller.debtors()).resolves.toEqual({ ok: true, data: [{ id: 'supplier-1', name: 'تأمین‌کننده', debt: 4000n, invoiceCount: 2 }] });
    expect(debtors).toHaveBeenCalledTimes(1);
  });

  it('returns the connected supplier account profile', async () => {
    const get = vi.fn(async (id: string) => ({ ok: true, data: { id, debt: 1200n, purchases: [] } }));
    const controller = new SuppliersController({ get } as never);
    await expect(controller.get('supplier-1')).resolves.toEqual({ ok: true, data: { id: 'supplier-1', debt: 1200n, purchases: [] } });
    expect(get).toHaveBeenCalledWith('supplier-1');
  });

  it('passes search to supplier listing', async () => {
    const list = vi.fn(async (search?: string) => ({ ok: true, data: [{ search }] }));
    const controller = new SuppliersController({ list } as never);
    await expect(controller.list('قطعه')).resolves.toEqual({ ok: true, data: [{ search: 'قطعه' }] });
    expect(list).toHaveBeenCalledWith('قطعه');
  });
});
