import { describe, expect, it } from 'vitest';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { DashboardController } from './dashboard.controller';

describe('DashboardController access', () => {
  it('exposes only role-relevant dashboard datasets', () => {
    expect(Reflect.getMetadata(ROLES_KEY, DashboardController)).toEqual([
      'seller',
      'warehouse',
      'accountant',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, DashboardController.prototype.summary)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, DashboardController.prototype.salesTrend)).toEqual([
      'seller',
      'accountant',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, DashboardController.prototype.inventoryTrend)).toEqual([
      'warehouse',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, DashboardController.prototype.profitTrend)).toEqual([
      'accountant',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, DashboardController.prototype.audit)).toEqual([
      'manager',
    ]);
  });
});
