import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';

function makeService() {
  const prisma = {
    product: { findMany: vi.fn(), count: vi.fn() },
    category: { findMany: vi.fn() },
    vehicleMake: { findMany: vi.fn() },
    brand: { findMany: vi.fn() },
    setting: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { service: new CatalogService(prisma as never), prisma };
}

const row = {
  id: 'p1',
  code: 'P-1',
  slug: 'قاب-پژو',
  name: 'قاب ستون',
  description: null,
  seoTitle: null,
  seoDescription: null,
  status: 'active',
  availabilityOverride: null,
  category: { name: 'داخلی', slug: 'dakheli' },
  images: [],
  inventoryItems: [{ quantity: 3, minStock: null, brand: { name: 'اصلی' } }],
  compatibilities: [],
};
/** Row shape used by the price-visibility tests. */
const pricedRow = {
  ...row,
  priceDisplay: 'inherit',
  inventoryItems: [
    { quantity: 3, minStock: null, salePrice: 1_800_000n, brand: { name: 'اصلی' } },
    { quantity: 1, minStock: null, salePrice: 1_500_000n, brand: { name: 'ایساکو' } },
  ],
};

describe('CatalogService', () => {
  it('applies filters and returns public stock metadata with pagination', async () => {
    const { service, prisma } = makeService();
    prisma.product.findMany.mockResolvedValue([row]);
    prisma.product.count.mockResolvedValue(25);
    const result = await service.listPublicProducts({
      q: 'قاب',
      brandId: 'b1',
      inStock: true,
      page: 2,
      pageSize: 100,
    });
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 50,
        take: 50,
        where: expect.objectContaining({
          status: 'active',
          deletedAt: null,
          inventoryItems: expect.objectContaining({
            some: expect.objectContaining({ brandId: 'b1', quantity: { gt: 0 } }),
          }),
        }),
      }),
    );
    expect(result.data[0]).toMatchObject({
      slug: 'قاب-پژو',
      availability: 'in_stock',
      brands: [{ name: 'اصلی', inStock: true }],
    });
    expect(result.meta).toEqual({ page: 2, pageSize: 50, total: 25, totalPages: 1 });
  });
  it('marks a product low when stock reaches its public threshold', async () => {
    const { service, prisma } = makeService();
    prisma.product.findMany.mockResolvedValue([
      { ...row, inventoryItems: [{ quantity: 2, minStock: 2, brand: { name: 'اصلی' } }] },
    ]);
    prisma.product.count.mockResolvedValue(1);
    const result = await service.listPublicProducts({});
    expect(result.data[0].availability).toBe('low_stock');
  });
  it('returns out of stock when every active item is empty', async () => {
    const { service, prisma } = makeService();
    prisma.product.findMany.mockResolvedValue([
      { ...row, inventoryItems: [{ quantity: 0, brand: { name: 'اصلی' } }] },
    ]);
    prisma.product.count.mockResolvedValue(1);
    const result = await service.listPublicProducts({});
    expect(result.data[0].availability).toBe('out_of_stock');
  });
  it('never serializes internal inventory fields in the public contract', async () => {
    const { service, prisma } = makeService();
    prisma.product.findMany.mockResolvedValue([
      { ...row, inventoryItems: [{ quantity: 17, minStock: 4, brand: { name: 'اصلی' } }] },
    ]);
    prisma.product.count.mockResolvedValue(1);
    const result = await service.listPublicProducts({});
    const serialized = JSON.stringify(result.data[0]);
    expect(serialized).toContain('اصلی');
    expect(serialized).toContain('in_stock');
    expect(serialized).not.toContain('purchasePrice');
    expect(serialized).not.toContain('salePrice');
    expect(serialized).not.toContain('quantity');
    expect(serialized).not.toContain('minStock');
    expect(serialized).not.toContain('location');
    expect(serialized).not.toContain('inventoryItemId');
  });
  it('throws a not found error for an unknown slug', async () => {
    const { service, prisma } = makeService();
    prisma.product.findMany.mockResolvedValue([]);
    prisma.product.count.mockResolvedValue(0);
    await expect(service.getPublicProduct('unknown')).rejects.toBeInstanceOf(NotFoundException);
  });
});
describe('storefront price visibility', () => {
  it('hides prices by default even when the panel has sale prices', async () => {
    const { service, prisma } = makeService();
    prisma.setting.findMany.mockResolvedValue([]);
    prisma.product.findMany.mockResolvedValue([pricedRow]);
    prisma.product.count.mockResolvedValue(1);

    const result = await service.listPublicProducts({});
    expect(result.data[0].price).toBeNull();
  });

  it('exposes the cheapest active brand price when the site-wide switch is on', async () => {
    const { service, prisma } = makeService();
    prisma.setting.findMany.mockResolvedValue([
      { key: 'store.pricing', value: { showPrices: true } },
    ]);
    prisma.product.findMany.mockResolvedValue([pricedRow]);
    prisma.product.count.mockResolvedValue(1);

    const result = await service.listPublicProducts({});
    expect(result.data[0].price).toBe('1500000');
  });

  it('lets a single product hide its price while prices are globally on', async () => {
    const { service, prisma } = makeService();
    prisma.setting.findMany.mockResolvedValue([
      { key: 'store.pricing', value: { showPrices: true } },
    ]);
    prisma.product.findMany.mockResolvedValue([{ ...pricedRow, priceDisplay: 'hide' }]);
    prisma.product.count.mockResolvedValue(1);

    const result = await service.listPublicProducts({});
    expect(result.data[0].price).toBeNull();
  });

  it('lets a single product show its price while prices are globally off', async () => {
    const { service, prisma } = makeService();
    prisma.setting.findMany.mockResolvedValue([]);
    prisma.product.findMany.mockResolvedValue([{ ...pricedRow, priceDisplay: 'show' }]);
    prisma.product.count.mockResolvedValue(1);

    const result = await service.listPublicProducts({});
    expect(result.data[0].price).toBe('1500000');
  });

  it('returns null price for products without active inventory items', async () => {
    const { service, prisma } = makeService();
    prisma.setting.findMany.mockResolvedValue([
      { key: 'store.pricing', value: { showPrices: true } },
    ]);
    prisma.product.findMany.mockResolvedValue([{ ...pricedRow, inventoryItems: [] }]);
    prisma.product.count.mockResolvedValue(1);

    const result = await service.listPublicProducts({});
    expect(result.data[0].price).toBeNull();
  });

  it('reports the pricing switch on the public meta payload', async () => {
    const { service, prisma } = makeService();
    prisma.setting.findMany.mockResolvedValue([
      { key: 'store.pricing', value: { showPrices: true } },
    ]);

    const meta = await service.meta();
    expect(meta.data.pricing).toEqual({ showPrices: true });
  });
});
