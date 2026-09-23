import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import AdmZip = require('adm-zip');
import { PrismaService } from '../../prisma.service';
import { buildProductSyncPayload } from '../../common/sync/sync-payloads';
import { writeAudit, writeSyncChange } from '../../common/audit/audit-log';

/** Backup format marker + version — bump when the zip layout changes so a
 * future importer can reject (or migrate) archives it does not understand. */
const BACKUP_FORMAT = 'salimvand-products-backup';
const BACKUP_VERSION = 1;

/** Plain file names only inside the images/ folder of the archive — blocks
 * path traversal (“../../.bashrc”) from a hand-crafted zip. */
const SAFE_FILE_NAME = /^[A-Za-z0-9._-]+$/;

type BackupProduct = {
  code: string;
  slug: string;
  name: string;
  categoryCode: string;
  categoryName: string;
  description: string | null;
  specs: unknown;
  partNumber: string | null;
  aparatVideoId: string | null;
  status: string;
  availabilityOverride: string | null;
  priceDisplay: string;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string[];
  deletedAt: string | null;
  images: Array<{
    path: string;
    file: string;
    alt: string | null;
    sort: number;
    isPrimary: boolean;
  }>;
  compatibilities: Array<{ make: string; model: string; trim: string | null }>;
  items: Array<{
    barcode: string;
    brandName: string | null;
    quantity: number;
    purchasePrice: string;
    salePrice: string;
    minStock: number | null;
    locationCode: string | null;
    locationParentCode: string | null;
    notes: string | null;
    isActive: boolean;
    priceUpdatedAt: string | null;
  }>;
};

type BackupReferences = {
  categories: Array<{
    code: string;
    name: string;
    slug: string;
    sort: number;
    isActive: boolean;
    parentCode: string | null;
  }>;
  brands: Array<{ name: string; isActive: boolean }>;
  locations: Array<{ code: string; name: string; type: string; parentCode: string | null }>;
  vehicles: Array<{
    make: string;
    models: Array<{
      name: string;
      productionFrom: number | null;
      productionTo: number | null;
      trims: string[];
    }>;
  }>;
};

export type ImportSummary = {
  productsCreated: number;
  productsUpdated: number;
  itemsCreated: number;
  itemsUpdated: number;
  imagesWritten: number;
  imagesMissing: number;
  categoriesCreated: number;
  brandsCreated: number;
  locationsCreated: number;
  vehicleModelsCreated: number;
  errors: string[];
};

@Injectable()
export class ProductsBackupService {
  private readonly uploadRoot =
    process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads', 'products');

  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────── EXPORT ─────────────────────────────

