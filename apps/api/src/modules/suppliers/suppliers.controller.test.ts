import { describe, expect, it, vi } from 'vitest';
import { SuppliersController } from './suppliers.controller';

describe('SuppliersController', () => {
  it('returns supplier debtors', async () => {
    const debtors = vi.fn(async () => ({ ok: true, data: [{ id: 'supplier-1', name: 'تأمین‌کننده', debt: 4000n, invoiceCount: 2 }] }));
    const controller = new SuppliersController({ debtors } as never);
    await expect(controller.debtors()).resolves.toEqual({ ok: true, data: [{ id: 'supplier-1', name: 'تأمین‌کننده', debt: 4000n, invoiceCount: 2 }] });
    expect(debtors).toHaveBeenCalledTimes(1);
  });

  it('passes search to supplier listing', async () => {
    const list = vi.fn(async (search?: string) => ({ ok: true, data: [{ search }] }));
    const controller = new SuppliersController({ list } as never);
    await expect(controller.list('قطعه')).resolves.toEqual({ ok: true, data: [{ search: 'قطعه' }] });
    expect(list).toHaveBeenCalledWith('قطعه');
  });
});
