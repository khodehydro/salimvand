import { describe, expect, it, vi } from 'vitest';
import { SettingsController } from './settings.controller';

const request = { user: { id: 'manager-1' }, ip: '127.0.0.1' } as never;

describe('SettingsController', () => {
  it('routes settings list, backup status, and update', async () => {
    const list = vi.fn(async () => ({ ok: true, data: {} }));
    const backupStatus = vi.fn(async () => ({ ok: true, data: null }));
    const update = vi.fn(async (body, userId, ip) => ({ ok: true, data: { body, userId, ip } }));
    const controller = new SettingsController({ list, backupStatus, update } as never);
    await expect(controller.list()).resolves.toEqual({ ok: true, data: {} });
    await expect(controller.backupStatus()).resolves.toEqual({ ok: true, data: null });
    await expect(controller.update({ 'store.profile': { name: 'سلیم وند' } }, request)).resolves.toEqual({ ok: true, data: { body: { 'store.profile': { name: 'سلیم وند' } }, userId: 'manager-1', ip: '127.0.0.1' } });
    expect(update).toHaveBeenCalledWith({ 'store.profile': { name: 'سلیم وند' } }, 'manager-1', '127.0.0.1');
  });
});