  /** Builds the full-catalog zip: manifest + products.json + references.json
   * + every product image file. Deleted (soft) products are included with
   * their deletedAt so a restore brings the catalog back exactly as it was. */
  async buildBackup(): Promise<Buffer> {
    const [products, categories, brands, locations, makes] = await Promise.all([
      this.prisma.product.findMany({
        orderBy: { code: 'asc' },
        include: {
          category: true,
          images: { orderBy: { sort: 'asc' } },
          compatibilities: { include: { model: { include: { make: true } }, trim: true } },
          inventoryItems: { include: { brand: true, location: { include: { parent: true } } } },
        },
      }),
      this.prisma.category.findMany({ orderBy: { sort: 'asc' } }),
      this.prisma.brand.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.location.findMany({ orderBy: [{ type: 'asc' }, { code: 'asc' }] }),
      this.prisma.vehicleMake.findMany({
        include: { models: { include: { trims: true }, orderBy: { name: 'asc' } } },
      }),
    ]);

    const serialized: BackupProduct[] = products.map((product) => ({
      code: product.code,
      slug: product.slug,
      name: product.name,
      categoryCode: product.category.code,
      categoryName: product.category.name,
      description: product.description,
      specs: product.specs ?? null,
      partNumber: product.partNumber,
      aparatVideoId: product.aparatVideoId,
      status: product.status,
      availabilityOverride: product.availabilityOverride,
      priceDisplay: product.priceDisplay,
      seoTitle: product.seoTitle,
      seoDescription: product.seoDescription,
      seoKeywords: product.seoKeywords,
      deletedAt: product.deletedAt?.toISOString() ?? null,
      images: product.images.map((image) => ({
        path: image.path,
        file: `images/${basename(image.path)}`,
        alt: image.alt,
        sort: image.sort,
        isPrimary: image.isPrimary,
      })),
      compatibilities: product.compatibilities.map((compat) => ({
        make: compat.model.make.name,
        model: compat.model.name,
        trim: compat.trim?.name ?? null,
      })),
      items: product.inventoryItems.map((item) => ({
        barcode: item.barcode,
        brandName: item.brand?.name ?? null,
        quantity: item.quantity,
        purchasePrice: item.purchasePrice.toString(),
        salePrice: item.salePrice.toString(),
        minStock: item.minStock,
        locationCode: item.location?.code ?? null,
        locationParentCode: item.location?.parent?.code ?? null,
        notes: item.notes,
        isActive: item.isActive,
        priceUpdatedAt: item.priceUpdatedAt?.toISOString() ?? null,
      })),
    }));

    const references: BackupReferences = {
      categories: categories.map((category) => ({
        code: category.code,
        name: category.name,
        slug: category.slug,
        sort: category.sort,
        isActive: category.isActive,
        parentCode: null, // filled below — parents resolved by code map
      })),
      brands: brands.map((brand) => ({ name: brand.name, isActive: brand.isActive })),
      locations: locations.map((location) => ({
        code: location.code,
        name: location.name,
        type: location.type,
        parentCode: null,
      })),
      vehicles: makes.map((make) => ({
        make: make.name,
        models: make.models.map((model) => ({
          name: model.name,
          productionFrom: model.productionFrom,
          productionTo: model.productionTo,
          trims: model.trims.map((trim) => trim.name),
        })),
      })),
    };
    // Resolve parent codes through id→code maps (kept out of the map above so
    // the shape stays flat and the importer never deals with uuids).
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const categoryByCode = new Map(categories.map((category) => [category.code, category]));
    for (const entry of references.categories)
      entry.parentCode =
        categoryById.get(categoryByCode.get(entry.code)?.parentId ?? '')?.code ?? null;
    const locationById = new Map(locations.map((location) => [location.id, location]));
    const locationByCode = new Map(locations.map((location) => [location.code, location]));
    for (const entry of references.locations)
      entry.parentCode =
        locationById.get(locationByCode.get(entry.code)?.parentId ?? '')?.code ?? null;

    const zip = new AdmZip();
    zip.addFile(
      'manifest.json',
      Buffer.from(
        JSON.stringify(
          {
            format: BACKUP_FORMAT,
            version: BACKUP_VERSION,
            createdAt: new Date().toISOString(),
            counts: {
              products: serialized.length,
              images: serialized.reduce((sum, product) => sum + product.images.length, 0),
              items: serialized.reduce((sum, product) => sum + product.items.length, 0),
            },
          },
          null,
          2,
        ),
        'utf8',
      ),
    );
    zip.addFile('products.json', Buffer.from(JSON.stringify(serialized), 'utf8'));
    zip.addFile('references.json', Buffer.from(JSON.stringify(references), 'utf8'));

    let missingImages = 0;
    const seen = new Set<string>();
    for (const product of serialized) {
      for (const image of product.images) {
        const name = basename(image.path);
        if (!SAFE_FILE_NAME.test(name) || seen.has(name)) continue;
        seen.add(name);
        try {
          zip.addLocalFile(join(this.uploadRoot, name), 'images');
        } catch {
          // File vanished from disk (manual cleanup?) — the DB row still
          // ships in products.json; the import will just not rewrite it.
          missingImages += 1;
        }
      }
    }

    return zip.toBuffer();
  }

  // ───────────────────────────── IMPORT ─────────────────────────────

  /** Restores a backup zip. Nothing is ever deleted: products are matched by
   * their unique code — missing ones are recreated with the same code, existing
   * ones are updated back to the backup state. Reference rows (categories,
   * brands, locations, vehicles) are created only when missing. */
  async importBackup(buffer: Buffer, userId: string, ip?: string): Promise<ImportSummary> {
    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      throw new BadRequestException('فایل ZIP معتبر نیست');
    }
    const manifestEntry = zip.getEntry('manifest.json');
    if (!manifestEntry)
      throw new BadRequestException('فایل پشتیبان معتبر نیست (manifest.json یافت نشد)');
    let manifest: { format?: string; version?: number };
    try {
      manifest = JSON.parse(zip.readAsText(manifestEntry));
    } catch {
      throw new BadRequestException('فایل پشتیبان معتبر نیست (manifest.json خراب است)');
    }
    if (manifest.format !== BACKUP_FORMAT || manifest.version !== BACKUP_VERSION)
      throw new BadRequestException('نسخهٔ فایل پشتیبان پشتیبانی نمی‌شود');

