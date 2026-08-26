import { describe, expect, it } from 'vitest';
import { hasRoleAccess } from './role-policy';

describe('role policy', () => {
  it('allows the exact role', () => expect(hasRoleAccess('warehouse', ['warehouse'])).toBe(true));
  it('allows managers, super admins, and explicitly permitted accountants', () => { expect(hasRoleAccess('manager', ['warehouse'])).toBe(true); expect(hasRoleAccess('super_admin', ['seller'])).toBe(true); expect(hasRoleAccess('accountant', ['manager', 'accountant'])).toBe(true); });
  it('does not mix operational roles', () => { expect(hasRoleAccess('warehouse', ['seller'])).toBe(false); expect(hasRoleAccess('accountant', ['warehouse'])).toBe(false); });
});
