import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import AdmZip = require('adm-zip');
import { ProductsBackupService } from './products-backup.service';

/** In-memory Prisma double covering the exact subset the backup service
 * touches — enough to round-trip a real zip through export → import. */
type Row = Record<string, any>;

function makeDb() {
  const db: Record<string, Row[]> = {
    categories: [],
    brands: [],
    locations: [],
    makes: [],
    models: [],
    trims: [],
    products: [],
    productImages: [],
    compat: [],
    items: [],
    syncChanges: [],
    auditLogs: [],
  };
  const id = () => randomUUID();

  const relateProduct = (product: Row) => ({
    ...product,
    category: db.categories.find((c) => c.id === product.categoryId),
    images: db.productImages
      .filter((i) => i.productId === product.id)
      .sort((a, b) => a.sort - b.sort),
    compatibilities: db.compat
      .filter((c) => c.productId === product.id)
      .map((c) => ({
        ...c,
        model: {
          ...db.models.find((m) => m.id === c.modelId)!,
          make: db.makes.find((k) => k.id === db.models.find((m) => m.id === c.modelId)!.makeId)!,
        },
        trim: c.trimId ? db.trims.find((t) => t.id === c.trimId) : null,
      })),
    inventoryItems: db.items
      .filter((i) => i.productId === product.id)
      .map((i) => ({
        ...i,
        brand: i.brandId ? db.brands.find((b) => b.id === i.brandId) : null,
        location: i.locationId
          ? {
              ...db.locations.find((l) => l.id === i.locationId)!,
              parent:
                db.locations.find(
                  (l) => l.id === db.locations.find((x) => x.id === i.locationId)!.parentId,
                ) ?? null,
            }
          : null,
        basket: i.basketId
          ? {
              ...db.locations.find((l) => l.id === i.basketId)!,
              parent:
                db.locations.find(
                  (l) => l.id === db.locations.find((x) => x.id === i.basketId)!.parentId,
                ) ?? null,
            }
          : null,
      })),
  });

  const tx = {
    category: {
      findUnique: async ({ where }: any) =>
        db.categories.find((c) => c.code === where.code) ?? null,
      create: async ({ data }: any) => {
        const row = { id: id(), ...data };
        db.categories.push(row);
        return row;
      },
    },
    brand: {
      findUnique: async ({ where }: any) => db.brands.find((b) => b.name === where.name) ?? null,
      create: async ({ data }: any) => {
        const row = { id: id(), ...data };
        db.brands.push(row);
        return row;
      },
    },
    location: {
      findFirst: async ({ where }: any) =>
        db.locations.find(
          (l) =>
            l.code === where.code &&
            (where.parentId === undefined
              ? true
              : where.parentId === null
                ? l.parentId == null
                : l.parentId === where.parentId),
        ) ?? null,
      create: async ({ data }: any) => {
        const row = { id: id(), ...data };
        db.locations.push(row);
        return row;
      },
    },
    vehicleMake: {
      findUnique: async ({ where }: any) => db.makes.find((m) => m.name === where.name) ?? null,
      create: async ({ data }: any) => {
        const row = { id: id(), ...data };
        db.makes.push(row);
        return row;
      },
    },
    vehicleModel: {
      findUnique: async ({ where }: any) =>
        db.models.find(
          (m) => m.makeId === where.makeId_name.makeId && m.name === where.makeId_name.name,
        ) ?? null,
      create: async ({ data }: any) => {
        const row = { id: id(), ...data };
        db.models.push(row);
        return row;
      },
    },
    vehicleTrim: {
      findUnique: async ({ where }: any) =>
        db.trims.find(
          (t) => t.modelId === where.modelId_name.modelId && t.name === where.modelId_name.name,
        ) ?? null,
      create: async ({ data }: any) => {
        const row = { id: id(), ...data };
        db.trims.push(row);
        return row;
      },
    },
    product: {
      // include: { images } → materialized like Prisma would (the restore
      // pass reads restored.images[0] for the sync payload).
      findUnique: async ({ where, include }: any) => {
        const row =
          db.products.find((p) =>
            where.id
              ? p.id === where.id
              : where.code
                ? p.code === where.code
                : where.slug
                  ? p.slug === where.slug
                  : false,
          ) ?? null;
        return row && include ? relateProduct(row) : row;
      },
      create: async ({ data }: any) => {
        const row = { id: id(), createdAt: new Date(), updatedAt: new Date(), ...data };
        db.products.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = db.products.find((p) => p.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    productImage: {
      deleteMany: async ({ where }: any) => {
        db.productImages = db.productImages.filter((i) => i.productId !== where.productId);
      },
      create: async ({ data }: any) => {
        const row = { id: id(), ...data };
        db.productImages.push(row);
        return row;
      },
    },
    productVehicleCompat: {
      deleteMany: async ({ where }: any) => {
        db.compat = db.compat.filter((c) => c.productId !== where.productId);
      },
      create: async ({ data }: any) => {
        const row = { id: id(), ...data };
        db.compat.push(row);
        return row;
      },
    },
    inventoryItem: {
      findUnique: async ({ where }: any) =>
        db.items.find((i) => i.barcode === where.barcode) ?? null,
      create: async ({ data }: any) => {
        const row = { id: id(), ...data };
        db.items.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = db.items.find((i) => i.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    syncChange: {
      deleteMany: async ({ where }: any) => {
        db.syncChanges = db.syncChanges.filter((s) => s.entityId !== where.entityId);
      },
      create: async ({ data }: any) => {
        db.syncChanges.push({ id: id(), ...data });
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        db.auditLogs.push({ id: id(), ...data });
      },
    },
  };

  const prisma = {
    ...tx,
    product: {
      ...tx.product,
      findMany: async () => db.products.map(relateProduct),
    },
    category: { findMany: async () => db.categories },
    brand: { findMany: async () => db.brands },
    location: { findMany: async () => db.locations },
    vehicleMake: {
      findMany: async () =>
        db.makes.map((make) => ({
          ...make,
          models: db.models
            .filter((m) => m.makeId === make.id)
            .map((m) => ({ ...m, trims: db.trims.filter((t) => t.modelId === m.id) })),
        })),
    },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return { db, prisma };
}

/** Seeds a two-product shop: nested category, two brands, warehouse+shelf,
 * one vehicle model, images on disk (fake bytes), compat lines, stock lines
 * (one on a shelf, one brandless without a shelf). */
/** `withBasket` files the first stock line into a سبد so the archive has to
 * carry a three-level placement (انبار › قفسه › سبد). */
function seedShop(db: Record<string, Row[]>, uploadDir: string, withBasket = false) {
  const cat = {
    id: randomUUID(),
    parentId: null,
    name: 'لنت و سیستم ترمز',
    slug: 'brakes',
    code: 'BR',
    sort: 1,
    isActive: true,
  };
  const catChild = {
    id: randomUUID(),
    parentId: cat.id,
    name: 'لنت جلو',
    slug: 'brakes-front',
    code: 'BRF',
    sort: 2,
    isActive: true,
  };
  db.categories.push(cat, catChild);
  const isaco = { id: randomUUID(), name: 'ایساکو', isActive: true };
  const bosch = { id: randomUUID(), name: 'بوش', isActive: true };
  db.brands.push(isaco, bosch);
  const warehouse = {
    id: randomUUID(),
    parentId: null,
    type: 'warehouse',
    code: '1',
    name: 'انبار اصلی',
  };
  const shelf = {
    id: randomUUID(),
    parentId: warehouse.id,
    type: 'shelf',
    code: '1.1',
    name: '۱.۱',
  };
  // Two baskets with the SAME code under different shelves: the exporter must
  // keep them apart by path, not by code.
  const basket = {
    id: randomUUID(),
    parentId: shelf.id,
    type: 'basket',
    code: '2',
    name: 'سبد ۲',
  };
  const otherShelf = {
    id: randomUUID(),
    parentId: warehouse.id,
    type: 'shelf',
    code: '1.2',
    name: '۱.۲',
  };
  const twinBasket = {
    id: randomUUID(),
    parentId: otherShelf.id,
    type: 'basket',
    code: '2',
    name: 'سبد ۲ (قفسهٔ دیگر)',
  };
  db.locations.push(warehouse, shelf);
  if (withBasket) db.locations.push(otherShelf, basket, twinBasket);
  const peugeot = { id: randomUUID(), name: 'پژو' };
  const model206 = {
    id: randomUUID(),
    makeId: peugeot.id,
    name: '۲۰۶',
    productionFrom: 1998,
    productionTo: null,
  };
  db.makes.push(peugeot);
  db.models.push(model206);

  const imgBytes = Buffer.from('fake-webp-bytes-for-backup-test');
  require('node:fs').writeFileSync(join(uploadDir, 'a1b2c3d4.webp'), imgBytes);

  const p1 = {
    id: randomUUID(),
    code: '1001',
    slug: 'lent-tormoz-jolo',
    name: 'لنت ترمز جلو',
    categoryId: catChild.id,
    description: 'لنت اورجینال',
    specs: { material: 'نسوز' },
    partNumber: 'BL-1001',
    aparatVideoId: null,
    status: 'active',
    availabilityOverride: null,
    priceDisplay: 'inherit',
    seoTitle: null,
    seoDescription: null,
    seoKeywords: ['لنت', 'ترمز'],
    deletedAt: null,
  };
  const p2 = {
    id: randomUUID(),
    code: '1002',
    slug: 'filter-roghan',
    name: 'فیلتر روغن',
    categoryId: cat.id,
    description: null,
    specs: null,
    partNumber: 'OF-77',
    aparatVideoId: null,
    status: 'hidden',
    availabilityOverride: 'out_of_stock',
    priceDisplay: 'show',
    seoTitle: 'فیلتر روغن اورجینال',
    seoDescription: null,
    seoKeywords: [],
    deletedAt: new Date('2026-08-01T10:00:00Z'),
  };
  db.products.push(p1, p2);
  db.productImages.push({
    id: randomUUID(),
    productId: p1.id,
    path: '/uploads/products/a1b2c3d4.webp',
    alt: 'لنت جلو',
    sort: 0,
    isPrimary: true,
  });
  db.compat.push({ id: randomUUID(), productId: p1.id, modelId: model206.id, trimId: null });
  db.items.push(
    {
      id: randomUUID(),
      productId: p1.id,
      brandId: isaco.id,
      barcode: '1111111111111',
      quantity: 40,
      purchasePrice: BigInt(1500000),
      salePrice: BigInt(1850000),
      minStock: 5,
      locationId: shelf.id,
      // سبد — filed into a bin of that shelf (only in the withBasket fixture).
      basketId: withBasket ? basket.id : null,
      notes: 'قفسهٔ جلو',
      isActive: true,
      priceUpdatedAt: new Date('2026-09-01T08:30:00Z'),
    },
    {
      id: randomUUID(),
      productId: p2.id,
      brandId: null,
      barcode: '2222222222222',
      quantity: 0,
      purchasePrice: BigInt(700000),
      salePrice: BigInt(990000),
      minStock: null,
      locationId: null,
      notes: null,
      isActive: true,
      priceUpdatedAt: null,
    },
  );
  return { p1, p2, imgBytes, shelf, basket, otherShelf, twinBasket, warehouse };
}

const uploadDir = mkdtempSync(join(tmpdir(), 'salimvand-backup-test-'));
process.env.UPLOAD_DIR = uploadDir;
afterAll(() => {
  rmSync(uploadDir, { recursive: true, force: true });
});

describe('ProductsBackupService', () => {
  let service: ProductsBackupService;
  let db: Record<string, Row[]>;
  let prisma: ReturnType<typeof makeDb>['prisma'];

  beforeEach(() => {
    ({ db, prisma } = makeDb());
    seedShop(db, uploadDir);
    service = new ProductsBackupService(prisma as never);
  });

  it('exports a zip with manifest, full products, references and image bytes', async () => {
    const buffer = await service.buildBackup();
    const zip = new AdmZip(buffer);

    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    expect(manifest.format).toBe('salimvand-products-backup');
    expect(manifest.version).toBe(2);
    expect(manifest.counts).toMatchObject({ products: 2, images: 1, items: 2 });
    expect(manifest.counts.imageFiles).toBe(1);

    const products = JSON.parse(zip.readAsText('products.json'));
    expect(products).toHaveLength(2);
    const lent = products.find((p: Row) => p.code === '1001');
    expect(lent.name).toBe('لنت ترمز جلو');
    expect(lent.categoryCode).toBe('BRF');
    expect(lent.partNumber).toBe('BL-1001');
    expect(lent.images[0].file).toBe('images/a1b2c3d4.webp');
    expect(lent.compatibilities).toEqual([{ make: 'پژو', model: '۲۰۶', trim: null }]);
    expect(lent.items[0]).toMatchObject({
      barcode: '1111111111111',
      brandName: 'ایساکو',
      quantity: 40,
      purchasePrice: '1500000',
      salePrice: '1850000',
      locationCode: '1.1',
      locationParentCode: '1',
      priceUpdatedAt: '2026-09-01T08:30:00.000Z',
    });
    const filter = products.find((p: Row) => p.code === '1002');
    expect(filter.items[0].brandName).toBeNull();
    expect(filter.deletedAt).toBe('2026-08-01T10:00:00.000Z');

    const references = JSON.parse(zip.readAsText('references.json'));
    expect(references.categories.map((c: Row) => c.code)).toEqual(['BR', 'BRF']);
    expect(references.categories.find((c: Row) => c.code === 'BRF').parentCode).toBe('BR');
    expect(references.locations.find((l: Row) => l.code === '1.1').parentCode).toBe('1');
    expect(references.vehicles[0].models[0].name).toBe('۲۰۶');

    expect(zip.getEntry('images/a1b2c3d4.webp')?.getData().toString()).toBe(
      'fake-webp-bytes-for-backup-test',
    );
  });

  it('exports and restores new dir layout with large + small variants', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const dirId = 'img-dir-1234';
    const dirPath = join(uploadDir, dirId);
    mkdirSync(dirPath, { recursive: true });
    const largeBytes = Buffer.from('large-bytes');
    const smallBytes = Buffer.from('small-bytes');
    writeFileSync(join(dirPath, 'large.webp'), largeBytes);
    writeFileSync(join(dirPath, 'small.webp'), smallBytes);

    const product = db.products.find((p) => p.code === '1001')!;
    // Add a second image in new layout
    db.productImages.push({
      id: randomUUID(),
      productId: product.id,
      path: `/uploads/products/${dirId}/large.webp`,
      alt: 'تصویر جدید',
      sort: 1,
      isPrimary: false,
    });

    const buffer = await service.buildBackup();
    const zip = new AdmZip(buffer);
    expect(zip.getEntry(`images/${dirId}/large.webp`)?.getData().toString()).toBe('large-bytes');
    expect(zip.getEntry(`images/${dirId}/small.webp`)?.getData().toString()).toBe('small-bytes');

    // Wipe files
    rmSync(dirPath, { recursive: true, force: true });
    db.productImages = db.productImages.filter((img: Row) => !img.path.includes(dirId));
    db.products = [];
    db.productImages = [];
    db.compat = [];
    db.items = [];
    db.categories = [];
    db.brands = [];
    db.locations = [];
    db.makes = [];
    db.models = [];
    db.trims = [];

    // Re-seed minimal for import to work? No, we wiped all — but we need to re-seed from zip,
    // the zip we built after adding dir image contains both old and new images, so import should restore both.
    // However we cleared db.products etc. after building zip, so we need to rebuild zip with both images before wipe.
    // Actually we already built zip, so we wiped after. Now import.
    // For this test we need a fresh zip that includes the new layout — we already have buffer.
    // But we cleared the DB that the service's makeDb uses — the import will recreate categories etc. from references in zip.

    const summary = await service.importBackup(buffer, 'user-1');
    expect(summary.errors).toEqual([]);
    // Should have written at least 2 files for the new dir (large + small) plus the old flat one
    expect(summary.imagesWritten).toBeGreaterThanOrEqual(3);
    expect(existsSync(join(uploadDir, dirId, 'large.webp'))).toBe(true);
    expect(existsSync(join(uploadDir, dirId, 'small.webp'))).toBe(true);
    expect(readFileSync(join(uploadDir, dirId, 'large.webp')).toString()).toBe('large-bytes');
    expect(readFileSync(join(uploadDir, dirId, 'small.webp')).toString()).toBe('small-bytes');
  });

  it('round-trips: wipes the shop, imports the zip and restores everything', async () => {
    const buffer = await service.buildBackup();
    // Simulate the disaster: the catalog is gone (files too).
    db.products = [];
    db.productImages = [];
    db.compat = [];
    db.items = [];
    db.categories = [];
    db.brands = [];
    db.locations = [];
    db.makes = [];
    db.models = [];
    db.trims = [];
    rmSync(join(uploadDir, 'a1b2c3d4.webp'), { force: true });

    const summary = await service.importBackup(buffer, 'user-1', '127.0.0.1');
    expect(summary.errors).toEqual([]);
    expect(summary.productsCreated).toBe(2);
    expect(summary.categoriesCreated).toBe(2);
    expect(summary.brandsCreated).toBe(2);
    expect(summary.locationsCreated).toBe(2);
    expect(summary.vehicleModelsCreated).toBe(1);
    expect(summary.itemsCreated).toBe(2);
    expect(summary.imagesWritten).toBe(1);

    // The exact same code/slug/name come back, soft-deleted state included.
    const filter = db.products.find((p) => p.code === '1002')!;
    expect(filter.slug).toBe('filter-roghan');
    expect(filter.status).toBe('hidden');
    expect(filter.deletedAt).toEqual(new Date('2026-08-01T10:00:00Z'));
    // Shelf hierarchy restored: shelf 1.1 hangs off warehouse 1.
    const shelf = db.locations.find((l) => l.code === '1.1')!;
    const warehouse = db.locations.find((l) => l.code === '1')!;
    expect(shelf.parentId).toBe(warehouse.id);
    // Item restored with shelf + brand + prices + last-price date.
    const lentItem = db.items.find((i) => i.barcode === '1111111111111')!;
    expect(lentItem.quantity).toBe(40);
    expect(lentItem.locationId).toBe(shelf.id);
    expect(lentItem.salePrice).toBe(BigInt(1850000));
    expect(lentItem.priceUpdatedAt).toEqual(new Date('2026-09-01T08:30:00Z'));
    // Image file rewritten from the zip with identical bytes.
    expect(existsSync(join(uploadDir, 'a1b2c3d4.webp'))).toBe(true);
    expect(readFileSync(join(uploadDir, 'a1b2c3d4.webp')).toString()).toBe(
      'fake-webp-bytes-for-backup-test',
    );
    // Android sync change + one audit entry for the whole import.
    expect(db.syncChanges.filter((s) => s.entityType === 'product')).toHaveLength(2);
    expect(db.auditLogs).toHaveLength(1);
  });

  it('import never deletes and repairs damaged rows (upsert by code)', async () => {
    const buffer = await service.buildBackup();
    // Damage: renamed product, wrong quantity, plus an extra product that
    // must survive the import untouched.
    db.products.find((p) => p.code === '1001')!.name = 'خراب‌شده';
    db.items.find((i) => i.barcode === '1111111111111')!.quantity = 0;
    db.products.push({
      id: randomUUID(),
      code: '9999',
      slug: 'extra',
      name: 'محصول اضافی',
      categoryId: db.categories[0].id,
      status: 'active',
      priceDisplay: 'inherit',
      seoKeywords: [],
      deletedAt: null,
    });

    const summary = await service.importBackup(buffer, 'user-1');
    expect(summary.errors).toEqual([]);
    expect(summary.productsUpdated).toBe(2);
    expect(summary.productsCreated).toBe(0);
    expect(summary.itemsUpdated).toBe(2);
    expect(db.products.find((p) => p.code === '1001')!.name).toBe('لنت ترمز جلو');
    expect(db.items.find((i) => i.barcode === '1111111111111')!.quantity).toBe(40);
    expect(db.products.find((p) => p.code === '9999')).toBeTruthy();
    expect(db.products).toHaveLength(3);
  });

  it('restores every سبد: three-level placement survives the round trip', async () => {
    // Two baskets share the code «2» under different shelves — only the
    // exported path can tell them apart on restore.
    const fresh = makeDb();
    seedShop(fresh.db, uploadDir, true);
    const backupService = new ProductsBackupService(fresh.prisma as never);
    const buffer = await backupService.buildBackup();

    const zip = new AdmZip(buffer);
    const references = JSON.parse(zip.readAsText('references.json'));
    const exportedBaskets = references.locations.filter((l: Row) => l.type === 'basket');
    expect(exportedBaskets).toHaveLength(2);
    const exportedItem = JSON.parse(zip.readAsText('products.json')).find(
      (p: Row) => p.code === '1001',
    ).items[0];
    expect(exportedItem.basketCode).toBe('2');
    expect(exportedItem.basketPath).toEqual(['1', '1.1', '2']);
    expect(exportedItem.locationPath).toEqual(['1', '1.1']);

    // Disaster: wipe everything, then restore from the archive.
    for (const key of Object.keys(fresh.db)) fresh.db[key] = [];
    const summary = await backupService.importBackup(buffer, 'user-1');
    expect(summary.errors).toEqual([]);

    const shelf = fresh.db.locations.find((l) => l.code === '1.1')!;
    const restoredBasket = fresh.db.locations.find(
      (l) => l.type === 'basket' && l.parentId === shelf.id,
    )!;
    expect(restoredBasket).toBeTruthy();
    expect(restoredBasket.name).toBe('سبد ۲');
    // Both same-coded baskets came back, each under its own shelf.
    const baskets = fresh.db.locations.filter((l) => l.type === 'basket');
    expect(baskets).toHaveLength(2);
    expect(new Set(baskets.map((b) => b.parentId)).size).toBe(2);
    // The stock line is filed back into the right bin of the right shelf.
    const item = fresh.db.items.find((i) => i.barcode === '1111111111111')!;
    expect(item.locationId).toBe(shelf.id);
    expect(item.basketId).toBe(restoredBasket.id);
  });

  it('rejects non-zip payloads and archives with a wrong manifest', async () => {
    await expect(service.importBackup(Buffer.from('not a zip'), 'u')).rejects.toThrow('ZIP');
    const fake = new AdmZip();
    fake.addFile('manifest.json', Buffer.from('{"format":"other","version":9}'));
    await expect(service.importBackup(fake.toBuffer(), 'u')).rejects.toThrow('نسخهٔ فایل پشتیبان');
  });
});
