import type { UserRole } from '@salimvand/shared';
import type { AdminPage } from './admin-route';

const allRoles: UserRole[] = [
  'super_admin',
  'manager',
  'seller',
  'warehouse',
  'accountant',
  'wholesale',
];

export const pageRoles: Record<AdminPage, readonly UserRole[]> = {
  dashboard: allRoles,
  analytics: ['super_admin', 'manager'],
  products: ['super_admin', 'manager'],
  wholesale: ['super_admin', 'manager', 'wholesale'],
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
    canBackup: isManager,
  };
}

/**
 * Capabilities of the unified «محصولات و انبار» screen. It is reachable by
 * managers AND warehouse operators (#/inventory), but the API keeps product
 * writes, the placement tree and the report exports manager-only — the list
 * hides exactly those actions instead of letting them fail with 403.
 */
export function catalogCapabilities(role: UserRole | '') {
  const isManager = role === 'manager' || role === 'super_admin';
  return {
    /** Create/edit/delete products, SEO keywords regeneration, backup & restore. */
    canManageProducts: isManager,
    /** Writes on the placement tree (انبار/قفسه/سبد). */
    canManagePlacements: isManager,
    /** CSV + accounting exports (ReportsController roles: manager, accountant). */
    canExportReports: isManager || role === 'accountant',
    /** Stock adjustments, bulk price changes and the item card. */
    canAdjustStock: isManager || role === 'warehouse',
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
