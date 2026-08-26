import { UserRole } from '@salimvand/shared';

export function hasRoleAccess(actual: UserRole | undefined, required: UserRole[]): boolean {
  return Boolean(actual && (actual === 'super_admin' || actual === 'manager' || required.includes(actual)));
}
