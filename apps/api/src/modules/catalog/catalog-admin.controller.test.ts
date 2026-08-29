import { describe, expect, it } from 'vitest';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { CatalogAdminController } from './catalog-admin.controller';

describe('CatalogAdminController access', () => {
  it('allows warehouse product lookup while keeping catalog writes manager-only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CatalogAdminController)).toEqual([
      'manager',
      'warehouse',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, CatalogAdminController.prototype.list)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, CatalogAdminController.prototype.create)).toEqual([
      'manager',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, CatalogAdminController.prototype.update)).toEqual([
      'manager',
    ]);
  });
});
