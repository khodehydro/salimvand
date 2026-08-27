import { describe, expect, it, vi } from 'vitest';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  it('rejects empty updates and unknown keys', async () => {
    const service = new SettingsService({} as never);
    await expect(service.update({}, 'manager-1')).rejects.toThrow('حداقل یک تنظیم لازم است');
    await expect(service.update({ 'secrets.jwt': 'never' }, 'manager-1')).rejects.toThrow('کلید تنظیمات مجاز نیست');
  });

  it('updates only allowed settings in a transaction', async () => {
    const upsert = vi.fn(async ({ where }: { where: { key: string } }) => ({ key: where.key, value: { enabled: true } }));
    const tx = { setting: { upsert, findMany: vi.fn(async () => [{ key: 'backup.schedule', value: { enabled: true } }]) } };
    const prisma = { setting: { findMany: vi.fn(async () => []) }, $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) };
    const result = await new SettingsService(prisma as never).update({ 'backup.schedule': { enabled: true } }, 'manager-1');
    expect(result).toEqual({ ok: true, data: { 'backup.schedule': { enabled: true } } });
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('returns null backup status when the status file is absent', async () => {
    const previous = process.env.BACKUP_STATUS_FILE;
    process.env.BACKUP_STATUS_FILE = '/tmp/salimvand-status-file-that-does-not-exist.json';
    await expect(new SettingsService({} as never).backupStatus()).resolves.toEqual({ ok: true, data: null });
    if (previous === undefined) delete process.env.BACKUP_STATUS_FILE; else process.env.BACKUP_STATUS_FILE = previous;
  });
});
