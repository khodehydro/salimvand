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
    const inventoryInput = this.parseCreateInventory(input.inventory);
    if (inventoryInput && inventoryInput.initialQuantity > 0 && !userId)
      throw new BadRequestException('کاربر ثبت‌کنندهٔ موجودی الزامی است');
    const code = await this.nextCode('product');
    const seo = buildProductSeo({ name, slug: this.optionalString(input.slug) ?? undefined });
    const createProduct = async (tx: Prisma.TransactionClient | typeof this.prisma) => {
      if (operationId) {
        const previous = await tx.productOperation.findUnique({ where: { operationId } });
        if (previous) return this.loadCreateResult(tx, previous.productId, operationId);
      }
      // Reference integrity is checked explicitly (not left to the database
      // FK error) so a mobile payload with a stale categoryId/brandId gets a
      // readable 400 instead of a 500.
      const category = await tx.category.findUnique({ where: { id: categoryId } });
      if (!category || !category.isActive) throw new BadRequestException('دسته‌بندی نامعتبر است');
      let brandId: string | null = null;
      if (inventoryInput?.brandId) {
        const brand = await tx.brand.findUnique({ where: { id: inventoryInput.brandId } });
        if (!brand || !brand.isActive) throw new BadRequestException('برند نامعتبر است');
        brandId = brand.id;
      }
      let locationId: string | null = null;
      if (inventoryInput?.locationId) {
        const location = await tx.location.findUnique({ where: { id: inventoryInput.locationId } });
        if (!location) throw new BadRequestException('موقعیت انبار نامعتبر است');
        locationId = location.id;
      }
      let barcode = inventoryInput?.barcode?.trim() ?? '';
      if (barcode) {
        if (!/^\d{4,20}$/.test(barcode))
          throw new BadRequestException('بارکد باید ۴ تا ۲۰ رقم باشد');
        const taken = await tx.inventoryItem.findUnique({ where: { barcode } });
        if (taken) throw new BadRequestException('این بارکد قبلاً برای قلم دیگری ثبت شده است');
      } else {
        barcode = createEan13(`${Date.now()}${categoryId.replace(/-/g, '')}`.slice(-9));
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
      let inventoryItem = null;
      if (inventoryInput) {
        // One product, exactly one inventory line, and the opening stock is
        // recorded as a type=initial ledger entry — quantity is never set
        // outside the ledger.
        inventoryItem = await tx.inventoryItem.create({
          data: {
            productId: created.id,
            brandId,
            barcode,
            quantity: inventoryInput.initialQuantity,
            purchasePrice: inventoryInput.purchasePrice,
            salePrice: inventoryInput.salePrice,
            minStock: inventoryInput.minStock,
            locationId,
            // Opening price entry — only when a price was actually set.
            ...(inventoryInput.salePrice && inventoryInput.salePrice > 0n
              ? { priceUpdatedAt: new Date() }
              : {}),
          },
        });
        await recordSalePriceChange(tx, {
          itemId: inventoryItem.id,
          oldSalePrice: null,
          newSalePrice: inventoryInput.salePrice ?? 0n,
          userId,
          source: operationId ? 'android' : 'panel',
          operationId,
        });
        if (inventoryInput.initialQuantity > 0)
          await tx.inventoryTransaction.create({
            data: {
              itemId: inventoryItem.id,
              type: 'initial',
              quantityChange: inventoryInput.initialQuantity,
              quantityAfter: inventoryInput.initialQuantity,
              userId: userId!,
              reason: 'موجودی اولیه',
              operationId,
            },
          });
        if (operationId)
          await tx.inventoryOperation.create({
            data: { operationId, itemId: inventoryItem.id, type: 'product.create' },
          });
      } else if (!Array.isArray(input.inventoryBrandIds) || input.inventoryBrandIds.length === 0) {
        // InventoryItem requires a brand for barcode, stock and shelf tracking.
        // Keep catalog-only product creation consistent by creating one neutral
        // inventory line when the operator did not provide a brand yet.
        inventoryItem = await tx.inventoryItem.create({
          data: {
            productId: created.id,
            barcode: createEan13(`${Date.now()}${created.id.replace(/-/g, '')}`.slice(-9)),
            purchasePrice: 0n,
            salePrice: 0n,
            quantity: 0,
          },
        });
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
      if (inventoryItem && 'auditLog' in tx)
        await writeAudit(tx as Prisma.TransactionClient, {
          userId,
          ip,
          action: 'create',
          entityType: 'inventory_item',
          entityId: inventoryItem.id,
          syncPayload: buildInventoryItemSyncPayload(inventoryItem),
        });
      return { product: created, inventoryItem };
    };
    const result = this.prisma.$transaction
      ? await this.prisma.$transaction(createProduct)
      : await createProduct(this.prisma);
    return { ok: true, data: { ...result.product, inventoryItem: result.inventoryItem } };
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
   * + the inventory line this operation created) without writing anything. */
  private async loadCreateResult(
    tx: Prisma.TransactionClient | typeof this.prisma,
    productId: string,
    operationId: string,
  ) {
    const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    const operation = await this.findInventoryOperation(tx, operationId);
    const inventoryItem = operation
      ? await tx.inventoryItem.findUnique({ where: { id: operation.itemId } })
      : await tx.inventoryItem.findFirst({
          where: { productId, isActive: true },
          orderBy: { id: 'asc' },
        });
    return { product, inventoryItem };
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
    const delegate = (
      tx as unknown as {
        inventoryOperation?: { findUnique: (args: unknown) => Promise<{ itemId: string } | null> };
      }
    ).inventoryOperation;
    if (!delegate?.findUnique) return null;
    return delegate.findUnique({ where: { operationId } }).catch(() => null);
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

  private async nextCode(prefix: string) {
    const counter = await this.prisma.counter.upsert({
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
