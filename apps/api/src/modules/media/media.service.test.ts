import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp = require('sharp');

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    // mkdir stays real so `upload` can write the processed webp files into a
    // temporary directory; only the library-facing helpers stay deterministic.
    ...actual,
    readdir: vi.fn(async () => ['logo-ab12cd34.png', 'favicon-99aa88bb.ico', 'notes.txt']),
    rm: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
});

import { MediaService } from './media.service';

// Real upload root for the sharp pipeline. UPLOAD_DIR is read when a service
// is constructed, and every construction below happens inside a test body —
// i.e. after this module-level assignment.
const uploadDir = mkdtempSync(join(tmpdir(), 'salimvand-media-test-'));
process.env.UPLOAD_DIR = uploadDir;
afterAll(() => {
  rmSync(uploadDir, { recursive: true, force: true });
});

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

  it('keeps a new image non-primary when the product already has a primary image', async () => {
    (prisma.productImage.create as ReturnType<typeof vi.fn>).mockClear();
    const service = new MediaService(prisma as never);
    await service.addFromUrl('p1', 'https://cdn.example.com/second.webp');
    expect(prisma.productImage.create).toHaveBeenCalledTimes(1);
    expect(prisma.productImage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPrimary: false }) }),
    );
  });
});

describe('MediaService first image of an imageless product', () => {
  // No existing primary image: productImage.findFirst (the primary lookup)
  // returns null, so the attached image must become the primary one.
  const baseProduct = {
    id: 'p9',
    code: 'BRK-9',
    slug: 'no-image',
    name: 'محصول بدون تصویر',
    categoryId: 'c1',
    status: 'active',
    availabilityOverride: null,
    priceDisplay: 'inherit',
    partNumber: null,
    description: null,
    updatedAt: new Date('2026-09-17T00:00:00Z'),
  };
  // Path of the image the create mock last registered —
  // publishProductImageChange runs after the create, so the product query
  // reflects the new primary image.
  let createdPath = '';
  const create = vi.fn(async (args: { data: { path: string } & Record<string, unknown> }) => {
    createdPath = args.data.path;
    return { id: 'img-new', productId: 'p9', ...args.data };
  });
  const prisma = {
    product: {
      findFirst: vi.fn(async () => ({
        ...baseProduct,
        images: [{ id: 'img-new', path: createdPath, alt: 'اولین تصویر' }],
      })),
    },
    productImage: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => ({
        id: 'src-1',
        path: 'https://cdn.example.com/src.webp',
        alt: 'منبع',
      })),
      create,
    },
    syncChange: { create: vi.fn(async () => ({})) },
  };

  beforeEach(() => {
    create.mockClear();
    (prisma.syncChange.create as ReturnType<typeof vi.fn>).mockClear();
  });

  /** The three acceptance criteria of the regression: the new image is
   * primary, a product SyncChange row is created, and its payload carries
   * the primary image's non-empty imageUrl. */
  const expectPrimaryImageSyncChange = () => {
    expect(prisma.syncChange.create).toHaveBeenCalledTimes(1);
    const call = (prisma.syncChange.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      data: {
        entityType: string;
        entityId: string;
        action: string;
        payload: { imageUrl: string };
      };
    };
    expect(call.data).toMatchObject({
      entityType: 'product',
      entityId: 'p9',
      action: 'updated',
    });
    expect(call.data.payload.imageUrl).toBe(
      /^https?:\/\//i.test(createdPath) ? createdPath : `https://salimvand.ir${createdPath}`,
    );
  };

  it('upload: makes the first image primary and publishes its imageUrl in a product sync change', async () => {
    const service = new MediaService(prisma as never);
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();
    const result = await service.upload(
      'p9',
      { buffer: png, mimetype: 'image/png', originalname: 'a.png' },
      'اولین تصویر',
    );
    expect(result.ok).toBe(true);
    expect(result.data.isPrimary).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPrimary: true }) }),
    );
    expectPrimaryImageSyncChange();
  });

  it('addFromUrl: makes the first image primary and publishes its imageUrl in a product sync change', async () => {
    const service = new MediaService(prisma as never);
    const result = await service.addFromUrl('p9', 'https://cdn.example.com/first.webp', 'اولین');
    expect(result.ok).toBe(true);
    expect(result.data.isPrimary).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isPrimary: true,
          path: 'https://cdn.example.com/first.webp',
        }),
      }),
    );
    expectPrimaryImageSyncChange();
  });

  it('selectExisting: makes the first image primary and publishes its imageUrl in a product sync change', async () => {
    const service = new MediaService(prisma as never);
    const result = await service.selectExisting('p9', 'src-1', 'اولین');
    expect(result.ok).toBe(true);
    expect(result.data.isPrimary).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isPrimary: true,
          path: 'https://cdn.example.com/src.webp',
        }),
      }),
    );
    expectPrimaryImageSyncChange();
  });
});
