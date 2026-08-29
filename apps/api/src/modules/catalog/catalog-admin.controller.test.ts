import { describe, expect, it } from 'vitest';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { CatalogAdminController } from './catalog-admin.controller';

describe('CatalogAdminController access', () => {
  it('keeps catalog administration manager-only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CatalogAdminController)).toEqual(['manager']);
  });
});
