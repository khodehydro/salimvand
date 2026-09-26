import { describe, expect, it } from 'vitest';
import {
  buildCategorySyncPayload,
  buildCustomerSyncPayload,
  buildInventoryItemSyncPayload,
  buildInvoiceSyncPayload,
  buildLocationSyncPayload,
  buildProductSyncPayload,
  productImageUrl,
} from './sync-payloads';

const product = {
  id: 'p1',
  code: 'PRODUCT-00012',
  slug: 'lent-jolo-206',
  name: 'لنت ترمز جلو پژو ۲۰۶',
  categoryId: 'c1',
  status: 'active' as const,
  availabilityOverride: null,
  priceDisplay: 'inherit',
  partNumber: 'LP-206F',
  updatedAt: new Date('2026-09-17T10:00:00Z'),
  description: 'توضیح',
};

describe('sync payload builders (Android pull contract)', () => {
  it('shapes a product exactly like a bootstrap row plus image fields', () => {
    const payload = buildProductSyncPayload(product, {
      id: 'img-1',
      path: '/uploads/products/img-1/large.webp',
      alt: 'لنت',
    });
    expect(payload).toEqual({
      id: 'p1',
      code: 'PRODUCT-00012',
      slug: 'lent-jolo-206',
      name: 'لنت ترمز جلو پژو ۲۰۶',
      categoryId: 'c1',
      partNumber: 'LP-206F',
      description: 'توضیح',
      status: 'active',
      availabilityOverride: null,
      priceDisplay: 'inherit',
      updatedAt: '2026-09-17T10:00:00.000Z',
      image: { id: 'img-1', path: '/uploads/products/img-1/large.webp', alt: 'لنت' },
      imageUrl: 'https://salimvand.ir/uploads/products/img-1/large.webp',
      thumbUrl: 'https://salimvand.ir/uploads/products/img-1/small.webp',
    });
    expect(buildProductSyncPayload(product, null).imageUrl).toBeNull();
    expect(buildProductSyncPayload(product, null).thumbUrl).toBeNull();
  });

  it('thumbUrl falls back gracefully for remote and legacy image paths', () => {
    // Remote URLs have no small.webp variant — keep the original.
    expect(
      buildProductSyncPayload(product, {
        id: 'img-2',
        path: 'https://cdn.example.com/x/large.webp',
        alt: null,
      }).thumbUrl,
    ).toBe('https://cdn.example.com/x/large.webp');
    // Legacy pre-webp paths stay untouched instead of breaking.
    expect(
      buildProductSyncPayload(product, {
        id: 'img-3',
        path: '/uploads/products/old.jpg',
        alt: null,
      }).thumbUrl,
    ).toBe('https://salimvand.ir/uploads/products/old.jpg');
  });

  it('keeps inventory money string-exact and includes isActive', () => {
    expect(
      buildInventoryItemSyncPayload({
        id: 'i1',
        productId: 'p1',
        brandId: null,
        barcode: '6261234567890',
        quantity: 10,
        purchasePrice: 1850000n,
        salePrice: 2450000n,
        minStock: 3,
        locationId: null,
        basketId: null,
        isActive: true,
        priceUpdatedAt: null,
      }),
    ).toEqual({
      id: 'i1',
      productId: 'p1',
      brandId: null,
      barcode: '6261234567890',
      quantity: 10,
      purchasePrice: '1850000',
      salePrice: '2450000',
      minStock: 3,
      locationId: null,
      basketId: null,
      isActive: true,
      priceUpdatedAt: null,
      priceUpdatedAtJalali: null,
    });
  });

  it('ships the سبد (basket) with every inventory row so the app can address the part', () => {
    expect(
      buildInventoryItemSyncPayload({
        id: 'i3',
        productId: 'p1',
        brandId: 'b1',
        barcode: '6261234567899',
        quantity: 2,
        purchasePrice: 10n,
        salePrice: 20n,
        minStock: null,
        locationId: 'shelf-1',
        basketId: 'basket-4',
        isActive: true,
      }),
    ).toEqual(
      expect.objectContaining({
        id: 'i3',
        locationId: 'shelf-1',
        basketId: 'basket-4',
      }),
    );
    // Rows selected before the basket column existed must not crash the
    // audit path — they simply report «no basket».
    expect(
      buildInventoryItemSyncPayload({
        id: 'i4',
        productId: 'p1',
        brandId: null,
        barcode: '6261234567898',
        quantity: 1,
        purchasePrice: 0n,
        salePrice: 0n,
        minStock: null,
        locationId: 'shelf-1',
        isActive: true,
      }).basketId,
    ).toBeNull();
  });

  it('carries the sale-price stamp as ISO plus pre-formatted Shamsi', () => {
    const payload = buildInventoryItemSyncPayload({
      id: 'i2',
      productId: 'p1',
      brandId: null,
      barcode: '6261234567891',
      quantity: 4,
      purchasePrice: 1000000n,
      salePrice: 1300000n,
      minStock: null,
      locationId: null,
      isActive: true,
      priceUpdatedAt: new Date('2026-09-18T08:30:00.000Z'),
    });
    expect(payload.priceUpdatedAt).toBe('2026-09-18T08:30:00.000Z');
    // fa-IR persian calendar with Persian digits — the offline price badge
    // renders this string verbatim.
    expect(payload.priceUpdatedAtJalali).toMatch(
      /^[\u06F0-\u06F9]{4}\/[\u06F0-\u06F9]{2}\/[\u06F0-\u06F9]{2}$/,
    );
    expect(payload.priceUpdatedAtJalali).toBe(
      new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date('2026-09-18T08:30:00.000Z')),
    );
  });

  it('never leaks public token hashes from an invoice snapshot', () => {
    const payload = buildInvoiceSyncPayload(
      {
        id: 'inv-1',
        number: 'INV-000001',
        status: 'issued' as const,
        customerId: null,
        customerName: 'علی',
        customerMobile: '0912',
        subtotal: 100n,
        discount: 0n,
        discountPercent: 0,
        total: 100n,
        paymentStatus: 'unpaid' as const,
        paymentMethod: null,
        paidAmount: 0n,
        issuedAt: new Date('2026-09-17T10:00:00Z'),
        paidAt: null,
        voidedAt: null,
      },
      [
        {
          id: 'line-1',
          inventoryItemId: 'i1',
          productName: 'لنت',
          quantity: 1,
          unitPrice: 100n,
          lineTotal: 100n,
        },
      ],
    );
    expect(JSON.stringify(payload)).not.toContain('publicToken');
    expect(payload).toMatchObject({
      total: '100',
      items: [{ unitPrice: '100', lineTotal: '100' }],
    });
  });

  it('builds reference payloads for brand-like entities', () => {
    expect(
      buildCategorySyncPayload({
        id: 'c1',
        parentId: null,
        name: 'ترمز',
        slug: 'tarnez',
        code: 'BRK',
        sort: 2,
        isActive: true,
      }),
    ).toEqual({
      id: 'c1',
      parentId: null,
      name: 'ترمز',
      slug: 'tarnez',
      code: 'BRK',
      sort: 2,
      isActive: true,
    });
    expect(
      buildCustomerSyncPayload({
        id: 'cu1',
        name: 'علی',
        mobile: '0912',
        address: null,
        notes: null,
        isActive: true,
        updatedAt: new Date(0),
      }).updatedAt,
    ).toBe('1970-01-01T00:00:00.000Z');
    expect(
      buildLocationSyncPayload({
        id: 'l1',
        parentId: 'w1',
        type: 'shelf' as const,
        code: 'A-01',
        name: 'قفسه A1',
      }),
    ).toEqual({ id: 'l1', parentId: 'w1', type: 'shelf', code: 'A-01', name: 'قفسه A1' });
    expect(productImageUrl('https://cdn.example.com/x.webp')).toBe(
      'https://cdn.example.com/x.webp',
    );
    expect(productImageUrl('/uploads/products/x/large.webp')).toMatch(/^https:\/\//);
  });
});
