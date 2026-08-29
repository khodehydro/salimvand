import type { UserRole } from '@salimvand/shared';
import type { AdminPage } from './admin-route';

const allRoles: UserRole[] = ['super_admin', 'manager', 'seller', 'warehouse', 'accountant'];

export const pageRoles: Record<AdminPage, readonly UserRole[]> = {
  dashboard: allRoles,
  products: allRoles,
  invoices: ['super_admin', 'manager', 'seller'],
  customers: ['super_admin', 'manager', 'seller', 'accountant'],
  inventory: ['super_admin', 'manager', 'warehouse'],
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
