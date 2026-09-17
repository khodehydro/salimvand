import { describe, expect, it, vi } from 'vitest';
import { CatalogAdminService } from './catalog-admin.service';

const CATEGORY_ID = 'ca7e9000-0000-4000-8000-000000000001';
const BRAND_ID = 'b0a5d000-0000-4000-8000-000000000001';
const LOCATION_ID = '10ca7e00-0000-4000-8000-000000000001';
const PRODUCT_ID = '9a0e5000-0000-4000-8000-000000000001';
const ITEM_ID = '17a0e000-0000-4000-8000-000000000001';

const CATEGORY = { id: CATEGORY_ID, isActive: true };
const BRAND = { id: BRAND_ID, isActive: true };
const LOCATION = { id: LOCATION_ID };
const INVENTORY_ITEM = {
  id: ITEM_ID,
  productId: PRODUCT_ID,
  brandId: BRAND_ID,
  barcode: '6260000000123',
  quantity: 10,
  purchasePrice: 1850000n,
  salePrice: 2450000n,
  minStock: 3,
  locationId: LOCATION_ID,
  isActive: true,
};

function makeService() {
  const prisma = {
    product: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    category: { findUnique: vi.fn().mockResolvedValue(CATEGORY) },
    brand: { findUnique: vi.fn().mockResolvedValue(BRAND) },
    location: { findUnique: vi.fn().mockResolvedValue(LOCATION) },
    inventoryItem: {
      create: vi.fn().mockResolvedValue(INVENTORY_ITEM),
      update: vi.fn().mockResolvedValue(INVENTORY_ITEM),
      updateMany: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    inventoryTransaction: { create: vi.fn() },
    inventoryOperation: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
    productOperation: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
    counter: { upsert: vi.fn().mockResolvedValue({ lastValue: 12 }) },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
  };
  return { service: new CatalogAdminService(prisma as never), prisma };
}

describe('CatalogAdminService', () => {
  it('generates a stable slug and accepts manual SEO on create', async () => {
    const { service, prisma } = makeService();
    prisma.product.create.mockResolvedValue({ id: 'p1' });
    const result = await service.create({
      name: 'قاب ستون پژو ۲۰۶',
      categoryId: 'c1',
      slug: 'ghab-sotun-206',
      seoTitle: 'عنوان اختصاصی',
      seoDescription: 'توضیح اختصاصی',
    });
    expect(result).toEqual({ ok: true, data: { id: 'p1', inventoryItem: INVENTORY_ITEM } });
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: 'PRODUCT-00012',
        slug: 'ghab-sotun-206',
        seoTitle: 'عنوان اختصاصی',
        seoDescription: 'توضیح اختصاصی',
      }),
    });
  });
  it('does not overwrite manual SEO when the product name changes', async () => {
    const { service, prisma } = makeService();
    prisma.product.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.product.update.mockResolvedValue({ id: 'p1' });
    await service.update('p1', {
      name: 'نام جدید',
      seoTitle: 'عنوان مدیر',
      seoDescription: 'توضیح مدیر',
      slug: 'custom-slug',
    });
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: expect.objectContaining({
        name: 'نام جدید',
        seoTitle: 'عنوان مدیر',
        seoDescription: 'توضیح مدیر',
        slug: 'custom-slug',
      }),
    });
  });
  it('stores the Aparat video id, keywords and a hidden status on create', async () => {
    const { service, prisma } = makeService();
    prisma.product.create.mockResolvedValue({ id: 'p1' });
    await service.create({
      name: 'لنت ترمز',
      categoryId: 'c1',
      aparatVideoId: '9f3k2',
      seoKeywords: ['لنت', 'ترمز'],
      status: 'hidden',
    });
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        aparatVideoId: '9f3k2',
        seoKeywords: expect.arrayContaining(['لنت', 'ترمز']),
        status: 'hidden',
      }),
    });
  });
  it('rejects an unknown product status instead of writing it', async () => {
    const { service, prisma } = makeService();
    prisma.product.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.product.update.mockResolvedValue({ id: 'p1' });
    await expect(service.update('p1', { status: 'published' })).rejects.toThrow('وضعیت محصول');
    expect(prisma.product.update).not.toHaveBeenCalled();
    await service.update('p1', { status: 'hidden', aparatVideoId: 'abc12' });
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: expect.objectContaining({ status: 'hidden', aparatVideoId: 'abc12' }),
    });
  });
  it('soft deletes and restores products without physically removing them', async () => {
    const { service, prisma } = makeService();
    prisma.product.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.product.update.mockResolvedValue({ id: 'p1', status: 'hidden' });
    await service.softDelete('p1');
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { deletedAt: expect.any(Date), status: 'hidden' },
    });
    prisma.product.update.mockResolvedValue({ id: 'p1', status: 'active', deletedAt: null });
    await service.restore('p1');
    expect(prisma.product.update).toHaveBeenLastCalledWith({
      where: { id: 'p1' },
      data: { deletedAt: null, status: 'active' },
    });
  });
});
describe('storefront price visibility per product', () => {
  it('accepts show/hide overrides on create and defaults to inherit', async () => {
    const { service, prisma } = makeService();
    prisma.product.create.mockResolvedValue({ id: 'p1' });
    await service.create({ name: 'لنت', categoryId: 'c1', priceDisplay: 'show' });
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ priceDisplay: 'show' }),
    });

    await service.create({ name: 'دیفرانسیل', categoryId: 'c1' });
    expect(prisma.product.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ priceDisplay: 'inherit' }),
    });
  });

  it('rejects unknown price display values', async () => {
    const { service } = makeService();
    await expect(
      service.create({ name: 'لنت', categoryId: 'c1', priceDisplay: 'always' }),
    ).rejects.toThrow('نمایش قیمت باید inherit، show یا hide باشد');
  });

  it('persists the per-product override on update and leaves it untouched when absent', async () => {
    const { service, prisma } = makeService();
    prisma.product.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.product.update.mockResolvedValue({ id: 'p1' });

    await service.update('p1', { priceDisplay: 'hide' });
    expect(prisma.product.update).toHaveBeenLastCalledWith({
      where: { id: 'p1' },
      data: expect.objectContaining({ priceDisplay: 'hide' }),
    });

    await service.update('p1', { name: 'نام جدید' });
    const call = prisma.product.update.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> };
    expect(call.data).not.toHaveProperty('priceDisplay');
  });
});

