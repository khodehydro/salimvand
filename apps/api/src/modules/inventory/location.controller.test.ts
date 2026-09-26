import { describe, expect, it, vi } from 'vitest';
import { LocationController } from './location.controller';
import { ROLES_KEY } from '../../common/auth/roles.decorator';

describe('LocationController', () => {
  it('lets warehouse staff read the list but keeps mutations manager-only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, LocationController.prototype.list)).toEqual([
      'manager',
      'warehouse',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, LocationController.prototype.create)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, LocationController.prototype.update)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, LocationController.prototype.remove)).toBeUndefined();
  });

  it('routes create/update/delete with the acting user', async () => {
    const list = vi.fn(async () => ({ ok: true, data: [] }));
    const create = vi.fn(async () => ({ ok: true }));
    const update = vi.fn(async () => ({ ok: true }));
    const remove = vi.fn(async () => ({ ok: true }));
    const controller = new LocationController({ list, create, update, remove } as never);
    const request = { user: { id: 'user-1' }, ip: '10.0.0.1' } as never;

    await controller.list();
    expect(list).toHaveBeenCalledTimes(1);

    // The mobile pickers ask for one level of the tree: the query is forwarded.
    await controller.list('basket', 'shelf-1');
    expect(list).toHaveBeenLastCalledWith({ type: 'basket', parentId: 'shelf-1' });

    await controller.create({ name: 'انبار دوم', code: 'W-02' }, request);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'انبار دوم',
        code: 'W-02',
        userId: 'user-1',
        ip: '10.0.0.1',
      }),
    );

    await controller.update('loc-1', { name: 'قفسه عقب' }, request);
    expect(update).toHaveBeenCalledWith(
      'loc-1',
      expect.objectContaining({ name: 'قفسه عقب', userId: 'user-1' }),
    );

    await controller.remove('loc-1', request);
    expect(remove).toHaveBeenCalledWith('loc-1', 'user-1', '10.0.0.1');
  });
});
