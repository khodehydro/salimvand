import { describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  readdir: vi.fn(async () => ['logo-ab12cd34.png', 'favicon-99aa88bb.ico', 'notes.txt']),
  rm: vi.fn(async () => undefined),
}));
vi.mock('sharp', () => ({ default: vi.fn() }));

import { MediaService } from './media.service';

describe('MediaService.uploadSiteAsset', () => {
  const file = (buffer: Buffer, mimetype = 'image/png') => ({
    buffer,
    mimetype,
    originalname: 'a.png',
  });

  it('rejects unknown asset kinds and invalid payloads', async () => {
    const service = new MediaService({} as never);
    await expect(service.uploadSiteAsset('banner', file(Buffer.from('x')))).rejects.toThrow(
      'نوع تصویر نامعتبر است',
    );
    await expect(service.uploadSiteAsset('logo', file(Buffer.alloc(0)))).rejects.toThrow(
      'فایل تصویر معتبر نیست',
    );
  });

  it('rejects formats that are not embeddable safely (SVG) and oversized files', async () => {
    const service = new MediaService({} as never);
    await expect(
      service.uploadSiteAsset('logo', file(Buffer.from('<svg/>'), 'image/svg+xml')),
    ).rejects.toThrow('فرمت مجاز');
    await expect(
      service.uploadSiteAsset('favicon', file(Buffer.alloc(950 * 1024))),
    ).rejects.toThrow('۹۰۰ کیلوبایت');
  });

  it('writes the asset under uploads/site and returns the public path', async () => {
    const service = new MediaService({} as never);
    const result = await service.uploadSiteAsset('logo', file(Buffer.from('png-bytes')));
    expect(result.ok).toBe(true);
    expect(result.data.path).toMatch(/^\/uploads\/site\/logo-[0-9a-f]{8}\.png$/);
  });

  it('lists site assets alongside product images and rejects unsafe names', async () => {
    const service = new MediaService({
      productImage: { findMany: vi.fn(async () => []) },
    } as never);
    const result = await service.list();
    const siteItems = result.data as Array<{ id: string; kind: string; label: string }>;
    expect(siteItems.map((item) => item.id)).toEqual([
      'site:logo-ab12cd34.png',
      'site:favicon-99aa88bb.ico',
    ]);
    expect(siteItems[0].label).toBe('لوگوی سایت');
    await expect(service.removeSiteAsset('../secrets.env')).rejects.toThrow('نام فایل نامعتبر است');
    await expect(service.removeSiteAsset('')).rejects.toThrow('نام فایل نامعتبر است');
    await expect(service.removeSiteAsset('a/b.png')).rejects.toThrow('نام فایل نامعتبر است');
  });

  it('clears the store.profile reference of a deleted site asset', async () => {
    const setting = {
      findUnique: vi.fn(async () => ({
        key: 'store.profile',
        value: { name: 'فروشگاه', logoUrl: '/uploads/site/logo-ab12cd34.png' },
      })),
      update: vi.fn(async () => ({})),
    };
    const service = new MediaService({ setting } as never);
    const result = await service.removeSiteAsset('logo-ab12cd34.png');
    expect(result.ok).toBe(true);
    expect(setting.update).toHaveBeenCalledTimes(1);
    const saved = (
      setting.update.mock.calls[0] as unknown as [{ data: { value: Record<string, unknown> } }]
    )[0].data.value;
    expect(saved.logoUrl).toBe('');
    expect(saved.name).toBe('فروشگاه');
  });

  it('leaves store.profile untouched when it does not reference the file', async () => {
    const setting = {
      findUnique: vi.fn(async () => ({
        key: 'store.profile',
        value: { name: 'فروشگاه', logoUrl: '/uploads/site/logo-other.png' },
      })),
      update: vi.fn(async () => ({})),
    };
    const service = new MediaService({ setting } as never);
    await service.removeSiteAsset('favicon-99aa88bb.ico');
    expect(setting.update).not.toHaveBeenCalled();
  });
});
describe('MediaService product image changes', () => {
  const product = {
    id: 'p1',
    code: 'BRK-1',
    slug: 'lent',
    name: 'لنت ترمز',
    categoryId: 'c1',
    status: 'active',
    availabilityOverride: null,
    priceDisplay: 'inherit',
    partNumber: null,
    updatedAt: new Date('2026-09-17T00:00:00Z'),
    images: [{ id: 'img-1', path: '/uploads/products/img-1/large.webp', alt: 'لنت' }],
  };
  const prisma = {
    product: { findFirst: vi.fn(async () => product) },
    productImage: {
      create: vi.fn(async () => ({
        id: 'img-2',
        productId: 'p1',
        path: 'https://cdn.example.com/x.webp',
      })),
      delete: vi.fn(async () => ({})),
      findFirst: vi.fn(async () => ({ id: 'img-1', productId: 'p1' })),
      findUnique: vi.fn(async () => ({ id: 'img-1', path: '/uploads/products/img-1/large.webp' })),
      update: vi.fn(async () => ({ id: 'img-1', isPrimary: true })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => [{ id: 'img-1' }, { id: 'img-2' }]),
    },
    syncChange: { create: vi.fn(async () => ({})) },
    // $transaction is called both with a callback (makePrimary) and with an
    // array of promises (reorder).
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
    ),
  };

  it('publishes a product sync change (with primary image) after attaching an image', async () => {
    const service = new MediaService(prisma as never);
    const result = await service.addFromUrl('p1', 'https://cdn.example.com/x.webp', 'لنت');
    expect(result.ok).toBe(true);
    expect(prisma.syncChange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: 'product',
        entityId: 'p1',
        action: 'updated',
        payload: expect.objectContaining({
          id: 'p1',
          imageUrl: 'https://salimvand.ir/uploads/products/img-1/large.webp',
        }),
      }),
    });
  });

  it('publishes a product sync change after removing, reordering or promoting images', async () => {
    (prisma.syncChange.create as ReturnType<typeof vi.fn>).mockClear();
    const service = new MediaService(prisma as never);
    await service.remove('p1', 'img-1');
    await service.reorder('p1', ['img-1', 'img-2']);
    await service.makePrimary('p1', 'img-1');
    expect(prisma.syncChange.create).toHaveBeenCalledTimes(3);
  });
});
