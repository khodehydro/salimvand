import { describe, expect, it, vi } from 'vitest';
import { NotificationsController } from './notifications.controller';

describe('NotificationsController', () => {
  function setup() {
    const notifications = {
      enqueueTest: vi.fn(async (channel: string, message: string, mobile?: string) => ({ id: 'job-1', channel, message, mobile })),
      counts: vi.fn(async () => ({ waiting: 2, active: 1, completed: 4, failed: 0, delayed: 0 })),
      health: vi.fn(async () => ({ channels: {}, queue: { waiting: 2 } })),
      failed: vi.fn(async (limit: number) => [{ id: 'failed-1', attemptsMade: limit }]),
      retry: vi.fn(async (id: string) => id === 'failed-1'),
    };
    return { controller: new NotificationsController(notifications as never), notifications };
  }

  it('queues a guarded provider test message', async () => {
    const { controller, notifications } = setup();
    const result = await controller.test({ channel: 'telegram', message: 'پیام تست', mobile: undefined });
    expect(result).toEqual({ ok: true, data: { jobId: 'job-1', channel: 'telegram', queued: true } });
    expect(notifications.enqueueTest).toHaveBeenCalledWith('telegram', 'پیام تست', undefined);
  });

  it('returns the retry result for an existing or missing failed job', async () => {
    const { controller, notifications } = setup();
    await expect(controller.retry('failed-1')).resolves.toEqual({ ok: true, data: { retried: true } });
    await expect(controller.retry('missing')).resolves.toEqual({ ok: false, data: { retried: false } });
    expect(notifications.retry).toHaveBeenCalledWith('missing');
  });

  it('passes failed-job limit and exposes queue health', async () => {
    const { controller, notifications } = setup();
    await expect(controller.failed('25')).resolves.toEqual({ ok: true, data: [{ id: 'failed-1', attemptsMade: 25 }] });
    await expect(controller.health()).resolves.toEqual({ ok: true, data: { channels: {}, queue: { waiting: 2 } } });
    expect(notifications.failed).toHaveBeenCalledWith(25);
    expect(notifications.health).toHaveBeenCalledTimes(1);
  });

  it('returns queue counts', async () => {
    const { controller } = setup();
    await expect(controller.queue()).resolves.toEqual({ ok: true, data: { waiting: 2, active: 1, completed: 4, failed: 0, delayed: 0 } });
  });
});
