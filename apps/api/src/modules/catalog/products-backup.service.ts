import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import AdmZip = require('adm-zip');
import { PrismaService } from '../../prisma.service';
import { buildProductSyncPayload } from '../../common/sync/sync-payloads';
import { writeAudit, writeSyncChange } from '../../common/audit/audit-log';

/** Backup format marker + version — bump when the zip layout changes so a
 * future importer can reject (or migrate) archives it does not understand. */
const BACKUP_FORMAT = 'salimvand-products-backup';
const BACKUP_VERSION = 2;
const BACKUP_SUPPORTED_VERSIONS = new Set([1, 2]);

/** Plain file names only inside the images/ folder of the archive — blocks
 * path traversal (“../../.bashrc”) from a hand-crafted zip. */
const SAFE_FILE_NAME = /^[A-Za-z0-9._-]+$/;
const UPLOADS_PREFIX = '/uploads/products/';

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
      images: product.images.map((image) => {
        const file = this.toZipFilePath(image.path);
        return {
          path: image.path,
          file,
          alt: image.alt,
          sort: image.sort,
          isPrimary: image.isPrimary,
        };
      }),
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

    // Collect image files to embed — supports both legacy flat layout
    // (uploads/products/<file>.webp) and current dir layout
    // (uploads/products/<uuid>/large.webp + small.webp).
    let filesAdded = 0;
    const seenZipPaths = new Set<string>();
    const seenDirs = new Set<string>();

    for (const product of serialized) {
      for (const image of product.images) {
        // External URLs have no local file — skip.
        if (/^https?:\/\//i.test(image.path)) continue;
        if (!image.file || !image.file.startsWith('images/')) continue;
        if (seenZipPaths.has(image.file)) continue;
        const relative = image.file.replace(/^images\//, ''); // e.g. a.webp or <id>/large.webp
        if (!relative || relative.includes('..')) continue;
        // Validate each path segment.
        const segments = relative.split('/');
        if (segments.some((seg) => !seg || !SAFE_FILE_NAME.test(seg))) continue;

        const diskPath = join(this.uploadRoot, relative);
        try {
          const data = await readFile(diskPath);
          zip.addFile(image.file, data);
          seenZipPaths.add(image.file);
          filesAdded += 1;

          // If this image lives in a directory (current layout), also bundle
          // any sibling variants (small.webp, medium.webp, etc.) so the restore
          // brings back the exact same set the media service created.
          const dir = dirname(relative);
          if (dir !== '.' && !seenDirs.has(dir)) {
            seenDirs.add(dir);
            try {
              const entries = await readdir(join(this.uploadRoot, dir));
              for (const sibling of entries) {
                if (sibling === basename(relative)) continue; // already added
                if (!SAFE_FILE_NAME.test(sibling)) continue;
                // Only include image files — be conservative.
                if (!/\.(webp|jpg|jpeg|png|avif)$/i.test(sibling)) continue;
                const siblingZip = `images/${dir}/${sibling}`;
                if (seenZipPaths.has(siblingZip)) continue;
                try {
                  const siblingData = await readFile(join(this.uploadRoot, dir, sibling));
                  zip.addFile(siblingZip, siblingData);
                  seenZipPaths.add(siblingZip);
                  filesAdded += 1;
                } catch {
                  // sibling vanished — ignore
                }
              }
            } catch {
              // dir missing — ignore
            }
          }
        } catch {
          // File vanished from disk (manual cleanup?) — the DB row still
          // ships in products.json; the import will just not rewrite it.
        }
      }
    }

    // Fallback for any image dirs that weren't covered because the DB row
    // points to large.webp but the directory also contains small.webp and we
    // already handled it above. The above loop already covers it, but we also
    // scan for dirs that might have been missed if product had no images?
    // (nothing to do).

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
              imageFiles: filesAdded,
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

    return zip.toBuffer();
  }

  private toZipFilePath(dbPath: string): string {
    if (/^https?:\/\//i.test(dbPath)) {
      // External image — no local file to bundle, keep the URL as file field
      // so the importer knows it's remote.
      return dbPath;
    }
    if (dbPath.startsWith(UPLOADS_PREFIX)) {
      const relative = dbPath.slice(UPLOADS_PREFIX.length); // e.g. <id>/large.webp or file.webp
      if (!relative || relative.includes('..')) {
        // Fallback to basename if path is weird
        const base = basename(dbPath);
        return SAFE_FILE_NAME.test(base) ? `images/${base}` : dbPath;
      }
      // Validate segments, fallback to basename on failure
      const segs = relative.split('/');
      if (segs.some((s) => !s || (s !== '.' && !SAFE_FILE_NAME.test(s)))) {
        const base = basename(dbPath);
        return SAFE_FILE_NAME.test(base) ? `images/${base}` : `images/${basename(dbPath)}`;
      }
      return `images/${relative}`;
    }
    // Legacy or unexpected local path — try basename
    const base = basename(dbPath);
    if (SAFE_FILE_NAME.test(base)) return `images/${base}`;
    return dbPath;
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
    if (manifest.format !== BACKUP_FORMAT || !BACKUP_SUPPORTED_VERSIONS.has(manifest.version ?? 0))
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

  private isSafeZipImagePath(zipPath: string): boolean {
    if (!zipPath.startsWith('images/')) return false;
    if (zipPath.includes('..')) return false;
    const relative = zipPath.slice('images/'.length);
    if (!relative) return false;
    const segments = relative.split('/');
    // No empty segments, no absolute, each segment safe
    return segments.every((seg) => seg && SAFE_FILE_NAME.test(seg));
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
    // Pre-index all image entries in the zip for quick sibling lookup
    const zipImageEntries = new Set(
      zip
        .getEntries()
        .map((e) => e.entryName)
        .filter((name) => name.startsWith('images/')),
    );

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
            const dbPath = image.path;

            // External URL — no file to restore, just keep the DB row
            if (/^https?:\/\//i.test(dbPath)) {
              await tx.productImage.create({
                data: {
                  productId,
                  path: dbPath,
                  alt: image.alt,
                  sort: image.sort,
                  isPrimary: image.isPrimary,
                },
              });
              continue;
            }

            const fileInZip = image.file;
            // file field might be an external URL in old backups for remote images
            if (/^https?:\/\//i.test(fileInZip)) {
              await tx.productImage.create({
                data: {
                  productId,
                  path: dbPath,
                  alt: image.alt,
                  sort: image.sort,
                  isPrimary: image.isPrimary,
                },
              });
              continue;
            }

            if (!fileInZip || !fileInZip.startsWith('images/')) {
              summary.errors.push(`${entry.code}: مسیر فایل تصویر نامعتبر («${fileInZip}») رد شد`);
              // Still create DB row so product doesn't lose image reference
              await tx.productImage.create({
                data: {
                  productId,
                  path: dbPath,
                  alt: image.alt,
                  sort: image.sort,
                  isPrimary: image.isPrimary,
                },
              });
              summary.imagesMissing += 1;
              continue;
            }

            if (!this.isSafeZipImagePath(fileInZip)) {
              summary.errors.push(`${entry.code}: نام فایل تصویر نامعتبر («${fileInZip}») رد شد`);
              await tx.productImage.create({
                data: {
                  productId,
                  path: dbPath,
                  alt: image.alt,
                  sort: image.sort,
                  isPrimary: image.isPrimary,
                },
              });
              continue;
            }

            const zipEntry = zip.getEntry(fileInZip);
            const relative = fileInZip.replace(/^images\//, '');
            const diskPath = join(this.uploadRoot, relative);

            if (zipEntry) {
              try {
                await mkdir(dirname(diskPath), { recursive: true });
                await writeFile(diskPath, zipEntry.getData());
                summary.imagesWritten += 1;

                // Also restore sibling variants (small.webp etc.) if they exist
                // in the zip under the same directory.
                const dir = dirname(relative);
                if (dir !== '.' && dir !== '') {
                  // Check for common variants
                  const variants = ['small.webp', 'medium.webp', 'large.webp'];
                  for (const variant of variants) {
                    if (variant === basename(relative)) continue;
                    const variantZipPath = `images/${dir}/${variant}`;
                    if (!zipImageEntries.has(variantZipPath)) continue;
                    const variantEntry = zip.getEntry(variantZipPath);
                    if (!variantEntry) continue;
                    const variantDiskPath = join(this.uploadRoot, dir, variant);
                    try {
                      await mkdir(dirname(variantDiskPath), { recursive: true });
                      await writeFile(variantDiskPath, variantEntry.getData());
                      summary.imagesWritten += 1;
                    } catch {
                      summary.errors.push(
                        `${entry.code}: نوشتن تصویر «${variantZipPath}» روی دیسک ناموفق بود`,
                      );
                    }
                  }
                  // Also restore any other files in same dir that are in zip
                  // (generic fallback) — iterate zip entries that start with images/<dir>/
                  for (const otherZipPath of zipImageEntries) {
                    if (!otherZipPath.startsWith(`images/${dir}/`)) continue;
                    if (otherZipPath === fileInZip) continue;
                    if (['small.webp', 'medium.webp', 'large.webp'].includes(basename(otherZipPath)))
                      continue; // already handled
                    const otherEntry = zip.getEntry(otherZipPath);
                    if (!otherEntry) continue;
                    const otherRelative = otherZipPath.replace(/^images\//, '');
                    const otherDiskPath = join(this.uploadRoot, otherRelative);
                    if (!this.isSafeZipImagePath(otherZipPath)) continue;
                    try {
                      await mkdir(dirname(otherDiskPath), { recursive: true });
                      await writeFile(otherDiskPath, otherEntry.getData());
                      summary.imagesWritten += 1;
                    } catch {
                      // ignore
                    }
                  }
                }
              } catch {
                summary.errors.push(`${entry.code}: نوشتن تصویر «${fileInZip}» روی دیسک ناموفق بود`);
              }
            } else {
              summary.imagesMissing += 1;
            }

            await tx.productImage.create({
              data: {
                productId,
                path: dbPath,
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
