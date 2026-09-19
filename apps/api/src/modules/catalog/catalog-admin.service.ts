import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { buildProductSeo, createEan13 } from '@salimvand/shared';
import { PrismaService } from '../../prisma.service';
import { Prisma } from '@prisma/client';
import { writeAudit } from '../../common/audit/audit-log';
import {
  buildInventoryItemSyncPayload,
  buildProductSyncPayload,
} from '../../common/sync/sync-payloads';
import { recordSalePriceChange } from '../../common/inventory/price-history';

/** Inventory fields accepted inside product.create — brand, barcode, prices,
 * shelf and the opening stock, applied in the same transaction as the catalog
 * row so a mobile product.create can never end up as a price-less neutral line. */
type ProductCreateInventoryInput = {
  brandId?: string | null;
  barcode?: string;
  purchasePrice?: bigint;
  salePrice?: bigint;
  minStock?: number;
  locationId?: string | null;
  initialQuantity: number;
};

/** Inventory metadata accepted inside product.update. Quantity is deliberately
 * absent: stock may only move through receive/adjust commands. */
type ProductUpdateInventoryInput = {
  itemId: string;
  brandId?: string | null;
  barcode?: string;
  purchasePrice?: bigint;
  salePrice?: bigint;
  minStock?: number | null;
  locationId?: string | null;
  notes?: string;
};

