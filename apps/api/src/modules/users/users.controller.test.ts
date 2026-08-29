import { describe, expect, it, vi } from 'vitest';
import { UsersController } from './users.controller';

const request = { user: { id: 'admin-1' }, ip: '127.0.0.1' } as never;

describe('UsersController', () => {
  it('routes user list and activity', async () => {
    const list = vi.fn(async () => ({ ok: true, data: [] }));
    const activity = vi.fn(async () => ({
      ok: true,
      data: { user: {}, auditLogs: [], transactions: [], invoices: [] },
    }));
    const controller = new UsersController({ list, activity } as never);
    await controller.list();
    await controller.activity('user-1');
    expect(list).toHaveBeenCalled();
    expect(activity).toHaveBeenCalledWith('user-1');
  });

  it('routes user creation and update', async () => {
    const create = vi.fn(async () => ({ ok: true, data: { id: 'u1' } }));
    const update = vi.fn(async () => ({ ok: true, data: { id: 'u1' } }));
    const controller = new UsersController({ create, update } as never);
    await controller.create(
      { name: 'کاربر', username: 'user1', password: 'password123', role: 'seller' },
      request,
    );
    await controller.update('u1', { name: 'کاربر ویرایش‌شده' }, request);
    expect(create).toHaveBeenCalledWith(
      { name: 'کاربر', username: 'user1', password: 'password123', role: 'seller' },
      'admin-1',
      '127.0.0.1',
    );
    expect(update).toHaveBeenCalledWith('u1', { name: 'کاربر ویرایش‌شده' }, 'admin-1', '127.0.0.1');
  });
});