    let products: BackupProduct[];
    let references: BackupReferences;
    try {
      products = JSON.parse(zip.readAsText('products.json'));
      references = JSON.parse(zip.readAsText('references.json'));
    } catch {
      throw new BadRequestException(
        'فایل پشتیبان معتبر نیست (products.json/references.json خراب است)',
      );
    }

    const summary: ImportSummary = {
      productsCreated: 0,
      productsUpdated: 0,
      itemsCreated: 0,
      itemsUpdated: 0,
      imagesWritten: 0,
      imagesMissing: 0,
      categoriesCreated: 0,
      brandsCreated: 0,
      locationsCreated: 0,
      vehicleModelsCreated: 0,
      errors: [],
    };

    // A wiped server may have lost the uploads dir along with the database —
    // recreate it before the image pass starts writing files back.
    await mkdir(this.uploadRoot, { recursive: true }).catch(() => undefined);

    const maps = await this.restoreReferences(references, summary);
    await this.restoreProducts(products, zip, maps, summary, userId, ip);
    return summary;
  }

  /** Creates missing reference rows and returns name/code → id maps used by
   * the product pass. Existing rows are never modified. */
  private async restoreReferences(
    references: BackupReferences,
    summary: ImportSummary,
  ): Promise<{
    categoryId: Map<string, string>;
    brandId: Map<string, string>;
    locationId: Map<string, string>; // "parentCode>code" (">" = no parent)
    vehicleModelId: Map<string, string>; // "make|model"
    vehicleTrimId: Map<string, string>; // "make|model|trim"
  }> {
    const categoryId = new Map<string, string>();
    const brandId = new Map<string, string>();
    const locationId = new Map<string, string>();
    const vehicleModelId = new Map<string, string>();
    const vehicleTrimId = new Map<string, string>();

    await this.prisma.$transaction(async (tx) => {
      // Categories — parents first so the tree restores in one pass.
      const byCode = new Map(references.categories.map((entry) => [entry.code, entry]));
      const resolveParents = (entry: (typeof references.categories)[number]): string[] => {
        const chain: string[] = [];
        let cursor: typeof entry | undefined = entry;
        while (cursor) {
          chain.unshift(cursor.code);
          cursor = cursor.parentCode ? byCode.get(cursor.parentCode) : undefined;
        }
        return chain;
      };
      for (const entry of references.categories) {
        for (const code of resolveParents(entry)) {
          if (categoryId.has(code)) continue;
          const source = byCode.get(code)!;
          const existing = await tx.category.findUnique({ where: { code } });
          if (existing) {
            categoryId.set(code, existing.id);
            continue;
          }
          const created = await tx.category.create({
            data: {
              code: source.code,
              name: source.name,
              slug: source.slug,
              sort: source.sort,
              isActive: source.isActive,
              parentId: source.parentCode ? categoryId.get(source.parentCode) : null,
            },
          });
          categoryId.set(code, created.id);
          summary.categoriesCreated += 1;
        }
      }

      for (const entry of references.brands) {
        const existing = await tx.brand.findUnique({ where: { name: entry.name } });
        if (existing) {
          brandId.set(entry.name, existing.id);
          continue;
        }
        const created = await tx.brand.create({
          data: { name: entry.name, isActive: entry.isActive },
        });
        brandId.set(entry.name, created.id);
        summary.brandsCreated += 1;
      }

      // Locations — warehouses before shelves (parentCode chain), same trick.
      const locByCode = new Map(references.locations.map((entry) => [entry.code, entry]));
      const locChain = (entry: (typeof references.locations)[number]): string[] => {
        const chain: string[] = [];
        let cursor: typeof entry | undefined = entry;
        while (cursor) {
          chain.unshift(cursor.code);
          cursor = cursor.parentCode ? locByCode.get(cursor.parentCode) : undefined;
        }
        return chain;
      };
      for (const entry of references.locations) {
        for (const code of locChain(entry)) {
          const key = `${locByCode.get(code)?.parentCode ?? ''}>${code}`;
          if (locationId.has(key)) continue;
          const source = locByCode.get(code)!;
          // A location's map key is “<parentCode>><code>” — so the parent's
          // own key is “<grandparentCode>><parentCode>”. The chain loop has
          // already stored every ancestor by the time we get here.
          const parentKey = source.parentCode
            ? `${locByCode.get(source.parentCode)?.parentCode ?? ''}>${source.parentCode}`
            : '';
          const parentId = source.parentCode ? (locationId.get(parentKey) ?? null) : null;
          // @@unique([parentId, code]) — reuse the row if this (parent, code)
          // slot already exists under a different id.
          const existing = await tx.location.findFirst({ where: { parentId, code } });
          if (existing) {
            locationId.set(key, existing.id);
            continue;
          }
          const created = await tx.location.create({
            data: { code: source.code, name: source.name, type: source.type as never, parentId },
          });
          locationId.set(key, created.id);
          summary.locationsCreated += 1;
        }
      }

      for (const make of references.vehicles) {
        let makeRow = await tx.vehicleMake.findUnique({ where: { name: make.make } });
        if (!makeRow) makeRow = await tx.vehicleMake.create({ data: { name: make.make } });
        for (const model of make.models) {
          let modelRow = await tx.vehicleModel.findUnique({
            where: { makeId_name: { makeId: makeRow.id, name: model.name } },
          });
          if (!modelRow) {
            modelRow = await tx.vehicleModel.create({
              data: {
                makeId: makeRow.id,
                name: model.name,
                productionFrom: model.productionFrom,
                productionTo: model.productionTo,
              },
            });
            summary.vehicleModelsCreated += 1;
          }
          vehicleModelId.set(`${make.make}|${model.name}`, modelRow.id);
          for (const trim of model.trims) {
            let trimRow = await tx.vehicleTrim.findUnique({
              where: { modelId_name: { modelId: modelRow.id, name: trim } },
            });
            if (!trimRow)
              trimRow = await tx.vehicleTrim.create({ data: { modelId: modelRow.id, name: trim } });
            vehicleTrimId.set(`${make.make}|${model.name}|${trim}`, trimRow.id);
          }
        }
      }
    });

    return { categoryId, brandId, locationId, vehicleModelId, vehicleTrimId };
  }

  /** Product pass — each product restores in its own transaction so one bad
   * row (bad reference, barcode clash with another product…) never rolls back
   * the whole catalog. */
  private async restoreProducts(
    products: BackupProduct[],
    zip: AdmZip,
    maps: Awaited<ReturnType<ProductsBackupService['restoreReferences']>>,
    summary: ImportSummary,
    userId: string,
    ip?: string,
  ): Promise<void> {
    for (const entry of products) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const categoryId = maps.categoryId.get(entry.categoryCode);
          if (!categoryId) throw new Error(`دسته‌بندی «${entry.categoryCode}» بازسازی نشد`);

          const existing = await tx.product.findUnique({ where: { code: entry.code } });
          let productId: string;

          if (existing) {
            // Slug: only move when the backup slug is free (or already ours).
            const slugTaken =
              entry.slug !== existing.slug
                ? await tx.product.findUnique({ where: { slug: entry.slug }, select: { id: true } })
                : null;
            await tx.product.update({
              where: { id: existing.id },
              data: {
                name: entry.name,
                slug: slugTaken ? existing.slug : entry.slug,
                categoryId,
                description: entry.description,
                specs: (entry.specs ?? undefined) as never,
                partNumber: entry.partNumber,
                aparatVideoId: entry.aparatVideoId,
                status: entry.status as never,
                availabilityOverride: entry.availabilityOverride as never,
                priceDisplay: entry.priceDisplay,
                seoTitle: entry.seoTitle,
                seoDescription: entry.seoDescription,
                seoKeywords: entry.seoKeywords,
                deletedAt: entry.deletedAt ? new Date(entry.deletedAt) : null,
              },
            });
            productId = existing.id;
            summary.productsUpdated += 1;
          } else {
            // Recreate with the SAME code so links, reports and the android
            // cache keep working after a wipe.
            let slug = entry.slug;
            const taken = await tx.product.findUnique({ where: { slug }, select: { id: true } });
            if (taken) slug = `${slug}-${entry.code}`;
            const created = await tx.product.create({
              data: {
                code: entry.code,
                slug,
                name: entry.name,
                categoryId,
                description: entry.description,
                specs: (entry.specs ?? undefined) as never,
                partNumber: entry.partNumber,
                aparatVideoId: entry.aparatVideoId,
                status: entry.status as never,
                availabilityOverride: entry.availabilityOverride as never,
                priceDisplay: entry.priceDisplay,
                seoTitle: entry.seoTitle,
                seoDescription: entry.seoDescription,
                seoKeywords: entry.seoKeywords,
                deletedAt: entry.deletedAt ? new Date(entry.deletedAt) : null,
              },
            });
            productId = created.id;
            summary.productsCreated += 1;
          }

          // Images: replace the row set, write missing files from the zip.
          await tx.productImage.deleteMany({ where: { productId } });
          for (const image of entry.images) {
            const name = basename(image.path);
            if (!SAFE_FILE_NAME.test(name)) {
              summary.errors.push(`${entry.code}: نام فایل تصویر نامعتبر («${name}») رد شد`);
              continue;
            }
            const fileEntry = zip.getEntry(`images/${name}`);
            if (fileEntry) {
              try {
                await writeFile(join(this.uploadRoot, name), fileEntry.getData());
                summary.imagesWritten += 1;
              } catch {
                summary.errors.push(`${entry.code}: نوشتن تصویر «${name}» روی دیسک ناموفق بود`);
              }
            } else {
              summary.imagesMissing += 1;
            }
            await tx.productImage.create({
              data: {
                productId,
                path: image.path,
                alt: image.alt,
                sort: image.sort,
                isPrimary: image.isPrimary,
              },
            });
          }

          // Vehicle compatibilities: replace the set.
          await tx.productVehicleCompat.deleteMany({ where: { productId } });
          for (const compat of entry.compatibilities) {
            const modelId = maps.vehicleModelId.get(`${compat.make}|${compat.model}`);
            if (!modelId) {
              summary.errors.push(
                `${entry.code}: خودروی «${compat.make} ${compat.model}» بازسازی نشد`,
              );
              continue;
            }
            const trimId = compat.trim
              ? (maps.vehicleTrimId.get(`${compat.make}|${compat.model}|${compat.trim}`) ?? null)
              : null;
            await tx.productVehicleCompat.create({ data: { productId, modelId, trimId } });
          }

          // Inventory items: match by barcode (globally unique).
          for (const item of entry.items) {
            const brand = item.brandName ? maps.brandId.get(item.brandName) : null;
            if (item.brandName && !brand) {
              summary.errors.push(`${entry.code}: برند «${item.brandName}» بازسازی نشد`);
              continue;
            }
            const locationKey = item.locationCode
              ? `${item.locationParentCode ?? ''}>${item.locationCode}`
              : null;
            const locationId = locationKey ? (maps.locationId.get(locationKey) ?? null) : null;

            const existingItem = await tx.inventoryItem.findUnique({
              where: { barcode: item.barcode },
            });
            const data = {
              productId,
              brandId: brand,
              quantity: item.quantity,
              purchasePrice: BigInt(item.purchasePrice),
              salePrice: BigInt(item.salePrice),
              minStock: item.minStock,
              locationId,
              notes: item.notes,
              isActive: item.isActive,
              priceUpdatedAt: item.priceUpdatedAt ? new Date(item.priceUpdatedAt) : null,
            };
            if (existingItem) {
              if (existingItem.productId !== productId) {
                summary.errors.push(
                  `${entry.code}: بارکد ${item.barcode} به محصول دیگری تعلق دارد — این قلم رد شد`,
                );
                continue;
              }
              await tx.inventoryItem.update({ where: { id: existingItem.id }, data });
              summary.itemsUpdated += 1;
            } else {
              await tx.inventoryItem.create({ data: { ...data, barcode: item.barcode } });
              summary.itemsCreated += 1;
            }
          }

          // Android cache + audit trail — same channels the panel writes use.
          const restored = await tx.product.findUnique({
            where: { id: productId },
            include: { images: { orderBy: { sort: 'asc' } } },
          });
          if (restored) {
            await writeSyncChange(tx, {
              entityType: 'product',
              entityId: productId,
              action: existing ? 'updated' : 'created',
              payload: buildProductSyncPayload(restored, restored.images[0] ?? null),
            });
          }
        });
      } catch (error) {
        summary.errors.push(`${entry.code}: ${(error as Error).message}`);
      }
    }

    // One summary audit entry for the whole import — per-product entries
    // would flood the trail for a full-catalog restore. entityType stays
    // OUTSIDE the sync-payload allowlist on purpose: a 'product' audit would
    // inject a fake product row (id “products-backup-import”) into every
    // Android device's cache through the sync channel.
    await this.prisma
      .$transaction(async (tx) => {
        await writeAudit(tx, {
          userId,
          action: 'import',
          entityType: 'products-backup',
          entityId: 'import',
          after: {
            productsCreated: summary.productsCreated,
            productsUpdated: summary.productsUpdated,
            itemsCreated: summary.itemsCreated,
            itemsUpdated: summary.itemsUpdated,
          },
          ip,
        });
      })
      .catch(() => undefined);
  }
}
