import type { UserRole } from '@salimvand/shared';
import type { AdminPage } from './admin-route';

const allRoles: UserRole[] = ['super_admin', 'manager', 'seller', 'warehouse', 'accountant'];

export const pageRoles: Record<AdminPage, readonly UserRole[]> = {
  dashboard: allRoles,
  products: ['super_admin', 'manager'],
  invoices: ['super_admin', 'manager', 'seller', 'accountant'],
  customers: ['super_admin', 'manager', 'seller', 'accountant'],
  inventory: ['super_admin', 'manager', 'warehouse'],
  labels: ['super_admin', 'manager', 'warehouse'],
  purchases: ['super_admin', 'manager', 'accountant'],
  suppliers: ['super_admin', 'manager', 'accountant'],
  reports: ['super_admin', 'manager', 'accountant'],
  media: ['super_admin', 'manager'],
  references: ['super_admin', 'manager'],
  settings: ['super_admin', 'manager'],
  messaging: ['super_admin', 'manager'],
  users: ['super_admin'],
  audit: ['super_admin', 'manager'],
};

export function canAccessPage(role: UserRole | '', page: AdminPage): boolean {
  return Boolean(role && pageRoles[page].includes(role));
}

export function dashboardCapabilities(role: UserRole | '') {
  const isManager = role === 'manager' || role === 'super_admin';
  return {
    canViewSales: isManager || role === 'seller' || role === 'accountant',
    canViewInventory: isManager || role === 'warehouse',
    canViewProfit: isManager || role === 'accountant',
    canViewDebtors: isManager || role === 'seller' || role === 'accountant',
    canViewHealth: isManager,
    canNotify: isManager,
  };
}

export function customerCapabilities(role: UserRole | '') {
  return {
    canManage: role === 'seller' || role === 'manager' || role === 'super_admin',
    canPay:
      role === 'seller' || role === 'accountant' || role === 'manager' || role === 'super_admin',
  };
}

export function invoiceCapabilities(role: UserRole | '') {
  return {
    canCreate: role === 'seller' || role === 'manager' || role === 'super_admin',
    canPay:
      role === 'seller' || role === 'accountant' || role === 'manager' || role === 'super_admin',
    canResend:
      role === 'seller' || role === 'accountant' || role === 'manager' || role === 'super_admin',
    canVoid: role === 'manager' || role === 'super_admin',
  };
}