@Injectable()
export class CatalogAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async wholesale() {
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null, status: 'active' },
      orderBy: { name: 'asc' },
      include: {
        category: { select: { id: true, name: true } },
        images: { orderBy: [{ isPrimary: 'desc' }, { sort: 'asc' }], take: 1 },
        compatibilities: { include: { model: { include: { make: true } } } },
        inventoryItems: { where: { isActive: true }, include: { brand: true } },
      },
    });
    const profile = await this.prisma.setting.findUnique({
      where: { key: 'store.profile' },
      select: { value: true },
    });
    const store = (profile?.value ?? {}) as { phones?: string; phone?: string; address?: string };
    return {
      ok: true,
      data: products.map((product) => ({
        id: product.id,
        code: product.code,
        name: product.name,
        image: product.images[0] ?? null,
        category: product.category,
        vehicles: product.compatibilities.map((row) => `${row.model.make.name} ${row.model.name}`),
        price: product.inventoryItems.length
          ? product.inventoryItems
              .reduce(
                (min, item) => (item.salePrice < min ? item.salePrice : min),
                product.inventoryItems[0].salePrice,
              )
              .toString()
          : '0',
        items: product.inventoryItems.map((item) => ({
          brand: item.brand?.name ?? 'بدون برند',
          price: item.salePrice.toString(),
          inStock: item.quantity > 0,
        })),
      })),
      store: {
        phone: store.phones ?? store.phone ?? '',
        address: store.address ?? '',
        website: process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir',
      },
    };
  }

  async list() {
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        category: true,
        inventoryItems: { include: { brand: true, location: { include: { parent: true } } } },
        // Primary image first so the panel list can show a thumbnail without
        // pulling every image of every product.
        images: { orderBy: [{ isPrimary: 'desc' }, { sort: 'asc' }], take: 1 },
        compatibilities: { include: { model: { include: { make: true } } } },
      },
    });
    return { ok: true, data: products };
  }

  async regenerateKeywords() {
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        compatibilities: {
          select: { model: { select: { name: true, make: { select: { name: true } } } } },
        },
      },
    });
    let updated = 0;
    for (const product of products) {
      const keywords = buildProductSeo({
        name: product.name,
        vehicleNames: product.compatibilities.map(
          (row: { model: { make: { name: string }; name: string } }) =>
            `${row.model.make.name} ${row.model.name}`,
        ),
      }).seoKeywords;
      await this.prisma.product.update({
        where: { id: product.id },
        data: { seoKeywords: keywords },
      });
      updated += 1;
    }
    return { ok: true, data: { updated } };
  }

  async get(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        category: true,
        images: { orderBy: [{ isPrimary: 'desc' }, { sort: 'asc' }] },
        compatibilities: { include: { model: { include: { make: true } }, trim: true } },
        inventoryItems: { include: { brand: true, location: { include: { parent: true } } } },
      },
    });
    if (!product) throw new NotFoundException('محصول پیدا نشد');
    return { ok: true, data: product };
  }

  async create(input: Record<string, unknown>, userId?: string, ip?: string, operationId?: string) {
    const name = this.stringValue(input.name);
    const categoryId = this.stringValue(input.categoryId);
    if (!name || !categoryId) throw new BadRequestException('نام محصول و دسته‌بندی الزامی است');
    // Multi-brand form: items[] creates one stock line per brand atomically;
    // the legacy single `inventory` object is translated into a one-element
    // list so old mobile builds keep working unchanged.
    const itemsInput = this.parseCreateItems(input);
    if (itemsInput.some((item) => item.initialQuantity > 0) && !userId)
      throw new BadRequestException('کاربر ثبت‌کنندهٔ موجودی الزامی است');
    // Postgres treats NULLs as distinct in @@unique([productId, brandId]),
    // so the "one line per brand" rule is enforced here in code — including
    // the no-brand (brandId: null) case.
    const brandKeys = new Set<string>();
    for (const item of itemsInput) {
      const key = item.brandId ?? '__no_brand__';
      if (brandKeys.has(key))
        throw new BadRequestException('هر برند برای یک محصول فقط یک قلم می‌تواند داشته باشد');
      brandKeys.add(key);
    }
    const seo = buildProductSeo({ name, slug: this.optionalString(input.slug) ?? undefined });
    const createProduct = async (tx: Prisma.TransactionClient | typeof this.prisma) => {
      if (operationId) {
        const previous = await tx.productOperation.findUnique({ where: { operationId } });
        if (previous) return this.loadCreateResult(tx, previous.productId, operationId);
      }
      // The code counter is incremented INSIDE this transaction: a rollback
      // now undoes the increment too, so a failed attempt never burns (or
      // collides on) a product code, and a replayed operation — which returns
      // above — never takes a new one.
      const code = await this.nextCodeInTx(tx, 'product');
      // Reference integrity is checked explicitly (not left to the database
      // FK error) so a mobile payload with a stale categoryId/brandId gets a
      // readable 400 instead of a 500 — and nothing is written at all before
      // every line of the request has been validated.
      const category = await tx.category.findUnique({ where: { id: categoryId } });
      if (!category || !category.isActive) throw new BadRequestException('دسته‌بندی نامعتبر است');
      const resolvedItems: Array<{
        input: ProductCreateInventoryInput;
        brandId: string | null;
        locationId: string | null;
        barcode: string;
      }> = [];
      const explicitBarcodes = new Set<string>();
      for (const [index, item] of itemsInput.entries()) {
        let brandId: string | null = null;
        if (item.brandId) {
          const brand = await tx.brand.findUnique({ where: { id: item.brandId } });
          if (!brand || !brand.isActive) throw new BadRequestException('برند نامعتبر است');
          brandId = brand.id;
        }
        let locationId: string | null = null;
        if (item.locationId) {
          const location = await tx.location.findUnique({ where: { id: item.locationId } });
          if (!location) throw new BadRequestException('موقعیت انبار نامعتبر است');
          locationId = location.id;
        }
        let barcode = item.barcode?.trim() ?? '';
        if (barcode) {
          if (!/^\d{4,20}$/.test(barcode))
            throw new BadRequestException('بارکد باید ۴ تا ۲۰ رقم باشد');
          if (explicitBarcodes.has(barcode))
            throw new BadRequestException('بارکد تکراری در اقلام ارسالی است');
          explicitBarcodes.add(barcode);
          const taken = await tx.inventoryItem.findUnique({ where: { barcode } });
          if (taken) throw new BadRequestException('این بارکد قبلاً برای قلم دیگری ثبت شده است');
        } else {
          // The index keeps auto-generated barcodes unique inside the same
          // transaction (same millisecond + same category).
          barcode = createEan13(`${Date.now()}${categoryId.replace(/-/g, '')}${index}`.slice(-9));
        }
        resolvedItems.push({ input: item, brandId, locationId, barcode });
      }
      const created = await tx.product.create({
        data: {
          name,
          categoryId,
          code,
          ...seo,
          seoTitle: this.optionalString(input.seoTitle) ?? seo.seoTitle,
          seoDescription: this.optionalString(input.seoDescription) ?? seo.seoDescription,
          description: this.optionalString(input.description),
          partNumber: this.optionalString(input.partNumber),
          aparatVideoId: this.optionalString(input.aparatVideoId),
          status: input.status === 'hidden' ? 'hidden' : 'active',
          priceDisplay: this.priceDisplayValue(input.priceDisplay) ?? 'inherit',
          // Search phrases are generated from the name; compatibility changes
          // regenerate them again with make/model phrases included.
          seoKeywords: seo.seoKeywords,
        },
      });
      const inventoryItems = [];
      for (const resolved of resolvedItems) {
        const item = resolved.input;
        // One stock line per brand, and the opening stock is recorded as a
        // type=initial ledger entry — quantity is never set outside the ledger.
        const inventoryItem = await tx.inventoryItem.create({
          data: {
            productId: created.id,
            brandId: resolved.brandId,
            barcode: resolved.barcode,
            quantity: item.initialQuantity,
            purchasePrice: item.purchasePrice,
            salePrice: item.salePrice,
            minStock: item.minStock,
            locationId: resolved.locationId,
            // Opening price entry — only when a price was actually set.
            ...(item.salePrice && item.salePrice > 0n ? { priceUpdatedAt: new Date() } : {}),
          },
        });
        inventoryItems.push(inventoryItem);
        await recordSalePriceChange(tx, {
          itemId: inventoryItem.id,
          oldSalePrice: null,
          newSalePrice: item.salePrice ?? 0n,
          userId,
          source: operationId ? 'android' : 'panel',
          operationId,
        });
        if (item.initialQuantity > 0)
          await tx.inventoryTransaction.create({
            data: {
              itemId: inventoryItem.id,
              type: 'initial',
              quantityChange: item.initialQuantity,
              quantityAfter: item.initialQuantity,
              userId: userId!,
              reason: 'موجودی اولیه',
              operationId,
            },
          });
        // One idempotency row per line — a replayed operation recognizes
        // every item it already created.
        if (operationId)
          await tx.inventoryOperation.create({
            data: { operationId, itemId: inventoryItem.id, type: 'product.create' },
          });
      }
      if (!resolvedItems.length) {
        // InventoryItem requires a brand for barcode, stock and shelf tracking.
        // Keep catalog-only product creation consistent by creating one neutral
        // inventory line when the operator did not provide a brand yet.
        if (!Array.isArray(input.inventoryBrandIds) || input.inventoryBrandIds.length === 0) {
          const neutral = await tx.inventoryItem.create({
            data: {
              productId: created.id,
              barcode: createEan13(`${Date.now()}${created.id.replace(/-/g, '')}`.slice(-9)),
              purchasePrice: 0n,
              salePrice: 0n,
              quantity: 0,
            },
          });
          inventoryItems.push(neutral);
        }
      }
      if (operationId) {
        await tx.productOperation.create({
          data: { operationId, productId: created.id, type: 'product.create' },
        });
      }
      if (userId && 'auditLog' in tx)
        await writeAudit(tx as Prisma.TransactionClient, {
          userId,
          ip,
          action: 'create',
          entityType: 'product',
          entityId: created.id,
          after: { name: created.name, code: created.code },
          syncPayload: buildProductSyncPayload(created),
        });
      if ('auditLog' in tx)
        for (const inventoryItem of inventoryItems)
          await writeAudit(tx as Prisma.TransactionClient, {
            userId,
            ip,
            action: 'create',
            entityType: 'inventory_item',
            entityId: inventoryItem.id,
            syncPayload: buildInventoryItemSyncPayload(inventoryItem),
          });
      return { product: created, inventoryItems };
    };
    const result = this.prisma.$transaction
      ? await this.prisma.$transaction(createProduct)
      : await createProduct(this.prisma);
    // `inventoryItem` (the first line) is kept for the single-line callers;
    // multi-line consumers read `inventoryItems`.
    return {
      ok: true,
      data: {
        ...result.product,
        inventoryItem: result.inventoryItems[0] ?? null,
        inventoryItems: result.inventoryItems,
      },
    };
  }

  async update(
    id: string,
    input: Record<string, unknown>,
    userId?: string,
    ip?: string,
    operationId?: string,
  ) {
    await this.ensureExists(id);
    const inventoryInput = this.parseUpdateInventory(id, input.inventory);
    const data: Record<string, unknown> = {};
    for (const key of [
      'name',
      'description',
      'partNumber',
      'categoryId',
      'slug',
      'seoTitle',
      'seoDescription',
      'aparatVideoId',
    ])
      if (input[key] !== undefined) data[key] = input[key];
    const keywords = this.stringArray(input.seoKeywords);
    if (keywords) data.seoKeywords = keywords;
    // Storefront price visibility: 'inherit' follows the site-wide switch,
    // 'show'/'hide' override it for this one product.
    if (input.priceDisplay !== undefined)
      data.priceDisplay = this.priceDisplayValue(input.priceDisplay) ?? 'inherit';
    // status is an enum column: anything but the two known values must be rejected, not stored.
    if (input.status !== undefined) {
      if (input.status !== 'active' && input.status !== 'hidden')
        throw new BadRequestException('وضعیت محصول باید active یا hidden باشد');
      data.status = input.status;
    }
    if (typeof input.name === 'string' && input.name.trim()) {
      const seo = buildProductSeo({
        name: input.name,
        slug: typeof input.slug === 'string' ? input.slug : undefined,
      });
      for (const key of ['slug', 'seoTitle', 'seoDescription', 'seoKeywords'])
        if (data[key] === undefined) data[key] = seo[key as keyof typeof seo];
    } else if (typeof input.slug === 'string' && input.slug.trim()) data.slug = input.slug.trim();
    if (input.categoryId !== undefined) {
      const categoryId = this.stringValue(input.categoryId);
      if (!categoryId) throw new BadRequestException('دسته‌بندی نامعتبر است');
      data.categoryId = categoryId;
    }
    const before = this.prisma.product.findUnique
      ? await this.prisma.product.findUnique({ where: { id } })
      : await this.prisma.product.findFirst({ where: { id } });
    const updateProduct = async (tx: Prisma.TransactionClient | typeof this.prisma) => {
      if (operationId) {
        const previous = await tx.productOperation.findUnique({ where: { operationId } });
        if (previous) return this.loadUpdateResult(tx, previous.productId, operationId);
      }
      if (typeof data.categoryId === 'string') {
        const category = await tx.category.findUnique({ where: { id: data.categoryId } });
        if (!category || !category.isActive) throw new BadRequestException('دسته‌بندی نامعتبر است');
      }
      const updated = await tx.product.update({ where: { id }, data });
      let inventoryItem = null;
      if (inventoryInput) {
        inventoryItem = await this.applyInventoryMetadata(tx, id, inventoryInput, {
          userId,
          operationId,
        });
        if (operationId)
          await tx.inventoryOperation.create({
            data: { operationId, itemId: inventoryInput.itemId, type: 'product.update' },
          });
      }
      if (operationId) {
        await tx.productOperation.create({
          data: { operationId, productId: updated.id, type: 'product.update' },
        });
      }
      if (userId && 'auditLog' in tx)
        await writeAudit(tx as Prisma.TransactionClient, {
          userId,
          ip,
          action: 'update',
          entityType: 'product',
          entityId: id,
          before: before ? { name: before.name, status: before.status } : undefined,
          after: { name: updated.name, status: updated.status },
          syncPayload: buildProductSyncPayload(updated),
        });
      if (inventoryItem && 'auditLog' in tx)
        await writeAudit(tx as Prisma.TransactionClient, {
          userId,
          ip,
          action: 'update',
          entityType: 'inventory_item',
          entityId: inventoryItem.id,
          syncPayload: buildInventoryItemSyncPayload(inventoryItem),
        });
      return { product: updated, inventoryItem };
    };
    const result = this.prisma.$transaction
      ? await this.prisma.$transaction(updateProduct)
      : await updateProduct(this.prisma);
    return { ok: true, data: { ...result.product, inventoryItem: result.inventoryItem } };
  }

  async softDelete(id: string, userId?: string, ip?: string) {
    await this.ensureExists(id);
    const product = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'hidden' },
      });
      await tx.inventoryItem.updateMany({ where: { productId: id }, data: { isActive: false } });
      // Offline clients must drop the product and every stock line of it;
      // both change rows travel in the same transaction as the mutation.
      if ('auditLog' in tx) {
        await writeAudit(tx, {
          userId,
          ip,
          action: 'delete',
          entityType: 'product',
          entityId: id,
          after: { status: 'hidden' },
          syncPayload: buildProductSyncPayload(updated),
        });
        const rows = await tx.inventoryItem.findMany({
          where: { productId: id },
          select: { id: true },
        });
        for (const row of rows)
          await writeAudit(tx, {
            userId,
            ip,
            action: 'delete',
            entityType: 'inventory_item',
            entityId: row.id,
          });
      }
      return updated;
    });
    return { ok: true, data: { id, deletedAt: product.deletedAt } };
  }
  async restore(id: string, userId?: string, ip?: string) {
    await this.ensureExists(id, true);
    const product = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: { deletedAt: null, status: 'active' },
      });
      if ('auditLog' in tx)
        await writeAudit(tx, {
          userId,
          ip,
          action: 'restore',
          entityType: 'product',
          entityId: id,
          after: { status: 'active' },
          syncPayload: buildProductSyncPayload(updated),
        });
      return updated;
    });
    return { ok: true, data: product };
  }

  private async ensureExists(id: string, deleted = false) {
    const product = await this.prisma.product.findFirst({
      where: { id, ...(deleted ? {} : { deletedAt: null }) },
    });
    if (!product) throw new NotFoundException('محصول پیدا نشد');
  }

  /** Parses and validates the nested `inventory` object of product.create.
   * Returns null when the caller did not send one (web panel flow). */
  private parseCreateInventory(value: unknown): ProductCreateInventoryInput | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value))
      throw new BadRequestException('ساختار inventory نامعتبر است');
    const raw = value as Record<string, unknown>;
    const input: ProductCreateInventoryInput = { initialQuantity: 0 };
    if (raw.brandId !== undefined && raw.brandId !== null) {
      if (typeof raw.brandId !== 'string' || !this.uuidValue(raw.brandId))
        throw new BadRequestException('brandId باید شناسهٔ معتبر برند باشد');
      input.brandId = raw.brandId;
    }
    if (raw.barcode !== undefined && raw.barcode !== null) {
      if (typeof raw.barcode !== 'string') throw new BadRequestException('بارکد نامعتبر است');
      input.barcode = raw.barcode;
    }
    if (raw.locationId !== undefined && raw.locationId !== null) {
      if (typeof raw.locationId !== 'string' || !this.uuidValue(raw.locationId))
        throw new BadRequestException('locationId باید شناسهٔ معتبر موقعیت باشد');
      input.locationId = raw.locationId;
    }
    input.purchasePrice = this.priceValue(raw.purchasePrice, 'قیمت خرید');
    input.salePrice = this.priceValue(raw.salePrice, 'قیمت فروش');
    if (raw.minStock !== undefined && raw.minStock !== null) {
      const minStock = Number(raw.minStock);
      if (!Number.isInteger(minStock) || minStock < 0)
        throw new BadRequestException('حداقل موجودی باید عدد صحیح و غیرمنفی باشد');
      input.minStock = minStock;
    }
    if (raw.initialQuantity !== undefined && raw.initialQuantity !== null) {
      const initialQuantity = Number(raw.initialQuantity);
      if (!Number.isInteger(initialQuantity) || initialQuantity < 0)
        throw new BadRequestException('موجودی اولیه باید عدد صحیح و غیرمنفی باشد');
      input.initialQuantity = initialQuantity;
    } else input.initialQuantity = 0;
    const provided = [
      'brandId',
      'barcode',
      'purchasePrice',
      'salePrice',
      'minStock',
      'locationId',
      'initialQuantity',
    ].filter((key) => raw[key] !== undefined && raw[key] !== null);
    if (!provided.length)
      throw new BadRequestException('inventory خالی است؛ فیلدی برای ثبت ارسال نشده است');
    return input;
  }

  /** Parses the multi-line `items` array of product.create. The legacy single
   * `inventory` object is accepted as a one-element list; sending both forms
   * at once is rejected so the intent is never ambiguous. */
  private parseCreateItems(input: Record<string, unknown>): ProductCreateInventoryInput[] {
    const legacy = this.parseCreateInventory(input.inventory);
    const rawItems = input.items;
    if (rawItems === undefined || rawItems === null) return legacy ? [legacy] : [];
    if (!Array.isArray(rawItems)) throw new BadRequestException('ساختار items نامعتبر است');
    if (legacy && rawItems.length)
      throw new BadRequestException('فقط یکی از inventory یا items را ارسال کنید');
    if (rawItems.length > 50)
      throw new BadRequestException('حداکثر ۵۰ قلم موجودی در هر ثبت محصول مجاز است');
    return rawItems.map((value, index) => {
      const parsed = this.parseCreateInventory(value);
      if (!parsed)
        throw new BadRequestException(`ساختار قلم موجودی شمارهٔ ${index + 1} نامعتبر است`);
      return parsed;
    });
  }

  /** Parses the nested `inventory` object of product.update: metadata only,
   * bound to one explicit itemId that must belong to the product. */
  private parseUpdateInventory(
    productId: string,
    value: unknown,
  ): ProductUpdateInventoryInput | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value))
      throw new BadRequestException('ساختار inventory نامعتبر است');
    const raw = value as Record<string, unknown>;
    if (typeof raw.itemId !== 'string' || !this.uuidValue(raw.itemId))
      throw new BadRequestException('itemId قلم موجودی الزامی است');
    const input: ProductUpdateInventoryInput = { itemId: raw.itemId };
    if (raw.brandId !== undefined) {
      if (raw.brandId === null) input.brandId = null;
      else if (typeof raw.brandId === 'string' && this.uuidValue(raw.brandId))
        input.brandId = raw.brandId;
      else throw new BadRequestException('brandId باید شناسهٔ معتبر برند باشد');
    }
    if (raw.barcode !== undefined && raw.barcode !== null) {
      if (typeof raw.barcode !== 'string') throw new BadRequestException('بارکد نامعتبر است');
      input.barcode = raw.barcode;
    }
    if (raw.locationId !== undefined) {
      if (raw.locationId === null) input.locationId = null;
      else if (typeof raw.locationId === 'string' && this.uuidValue(raw.locationId))
        input.locationId = raw.locationId;
      else throw new BadRequestException('locationId باید شناسهٔ معتبر موقعیت باشد');
    }
    if (raw.purchasePrice !== undefined)
      input.purchasePrice = this.priceValue(raw.purchasePrice, 'قیمت خرید', true);
    if (raw.salePrice !== undefined)
      input.salePrice = this.priceValue(raw.salePrice, 'قیمت فروش', true);
    if (raw.minStock !== undefined) {
      if (raw.minStock === null) input.minStock = null;
      else {
        const minStock = Number(raw.minStock);
        if (!Number.isInteger(minStock) || minStock < 0)
          throw new BadRequestException('حداقل موجودی باید عدد صحیح و غیرمنفی باشد');
        input.minStock = minStock;
      }
    }
    if (raw.notes !== undefined) {
      if (typeof raw.notes !== 'string') throw new BadRequestException('یادداشت نامعتبر است');
      input.notes = raw.notes;
    }
    return input;
  }

  /** Applies validated inventory metadata inside the product transaction.
   * Quantity is never touched here — stock moves only through commands. */
  private async applyInventoryMetadata(
    tx: Prisma.TransactionClient | typeof this.prisma,
    productId: string,
    input: ProductUpdateInventoryInput,
    context?: { userId?: string; operationId?: string },
  ) {
    const existing = await tx.inventoryItem.findUnique({ where: { id: input.itemId } });
    if (!existing || existing.productId !== productId || !existing.isActive)
      throw new BadRequestException('قلم موجودی متعلق به این محصول نیست');
    const data: Record<string, unknown> = {};
    if (input.brandId !== undefined) {
      if (input.brandId) {
        const brand = await tx.brand.findUnique({ where: { id: input.brandId } });
        if (!brand || !brand.isActive) throw new BadRequestException('برند نامعتبر است');
        const duplicate = await tx.inventoryItem.findFirst({
          where: { productId, brandId: input.brandId, id: { not: input.itemId } },
          select: { id: true },
        });
        if (duplicate) throw new BadRequestException('این برند قبلاً برای همین محصول ثبت شده است');
      }
      data.brandId = input.brandId;
    }
    if (input.barcode !== undefined && input.barcode !== '') {
      const barcode = input.barcode.trim();
      if (!/^\d{4,20}$/.test(barcode)) throw new BadRequestException('بارکد باید ۴ تا ۲۰ رقم باشد');
      if (barcode !== existing.barcode) {
        const taken = await tx.inventoryItem.findUnique({ where: { barcode } });
        if (taken && taken.id !== input.itemId)
          throw new BadRequestException('این بارکد قبلاً برای قلم دیگری ثبت شده است');
      }
      data.barcode = barcode;
    }
    if (input.locationId !== undefined) {
      if (input.locationId) {
        const location = await tx.location.findUnique({ where: { id: input.locationId } });
        if (!location) throw new BadRequestException('موقعیت انبار نامعتبر است');
      }
      data.locationId = input.locationId;
    }
    if (input.purchasePrice !== undefined) data.purchasePrice = input.purchasePrice;
    if (input.salePrice !== undefined) data.salePrice = input.salePrice;
    if (input.minStock !== undefined) data.minStock = input.minStock;
    if (input.notes !== undefined) data.notes = input.notes.trim() || null;
    // A real sale-price change stamps the badge timestamp on the line.
    const nextSalePrice = input.salePrice ?? existing.salePrice;
    if (nextSalePrice !== existing.salePrice) data.priceUpdatedAt = new Date();
    if (Object.keys(data).length === 0) return existing;
    const updated = await tx.inventoryItem.update({
      where: { id: input.itemId },
      data: data as never,
    });
    await recordSalePriceChange(tx, {
      itemId: input.itemId,
      oldSalePrice: existing.salePrice,
      newSalePrice: nextSalePrice,
      userId: context?.userId,
      source: context?.operationId ? 'android' : 'panel',
      operationId: context?.operationId,
    });
    return updated;
  }

  /** Idempotent replay of product.create: rebuilds the exact result (product
   * + every inventory line this operation created) without writing anything. */
  private async loadCreateResult(
    tx: Prisma.TransactionClient | typeof this.prisma,
    productId: string,
    operationId: string,
  ) {
    const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    const operations = await this.findInventoryOperations(tx, operationId);
    const inventoryItems = operations.length
      ? await tx.inventoryItem.findMany({
          where: { id: { in: operations.map((operation) => operation.itemId) } },
          orderBy: { id: 'asc' },
        })
      : await tx.inventoryItem.findMany({
          where: { productId, isActive: true },
          orderBy: { id: 'asc' },
        });
    return { product, inventoryItems, inventoryItem: inventoryItems[0] ?? null };
  }

  /** Idempotent replay of product.update. */
  private async loadUpdateResult(
    tx: Prisma.TransactionClient | typeof this.prisma,
    productId: string,
    operationId: string,
  ) {
    const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    const operation = await this.findInventoryOperation(tx, operationId);
    const inventoryItem = operation
      ? await tx.inventoryItem.findUnique({ where: { id: operation.itemId } })
      : null;
    return { product, inventoryItem };
  }

  private async findInventoryOperation(
    tx: Prisma.TransactionClient | typeof this.prisma,
    operationId: string,
  ) {
    const rows = await this.findInventoryOperations(tx, operationId);
    return rows[0] ?? null;
  }

  /** Every inventory row recorded under one operationId — a multi-line
   * product.create writes one per created stock line. */
  private async findInventoryOperations(
    tx: Prisma.TransactionClient | typeof this.prisma,
    operationId: string,
  ) {
    const delegate = (
      tx as unknown as {
        inventoryOperation?: {
          findFirst?: (args: unknown) => Promise<{ itemId: string } | null>;
          findMany?: (args: unknown) => Promise<Array<{ itemId: string }>>;
        };
      }
    ).inventoryOperation;
    if (delegate?.findMany) {
      const rows = await delegate.findMany({ where: { operationId } }).catch(() => []);
      if (rows.length) return rows;
    }
    if (!delegate?.findFirst) return [];
    const single = await delegate.findFirst({ where: { operationId } }).catch(() => null);
    return single ? [single] : [];
  }

  private uuidValue(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  /** Money arrives as string or number from mobile; BigInt keeps rials exact. */
  private priceValue(value: unknown, label: string, optional = false): bigint | undefined {
    if (value === undefined || value === null || value === '') {
      if (optional) return undefined;
      return 0n;
    }
    if (typeof value === 'bigint') {
      if (value < 0n) throw new BadRequestException(`${label} نمی‌تواند منفی باشد`);
      return value;
    }
    if (typeof value !== 'string' && typeof value !== 'number')
      throw new BadRequestException(`${label} نامعتبر است`);
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) throw new BadRequestException(`${label} نامعتبر است`);
    return BigInt(text);
  }

  private nextCode(prefix: string) {
    return this.nextCodeInTx(this.prisma, prefix);
  }

  /** Same as nextCode, but on the caller's transaction — the counter
   * increment commits (or rolls back) atomically with the row that consumes
   * the code, so retries can never diverge from the counter. */
  private async nextCodeInTx(tx: Prisma.TransactionClient | typeof this.prisma, prefix: string) {
    const counter = await tx.counter.upsert({
      where: { key: prefix },
      update: { lastValue: { increment: 1 } },
      create: { key: prefix, lastValue: 1 },
    });
    return `${prefix.toUpperCase()}-${String(counter.lastValue).padStart(5, '0')}`;
  }
  private priceDisplayValue(value: unknown): 'inherit' | 'show' | 'hide' | null {
    if (value === undefined || value === null || value === '') return null;
    if (value === 'inherit' || value === 'show' || value === 'hide') return value;
    throw new BadRequestException('نمایش قیمت باید inherit، show یا hide باشد');
  }

  private stringValue(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }
  private optionalString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private stringArray(value: unknown) {
    if (!Array.isArray(value)) return null;
    const items = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return items.length ? items : null;
  }
}
