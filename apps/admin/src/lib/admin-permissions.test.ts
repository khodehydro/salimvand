import { describe, expect, it } from 'vitest';
import { canAccessPage, customerCapabilities, dashboardCapabilities, invoiceCapabilities } from './admin-permissions';

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
    expect(canAccessPage('seller', 'products')).toBe(false);
    expect(canAccessPage('manager', 'products')).toBe(true);
    expect(canAccessPage('accountant', 'purchases')).toBe(true);
    expect(canAccessPage('accountant', 'invoices')).toBe(true);
    expect(canAccessPage('', 'dashboard')).toBe(false);
  });
  it('shows each role only its permitted dashboard datasets', () => {
    expect(dashboardCapabilities('seller')).toMatchObject({ canViewSales: true, canViewInventory: false, canViewProfit: false, canViewDebtors: true, canViewHealth: false });
    expect(dashboardCapabilities('warehouse')).toMatchObject({ canViewSales: false, canViewInventory: true, canViewProfit: false, canViewDebtors: false });
    expect(dashboardCapabilities('accountant')).toMatchObject({ canViewSales: true, canViewInventory: false, canViewProfit: true, canViewDebtors: true });
    expect(dashboardCapabilities('manager')).toMatchObject({ canViewSales: true, canViewInventory: true, canViewProfit: true, canViewHealth: true, canNotify: true });
  });
  it('keeps customer account management separate from accounting payments', () => {
    expect(customerCapabilities('accountant')).toEqual({ canManage: false, canPay: true });
    expect(customerCapabilities('seller')).toEqual({ canManage: true, canPay: true });
    expect(customerCapabilities('warehouse')).toEqual({ canManage: false, canPay: false });
  });
  it('separates invoice read, issue, payment, and void capabilities', () => {
    expect(invoiceCapabilities('accountant')).toEqual({ canCreate: false, canPay: true, canResend: true, canVoid: false });
    expect(invoiceCapabilities('seller')).toEqual({ canCreate: true, canPay: true, canResend: true, canVoid: false });
    expect(invoiceCapabilities('manager').canVoid).toBe(true);
    expect(invoiceCapabilities('').canCreate).toBe(false);
  });
});