describe('atomic product + inventory creation (mobile contract)', () => {
  it('creates the product, exactly one inventory line and an initial ledger entry in one transaction', async () => {
    const { service, prisma } = makeService();
    prisma.product.create.mockResolvedValue({
      id: PRODUCT_ID,
      name: 'لنت ترمز جلو پژو ۲۰۶',
      categoryId: CATEGORY_ID,
    });
    prisma.inventoryItem.create.mockResolvedValue({ ...INVENTORY_ITEM, quantity: 10 });
    const result = await service.create(
      {
        name: 'لنت ترمز جلو پژو ۲۰۶',
        categoryId: CATEGORY_ID,
        partNumber: 'LP-206F',
        status: 'active',
        inventory: {
          brandId: BRAND_ID,
          barcode: '6261234567890',
          purchasePrice: '1850000',
          salePrice: '2450000',
          minStock: 3,
          locationId: LOCATION_ID,
          initialQuantity: 10,
        },
      },
      'user-1',
      undefined,
      'android-op-0001',
    );
    // The result must let Android replace its local draft precisely.
    expect(result.data.inventoryItem).toMatchObject({
      id: ITEM_ID,
      barcode: '6260000000123',
      quantity: 10,
      purchasePrice: 1850000n,
      salePrice: 2450000n,
      minStock: 3,
      locationId: LOCATION_ID,
      brandId: BRAND_ID,
    });
    // One product + one stock line + one initial ledger row, no neutral line.
    expect(prisma.inventoryItem.create).toHaveBeenCalledTimes(1);
    expect(prisma.inventoryItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: PRODUCT_ID,
        brandId: BRAND_ID,
        barcode: '6261234567890',
        quantity: 10,
        minStock: 3,
        locationId: LOCATION_ID,
      }),
    });
    expect(prisma.inventoryTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        itemId: ITEM_ID,
        type: 'initial',
        quantityChange: 10,
        quantityAfter: 10,
        userId: 'user-1',
        operationId: 'android-op-0001',
      }),
    });
    expect(prisma.productOperation.create).toHaveBeenCalledWith({
      data: { operationId: 'android-op-0001', productId: PRODUCT_ID, type: 'product.create' },
    });
    expect(prisma.inventoryOperation.create).toHaveBeenCalledWith({
      data: { operationId: 'android-op-0001', itemId: ITEM_ID, type: 'product.create' },
    });
  });

  it('rejects an unknown brand, category or barcode instead of writing partial data', async () => {
    const { service, prisma } = makeService();
    prisma.brand.findUnique.mockResolvedValue(null);
    await expect(
      service.create({
        name: 'لنت',
        categoryId: CATEGORY_ID,
        inventory: { brandId: 'b0a5d000-0000-4000-8000-0000000000ff', salePrice: '100' },
      }),
    ).rejects.toThrow('برند نامعتبر است');
    prisma.brand.findUnique.mockResolvedValue(BRAND);
    prisma.category.findUnique.mockResolvedValue(null);
    await expect(
      service.create({
        name: 'لنت',
        categoryId: 'ca7e9000-0000-4000-8000-0000000000ff',
        inventory: { salePrice: '100' },
      }),
    ).rejects.toThrow('دسته‌بندی نامعتبر است');
    prisma.category.findUnique.mockResolvedValue(CATEGORY);
    prisma.inventoryItem.findUnique.mockResolvedValue({ id: 'other' });
    await expect(
      service.create({
        name: 'لنت',
        categoryId: CATEGORY_ID,
        inventory: { barcode: '6261234567890', salePrice: '100' },
      }),
    ).rejects.toThrow('این بارکد قبلاً برای قلم دیگری ثبت شده است');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('requires a user before recording an opening stock and rejects negative quantities', async () => {
    const { service } = makeService();
    await expect(
      service.create({ name: 'لنت', categoryId: CATEGORY_ID, inventory: { initialQuantity: 5 } }),
    ).rejects.toThrow('کاربر ثبت‌کنندهٔ موجودی الزامی است');
    await expect(
      service.create(
        { name: 'لنت', categoryId: CATEGORY_ID, inventory: { initialQuantity: -5 } },
        'u1',
      ),
    ).rejects.toThrow('موجودی اولیه باید عدد صحیح و غیرمنفی باشد');
  });

  it('is idempotent per operationId: a retried product.create replays the stored result', async () => {
    const { service, prisma } = makeService();
    prisma.product.create.mockResolvedValue({ id: PRODUCT_ID, name: 'لنت' });
    prisma.productOperation.findUnique.mockResolvedValue({
      operationId: 'android-op-0002',
      productId: PRODUCT_ID,
      type: 'product.create',
    });
    prisma.product.findUniqueOrThrow.mockResolvedValue({ id: PRODUCT_ID, name: 'لنت' });
    prisma.inventoryOperation.findUnique.mockResolvedValue({
      operationId: 'android-op-0002',
      itemId: ITEM_ID,
      type: 'product.create',
    });
    prisma.inventoryItem.findUnique.mockResolvedValue(INVENTORY_ITEM);
    const result = await service.create(
      {
        name: 'لنت',
        categoryId: CATEGORY_ID,
        inventory: { salePrice: '2450000', initialQuantity: 10 },
      },
      'user-1',
      undefined,
      'android-op-0002',
    );
    expect(result.data).toMatchObject({
      id: PRODUCT_ID,
      inventoryItem: { id: ITEM_ID, quantity: 10 },
    });
    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it('keeps the legacy neutral line for panel-only creation without an inventory object', async () => {
    const { service, prisma } = makeService();
    prisma.product.create.mockResolvedValue({ id: 'p1' });
    prisma.inventoryItem.create.mockResolvedValue({
      ...INVENTORY_ITEM,
      quantity: 0,
      brandId: null,
      purchasePrice: 0n,
      salePrice: 0n,
    });
    const result = await service.create({ name: 'فیلتر روغن', categoryId: 'c1' });
    expect(result.data.inventoryItem).toMatchObject({ quantity: 0, brandId: null });
    expect(prisma.inventoryItem.create).toHaveBeenCalledTimes(1);
    expect(prisma.inventoryTransaction.create).not.toHaveBeenCalled();
  });
});

describe('product.update with a nested inventory object', () => {
  it('updates product fields and stock-line metadata in one transaction without touching quantity', async () => {
    const { service, prisma } = makeService();
    prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, name: 'لنت' });
    prisma.product.update.mockResolvedValue({ id: PRODUCT_ID, name: 'لنت ترمز' });
    prisma.inventoryItem.findUnique.mockResolvedValue(INVENTORY_ITEM);
    prisma.inventoryItem.update.mockResolvedValue({
      ...INVENTORY_ITEM,
      salePrice: 2600000n,
      locationId: '10ca7e00-0000-4000-8000-000000000002',
    });
    const result = await service.update(
      PRODUCT_ID,
      {
        name: 'لنت ترمز',
        inventory: {
          itemId: ITEM_ID,
          salePrice: '2600000',
          locationId: '10ca7e00-0000-4000-8000-000000000002',
        },
      },
      'user-1',
      undefined,
      'android-op-0003',
    );
    expect(result.data.inventoryItem).toMatchObject({
      salePrice: 2600000n,
      locationId: '10ca7e00-0000-4000-8000-000000000002',
    });
    const updateCall = prisma.inventoryItem.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data).toEqual({
      salePrice: 2600000n,
      locationId: '10ca7e00-0000-4000-8000-000000000002',
    });
    expect(updateCall.data).not.toHaveProperty('quantity');
  });

  it('rejects an inventory item that belongs to another product', async () => {
    const { service, prisma } = makeService();
    prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID });
    prisma.inventoryItem.findUnique.mockResolvedValue({
      ...INVENTORY_ITEM,
      productId: '9a0e5000-0000-4000-8000-000000000009',
    });
    await expect(
      service.update(PRODUCT_ID, { inventory: { itemId: ITEM_ID, salePrice: '100' } }),
    ).rejects.toThrow('قلم موجودی متعلق به این محصول نیست');
  });

  it('rejects a duplicate barcode change against another line', async () => {
    const { service, prisma } = makeService();
    prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID });
    prisma.inventoryItem.findUnique.mockImplementation(
      async ({ where }: { where: { id?: string; barcode?: string } }) => {
        if (where.id === ITEM_ID) return INVENTORY_ITEM;
        if (where.barcode === '6269999999999')
          return { id: '17a0e000-0000-4000-8000-000000000002' };
        return null;
      },
    );
    await expect(
      service.update(PRODUCT_ID, { inventory: { itemId: ITEM_ID, barcode: '6269999999999' } }),
    ).rejects.toThrow('این بارکد قبلاً برای قلم دیگری ثبت شده است');
  });
});
