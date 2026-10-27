import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ContentStudioService, studioDescendants, studioMedia } from './content-studio.service';
import { ContentStudioController } from './content-studio.controller';
import { StudioSnapshotDto } from './content-studio.dto';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { hasRoleAccess } from '../../common/auth/role-policy';
const row = {
  id: 'p',
  name: 'آبگیر',
  code: 'P',
  category: { name: 'آبگیر' },
  availabilityOverride: null,
  images: [{ path: '/uploads/products/a/large.webp' }],
  compatibilities: [{ model: { name: '۲۰۶', make: { name: 'پژو' } }, trim: { name: 'تیپ ۵' } }],
  inventoryItems: [
    {
      id: 'v',
      quantity: 3,
      salePrice: 1250000n,
      purchasePrice: 111n,
      barcode: 'private',
      brand: { name: 'ایساکو' },
    },
  ],
  supplier: 'private',
};
function make() {
  const prisma = {
    product: { findMany: vi.fn().mockResolvedValue([row]) },
    category: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'c', parentId: null },
        { id: 'child', parentId: 'c' },
      ]),
    },
    setting: {
      findMany: vi.fn().mockResolvedValue([
        {
          key: 'store.profile',
          value: {
            name: 'فروشگاه',
            phones: '۰۹۱۲',
            logoUrl: '/uploads/site/logo.png',
            botToken: 'private',
          },
        },
        { key: 'integrations.telegram', value: { link: 'https://t.me/shop', botToken: 'private' } },
      ]),
    },
  };
  return { prisma, service: new ContentStudioService(prisma as never) };
}
describe('content studio safety and snapshot', () => {
  it('is authenticated and restricted to management on both endpoints', () => {
    const guards = Reflect.getMetadata('__guards__', ContentStudioController) as { name: string }[];
    expect(guards.map((g) => g.name)).toEqual(['JwtAuthGuard', 'RolesGuard']);
    const roles = Reflect.getMetadata(ROLES_KEY, ContentStudioController);
    expect(roles).toEqual(['manager']);
    for (const role of ['seller', 'warehouse', 'accountant', 'wholesale'] as const)
      expect(hasRoleAccess(role, roles)).toBe(false);
    expect(hasRoleAccess('super_admin', roles)).toBe(true);
  });
  it('omits sale-price selection and strips all monetary/private fields when inquiry is selected', async () => {
    const { service, prisma } = make();
    const result = await service.snapshot(new StudioSnapshotDto());
    expect(result.products[0].variants[0].price).toBeNull();
    const query = prisma.product.findMany.mock.calls[0][0];
    expect(query.select.inventoryItems.select).not.toHaveProperty('salePrice');
    expect(query.select.inventoryItems.select).not.toHaveProperty('purchasePrice');
    expect(JSON.stringify(result)).not.toMatch(
      /purchasePrice|quantity|barcode|supplier|botToken|private|1250000/,
    );
    expect(query.where).toMatchObject({ status: 'active', deletedAt: null });
    expect(result.products[0].vehicles).toEqual(['پژو ۲۰۶ تیپ ۵']);
  });
  it('allows explicit export sale prices independently of site visibility, never exposing purchase cost', async () => {
    const { service } = make();
    const result = await service.snapshot({ ...new StudioSnapshotDto(), showPrices: true });
    expect(result.products[0].variants[0].price).toBe('1250000');
    expect(JSON.stringify(result)).not.toContain('purchasePrice');
    expect(result.branding).toMatchObject({ name: 'فروشگاه', telegram: 'https://t.me/shop' });
  });
  it('combines scoped filters, descendants, selected IDs and stock-only criteria', async () => {
    const { service, prisma } = make();
    await service.snapshot({
      ...new StudioSnapshotDto(),
      categoryId: 'c',
      vehicleMakeId: 'make',
      vehicleModelId: 'm',
      brandId: 'b',
      inStock: true,
      productIds: ['p'],
      q: 'آبگیر',
    });
    expect(prisma.product.findMany.mock.calls[0][0]).toMatchObject({
      take: 301,
      where: {
        categoryId: { in: ['c', 'child'] },
        id: { in: ['p'] },
        availabilityOverride: null,
        compatibilities: { some: { modelId: 'm', model: { makeId: 'make' } } },
        inventoryItems: { some: { isActive: true, brandId: 'b', quantity: { gt: 0 } } },
      },
    });
  });
  it('rejects oversized exports and an empty explicit selection instead of exporting everything', async () => {
    const { service, prisma } = make();
    await expect(service.snapshot({ ...new StudioSnapshotDto(), productIds: [] })).rejects.toThrow(
      'حداقل',
    );
    prisma.product.findMany.mockResolvedValue(Array.from({ length: 301 }, () => row));
    await expect(service.snapshot(new StudioSnapshotDto())).rejects.toThrow('۳۰۰');
  });
  it('rejects unknown categories, avoids recursion loops, and blocks external/path-traversal media', async () => {
    const { service } = make();
    await expect(
      service.snapshot({ ...new StudioSnapshotDto(), categoryId: 'unknown' }),
    ).rejects.toThrow('موجود نیست');
    expect(
      studioDescendants('a', [
        { id: 'a', parentId: 'b' },
        { id: 'b', parentId: 'a' },
      ]),
    ).toEqual(['a', 'b']);
    for (const value of [
      'https://evil.test/a.png',
      '/uploads/../.env',
      '//evil.test/x',
      'data:image/png,x',
    ])
      expect(studioMedia(value)).toBe('');
    expect(studioMedia('/uploads/site/a.webp')).toBe('/uploads/site/a.webp');
  });
  it('validates raw booleans rather than converting string false into an opt-in to publish prices', async () => {
    const bad = plainToInstance(
      StudioSnapshotDto,
      { showPrices: 'false' },
      { enableImplicitConversion: true },
    );
    expect(await validate(bad)).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(
          StudioSnapshotDto,
          { showPrices: true, inStock: false },
          { enableImplicitConversion: true },
        ),
      ),
    ).toHaveLength(0);
  });
});
