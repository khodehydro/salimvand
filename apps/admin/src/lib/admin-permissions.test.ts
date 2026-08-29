import { describe, expect, it } from 'vitest';
import { canAccessPage } from './admin-permissions';

describe('admin page permissions', () => {
  it('keeps sensitive system areas manager-only', () => {
    expect(canAccessPage('seller', 'settings')).toBe(false);
    expect(canAccessPage('warehouse', 'audit')).toBe(false);
    expect(canAccessPage('manager', 'audit')).toBe(true);
  });
  it('limits user administration to super admins', () => {
    expect(canAccessPage('manager', 'users')).toBe(false);
    expect(canAccessPage('super_admin', 'users')).toBe(true);
  });
  it('shows daily workspaces only to relevant roles', () => {
    expect(canAccessPage('warehouse', 'inventory')).toBe(true);
    expect(canAccessPage('warehouse', 'invoices')).toBe(false);
    expect(canAccessPage('accountant', 'purchases')).toBe(true);
    expect(canAccessPage('', 'dashboard')).toBe(false);
  });
});
