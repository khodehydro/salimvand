import { describe, expect, it, vi } from 'vitest';
import { CatalogAdminService } from './catalog-admin.service';

function makeService() {
  const prisma = {
    product: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    inventoryItem: { create: vi.fn() },
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
    expect(result).toEqual({ ok: true, data: { id: 'p1' } });
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
        seoKeywords: ['لنت', 'ترمز'],
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
