import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from './catalog.service';
import { InvoiceService } from '../invoice/invoice.service';

/**
 * Contract guard required by the architecture doc (§4.2) and the delivery spec:
 * the public API surface must never expose prices, shelf/location, purchase
 * cost, stock counters or the issuing user.
 */
/** Catalog surface: even the stock counter is internal — only `availability` is public. */
const CATALOG_FORBIDDEN = [
  'purchasePrice',
  'salePrice',
  'minStock',
  'quantity',
  'location',
  'shelf',
  'barcode',
  'issuedBy',
  'inventoryItems',
] as const;

/** Invoice surface: quantities and unit prices belong to the customer. */
const INVOICE_FORBIDDEN = [
  'purchasePrice',
  'salePrice',
  'minStock',
  'location',
  'shelf',
  'barcode',
  'issuedBy',
  'inventoryItemId',
  'publicTokenHash',
  'publicShortCodeHash',
] as const;

function assertPublic(payload: unknown, forbidden: readonly string[] = CATALOG_FORBIDDEN) {
  const serialized = JSON.stringify(payload, (_key, value) => (typeof value === 'bigint' ? String(value) : value));
  for (const key of forbidden) {
    expect(serialized, `public payload leaked "${key}"`).not.toContain(`"${key}"`);
  }
  return serialized;
}

const productRow = {
  id: 'p1',
  code: 'BRK-00452',
  slug: 'لنت-۲۰۶',
  name: 'لنت ترمز جلو پژو ۲۰۶',
  description: null,
  seoTitle: null,
  seoDescription: null,
  status: 'active',
  availabilityOverride: null,
  category: { name: 'ترمز', slug: 'brake' },
  images: [{ path: '/uploads/p1.webp', alt: null, isPrimary: true }],
  // Prisma only selects public columns, but the serializer must stay safe even
  // if a future `select` widens: these fields must never reach the response.
  inventoryItems: [
    { quantity: 5, minStock: 2, brand: { name: 'ایساکو' }, purchasePrice: 900000n, salePrice: 1500000n, barcode: '626000123457', location: { code: 'A-03' } },
    { quantity: 0, minStock: 1, brand: { name: 'مهر' } },
  ],
  compatibilities: [{ model: { name: '۲۰۶', make: { name: 'پژو' } }, trim: { name: 'تیپ ۵' } }],
};

function makeCatalog() {
  const prisma = {
    product: { findMany: vi.fn(), count: vi.fn() },
    category: { findMany: vi.fn() },
    vehicleMake: { findMany: vi.fn() },
    brand: { findMany: vi.fn() },
    setting: { findMany: vi.fn() },
  };
  return { service: new CatalogService(prisma as never), prisma };
}

describe('public API contract — no internal data', () => {
  it('serialises the catalog without prices, counters, barcode or shelf', async () => {
    const { service, prisma } = makeCatalog();
    prisma.product.findMany.mockResolvedValue([productRow]);
    prisma.product.count.mockResolvedValue(1);

    const result = await service.listPublicProducts({ page: 1, pageSize: 12 });
    const serialized = assertPublic(result.data);

    expect(serialized).toContain('لنت ترمز جلو پژو ۲۰۶');
    expect(result.data[0]).toMatchObject({ availability: 'in_stock', brands: [{ name: 'ایساکو', inStock: true }, { name: 'مهر', inStock: false }] });
  });

  it('keeps the single-product route on the same public contract', async () => {
    const { service, prisma } = makeCatalog();
    prisma.product.findMany.mockResolvedValue([productRow]);
    prisma.product.count.mockResolvedValue(1);

    const result = await service.getPublicProduct('لنت-۲۰۶');
    assertPublic(result.data);
  });

  it('exposes store meta and filters without inventory internals', async () => {
    const { service, prisma } = makeCatalog();
    prisma.setting.findMany.mockResolvedValue([
      { key: 'store.profile', value: { name: 'سلیم‌وند', phones: '09123456789' } },
      { key: 'integrations.telegram', value: { link: 'https://t.me/salimvand' } },
      { key: 'integrations.bale', value: { link: 'https://ble.ir/salimvand' } },
    ]);
    prisma.category.findMany.mockResolvedValue([{ id: 'c1', name: 'ترمز', slug: 'brake', parentId: null }]);
    prisma.vehicleMake.findMany.mockResolvedValue([{ id: 'v1', name: 'پژو', models: [{ id: 'm1', name: '۲۰۶', trims: [{ id: 't1', name: 'تیپ ۵' }] }] }]);
    prisma.brand.findMany.mockResolvedValue([{ id: 'b1', name: 'ایساکو' }]);

    assertPublic(await service.meta());
    assertPublic(await service.listFilters());
  });

  it('serialises the public invoice without internal identifiers', async () => {
    const invoice = {
      id: 'inv-1',
      number: 'INV-0005',
      status: 'issued',
      publicTokenExpiresAt: new Date(Date.now() + 86_400_000),
      publicTokenHash: 'hash',
      customerName: 'علی محمدی',
      customerMobile: '09123456789',
      subtotal: 230_200_000n,
      discount: 1_500_000n,
      total: 228_700_000n,
      paymentStatus: 'partial',
      paymentMethod: 'card',
      paidAmount: 150_000_000n,
      paidAt: null,
      issuedAt: new Date(),
      voidedAt: null,
      items: [{ productName: 'لنت ترمز', quantity: 2, unitPrice: 18_500_000n, lineTotal: 37_000_000n, inventoryItemId: 'i1', inventoryItem: { brand: { name: 'ایساکو' } } }],
    };
    const prisma = { invoice: { findFirst: async () => invoice } };
    const result = await new InvoiceService(prisma as never).getPublic('short-code');

    const serialized = assertPublic(result.data, INVOICE_FORBIDDEN);
    expect(serialized).toContain('ایساکو');
    expect(serialized).toContain('لنت ترمز');
    expect(result.data).not.toHaveProperty('id');
    expect(result.data.items[0]).not.toHaveProperty('inventoryItemId');
  });
});
