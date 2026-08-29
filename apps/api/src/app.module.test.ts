import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { SystemController } from './system.controller';

describe('SystemController readiness', () => {
  it('requires both PostgreSQL and Redis to be ready', async () => {
    const database = vi.fn(async () => [{ ok: 1 }]);
    const queue = vi.fn(async () => true);
    const controller = new SystemController({ $queryRaw: database } as never, { checkQueueConnection: queue } as never);
    await expect(controller.readiness()).resolves.toEqual({ ok: true, data: { service: 'api', database: 'ready', queue: 'ready' } });
    expect(database).toHaveBeenCalledTimes(1);
    expect(queue).toHaveBeenCalledTimes(1);
  });

  it('reports a degraded queue without taking the API offline when Redis is not ready', async () => {
    const controller = new SystemController({ $queryRaw: vi.fn(async () => [{ ok: 1 }]) } as never, { checkQueueConnection: vi.fn(async () => { throw new Error('redis unavailable'); }) } as never);
    await expect(controller.readiness()).resolves.toEqual({ ok: true, data: { service: 'api', database: 'ready', queue: 'degraded' } });
  });

  it('returns service unavailable when PostgreSQL is not ready', async () => {
    const queue = vi.fn(async () => true);
    const controller = new SystemController({ $queryRaw: vi.fn(async () => { throw new Error('database unavailable'); }) } as never, { checkQueueConnection: queue } as never);
    await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(queue).not.toHaveBeenCalled();
  });
});
