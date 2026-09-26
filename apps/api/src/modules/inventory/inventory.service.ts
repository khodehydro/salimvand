import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Prisma } from '@prisma/client';
import { createEan13, formatJalaliDate } from '@salimvand/shared';
import { calculateNextQuantity } from './inventory.rules';
import { writeAudit, writeSyncChange } from '../../common/audit/audit-log';
import { buildInventoryItemSyncPayload } from '../../common/sync/sync-payloads';
import { recordSalePriceChange } from '../../common/inventory/price-history';
import { resolvePlacement } from '../../common/inventory/placement';

export type StockMutation = {
  itemId: string;
  quantity: number;
  userId: string;
  reason?: string;
  refType?: string;
  refId?: string;
  operationId?: string;
};

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    // One SQL aggregate instead of pulling every row into memory — with tens
    // of thousands of items the old reduce blocked the event loop.
    const [row] = await this.prisma.$queryRaw<
      {
        itemCount: number;
        totalQuantity: bigint;
        purchaseValue: bigint;
        saleValue: bigint;
        lowStockCount: number;
        outOfStockCount: number;
      }[]
    >`
      SELECT COUNT(*)::int AS "itemCount",
             COALESCE(SUM(i.quantity), 0)::bigint AS "totalQuantity",
             COALESCE(SUM(i.quantity * i."purchasePrice"), 0)::bigint AS "purchaseValue",
             COALESCE(SUM(i.quantity * i."salePrice"), 0)::bigint AS "saleValue",
             COALESCE(SUM(CASE WHEN i.quantity <= COALESCE(i."minStock", 0) THEN 1 ELSE 0 END), 0)::int AS "lowStockCount",
             COALESCE(SUM(CASE WHEN i.quantity <= 0 THEN 1 ELSE 0 END), 0)::int AS "outOfStockCount"
      FROM "inventory_items" i
      JOIN "products" p ON p.id = i."productId"
      WHERE i."isActive" = true AND p."deletedAt" IS NULL`;
    return {
      ok: true,
      data: {
        itemCount: row?.itemCount ?? 0,
        totalQuantity: (row?.totalQuantity ?? 0n).toString(),
        purchaseValue: (row?.purchaseValue ?? 0n).toString(),
        saleValue: (row?.saleValue ?? 0n).toString(),
        lowStockCount: row?.lowStockCount ?? 0,
        outOfStockCount: row?.outOfStockCount ?? 0,
      },
    };
  }

  async list(
    filters: {
      q?: string;
      brandId?: string;
      locationId?: string;
      status?: 'low' | 'out';
      cursor?: string;
      limit?: string;
    } = {},
  ) {
    const q = filters.q?.trim();
    const limit = Math.min(500, Math.max(1, Number(filters.limit ?? 200) || 200));
    // Prisma cannot compare two columns (quantity <= minStock), so the status
    // views are pre-filtered in SQL: the raw id universe replaces the old
    // fetch-everything-then-filter-in-JS pass.
    const statusUniverse =
      filters.status === 'low' || filters.status === 'out'
        ? await this.prisma.$queryRaw<Array<{ id: string }>>`
            SELECT i.id FROM "inventory_items" i
            JOIN "products" p ON p.id = i."productId"
            WHERE i."isActive" = true
              AND p."deletedAt" IS NULL
              AND i.quantity ${filters.status === 'out' ? Prisma.sql`<= 0` : Prisma.sql`<= COALESCE(i."minStock", 0)`}`
        : null;
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        isActive: true,
        product: { deletedAt: null },
        ...(filters.brandId ? { brandId: filters.brandId } : {}),
        // A shelf filter must not hide the parts filed in its baskets: the
        // scope follows the placement tree, not just the column.
        ...(filters.locationId ? await this.locationScope(filters.locationId) : {}),
        ...(statusUniverse
          ? {
              id: {
                in: statusUniverse.map((row) => row.id),
                ...(filters.cursor ? { lt: filters.cursor } : {}),
              },
            }
          : filters.cursor
            ? { id: { lt: filters.cursor } }
            : {}),
        // Live panel search matches barcode, product name, product code and
        // brand name — one input, no button to press.
        ...(q
          ? {
              OR: [
                { barcode: { contains: q } },
                { product: { name: { contains: q, mode: 'insensitive' } } },
                { product: { code: { contains: q, mode: 'insensitive' } } },
                { brand: { name: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: {
        brand: true,
        // parent = the warehouse (انبار) of the shelf — the panel always
        // shows placement as «انبار · قفسه · سبد».
        location: { include: { parent: true } },
        // The basket (سبد) the part is filed in, if any.
        basket: true,
        // Primary image first so the panel's grouped stock list can show a
        // thumbnail without pulling every image of every product; category
        // and compatibilities feed the richer list chips.
        product: {
          include: {
            images: { orderBy: [{ isPrimary: 'desc' }, { sort: 'asc' }], take: 1 },
            category: true,
            compatibilities: { include: { model: { include: { make: true } } } },
          },
        },
      },
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return {
      ok: true,
      data: page,
      hasMore,
      nextCursor: hasMore && page.length ? page[page.length - 1].id : null,
    };
  }

  /** Label-ready rows for the panel's product-label studio (برچسب محصولات):
   * one flat DTO per inventory item — product name, SKU (product code), brand,
   * category chip, compatible vehicles string and the real scannable barcode. */
  async labelItems(q?: string) {
    const query = q?.trim();
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        isActive: true,
        product: { deletedAt: null },
        ...(query
          ? {
              OR: [
                { barcode: { contains: query } },
                { product: { name: { contains: query, mode: 'insensitive' } } },
                { product: { code: { contains: query, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      orderBy: [{ product: { name: 'asc' } }],
      take: 200,
      include: {
        brand: true,
        product: {
          include: {
            category: true,
            compatibilities: { include: { model: { include: { make: true } } } },
          },
        },
      },
    });
    return {
      ok: true,
      data: items.map((item) => {
        const seen = new Set<string>();
        const vehicles: string[] = [];
        for (const entry of item.product.compatibilities) {
          const label = entry.model.name;
          if (seen.has(label)) continue;
          seen.add(label);
          vehicles.push(label);
        }
        // The label meta row ellipsizes, but keep the payload small anyway.
        const vehicleText =
          vehicles.length > 4
            ? `${vehicles.slice(0, 4).join(' · ')} و ${vehicles.length - 4} مورد دیگر`
            : vehicles.join(' · ');
        return {
          id: item.id,
          // Lets the products list deep-link into the label studio by
          // product (#/labels?product=…) even before any item is picked.
          productId: item.product.id,
          barcode: item.barcode,
          name: item.product.name,
          sku: item.product.code,
          brand: item.brand?.name ?? 'بدون برند',
          category: item.product.category.name,
          vehicles: vehicleText,
          quantity: item.quantity,
        };
      }),
    };
  }

  /** Scope of `GET /inventory/items?locationId=…`: filtering by a shelf also
   * returns the parts inside that shelf's baskets, and filtering by a basket
   * returns only the parts filed in it. */
  private async locationScope(locationId: string): Promise<Prisma.InventoryItemWhereInput> {
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!location) return { locationId };
    if (location.type === 'basket') return { basketId: location.id };
    if (location.type === 'warehouse')
      return {
        OR: [
          { location: { parentId: location.id } },
          { basket: { parent: { parentId: location.id } } },
        ],
      };
    return {
      OR: [{ locationId: location.id }, { basket: { parentId: location.id } }],
    };
  }

  async create(input: {
    productId?: string;
    brandId?: string;
    barcode?: string;
    purchasePrice?: number;
    salePrice?: number;
    minStock?: number;
    locationId?: string;
    basketId?: string;
    initialQuantity?: number;
    userId?: string;
  }) {
    if (!input.productId) throw new BadRequestException('محصول الزامی است');
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, deletedAt: null },
    });
    if (!product) throw new NotFoundException('محصول پیدا نشد');
    const barcode = input.barcode?.trim() || createEan13(`${Date.now()}`);
    // Readable 400s instead of an opaque unique-constraint 500 — these are
    // the two duplicates an operator actually hits from the product form.
    const barcodeTaken = await this.prisma.inventoryItem.findFirst({
      where: { barcode },
      select: { id: true },
    });
    if (barcodeTaken) throw new BadRequestException('این بارکد قبلاً برای قلم دیگری ثبت شده است');
    const brandDuplicate = await this.prisma.inventoryItem.findFirst({
      where: { productId: input.productId, brandId: input.brandId ?? null },
      select: { id: true },
    });
    if (brandDuplicate) throw new BadRequestException('این برند قبلاً برای همین محصول ثبت شده است');
    const initialQuantity = input.initialQuantity ?? 0;
    if (!Number.isInteger(initialQuantity) || initialQuantity < 0)
      throw new BadRequestException('موجودی اولیه باید عدد صحیح و غیرمنفی باشد');
    if (initialQuantity > 0 && !input.userId)
      throw new BadRequestException('کاربر ثبت‌کنندهٔ موجودی الزامی است');
    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const salePrice = BigInt(input.salePrice ?? 0);
      // Shelf + basket are validated together: a basket must belong to the
      // line's shelf, and picking only a basket fills the shelf in.
      const placement = await resolvePlacement(tx, {
        locationId: input.locationId,
        basketId: input.basketId,
      });
      const item = await tx.inventoryItem.create({
        data: {
          productId: input.productId!,
          brandId: input.brandId,
          barcode,
          quantity: initialQuantity,
          purchasePrice: BigInt(input.purchasePrice ?? 0),
          salePrice,
          minStock: input.minStock,
          locationId: placement.locationId,
          basketId: placement.basketId,
          // Opening price entry — only when a price was actually set.
          ...(salePrice > 0n ? { priceUpdatedAt: new Date() } : {}),
        },
      });
      await recordSalePriceChange(tx, {
        itemId: item.id,
        oldSalePrice: null,
        newSalePrice: salePrice,
        userId: input.userId,
        source: 'panel',
      });
      if (initialQuantity > 0)
        await tx.inventoryTransaction.create({
          data: {
            itemId: item.id,
            type: 'initial',
            quantityChange: initialQuantity,
            quantityAfter: initialQuantity,
            userId: input.userId!,
            reason: 'موجودی اولیه',
          },
        });
      // Panel-created stock lines must reach offline clients through pull.
      if ('auditLog' in tx)
        await writeAudit(tx, {
          userId: input.userId,
          action: 'create',
          entityType: 'inventory_item',
          entityId: item.id,
          syncPayload: buildInventoryItemSyncPayload(item),
        });
      return item;
    });
    return { ok: true, data: result };
  }

  async bulkUpdatePrices(input: {
    brandId?: string;
    categoryId?: string;
    salePercent?: number;
    purchasePercent?: number;
    roundTo?: number;
  }) {
    const salePercent = Number(input.salePercent ?? 0);
    const purchasePercent = Number(input.purchasePercent ?? 0);
    const roundTo = Math.max(0, Number(input.roundTo ?? 0));
    if (!input.brandId && !input.categoryId)
      throw new BadRequestException('برند یا دسته‌بندی را انتخاب کنید');
    if (!salePercent && !purchasePercent)
      throw new BadRequestException('درصد تغییر قیمت را وارد کنید');
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        isActive: true,
        ...(input.brandId ? { brandId: input.brandId } : {}),
        ...(input.categoryId ? { product: { categoryId: input.categoryId } } : {}),
      },
      select: { id: true, purchasePrice: true, salePrice: true },
    });
    for (const item of items) {
      const apply = (value: bigint, percent: number) => {
        if (!percent) return value;
        const next = Number(value) * (1 + percent / 100);
        return BigInt(roundTo > 0 ? Math.round(next / roundTo) * roundTo : Math.round(next));
      };
      const nextSalePrice = apply(item.salePrice, salePercent);
      const updated = await this.prisma.inventoryItem.update({
        where: { id: item.id },
        data: {
          purchasePrice: apply(item.purchasePrice, purchasePercent),
          salePrice: nextSalePrice,
          ...(salePercent && nextSalePrice !== item.salePrice
            ? { priceUpdatedAt: new Date() }
            : {}),
        },
      });
      // A bulk reprice is part of the price history too (source=bulk).
      await recordSalePriceChange(this.prisma, {
        itemId: item.id,
        oldSalePrice: item.salePrice,
        newSalePrice: nextSalePrice,
        source: 'bulk',
      });
      // A bulk price change must also refresh offline caches: one change row
      // per item, without flooding the audit log with hundreds of entries.
      await writeSyncChange(this.prisma, {
        entityType: 'inventory_item',
        entityId: item.id,
        action: 'updated',
        payload: buildInventoryItemSyncPayload(updated),
      });
    }
    return { ok: true, data: { updated: items.length } };
  }

  async adjust(input: StockMutation) {
    return this.mutate(input, 'adjustment');
  }

  async receive(input: StockMutation) {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0)
      throw new BadRequestException('تعداد ورود باید مثبت باشد');
    return this.mutate(input, 'purchase');
  }

  /** Offline command `inventory.update_metadata`: prices, shelf, barcode and
   * brand of one stock line. Quantity is intentionally not accepted — stock
   * may only move through receive/adjust. Idempotent per operationId. */
  async updateMetadata(
    input: {
      itemId: string;
      purchasePrice?: string | number;
      salePrice?: string | number;
      minStock?: number | null;
      locationId?: string | null;
      basketId?: string | null;
      barcode?: string;
      brandId?: string | null;
      notes?: string;
    },
    userId?: string,
    operationId?: string,
  ) {
    if (!input.itemId) throw new BadRequestException('itemId عملیات الزامی است');
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (operationId) {
        // operationId is no longer globally unique (a multi-line
        // product.create writes one row per item), so look up the first.
        const previous = await tx.inventoryOperation.findFirst({ where: { operationId } });
        if (previous) {
          const item = await tx.inventoryItem.findUnique({ where: { id: previous.itemId } });
          return { ok: true, data: item, duplicate: true };
        }
      }
      const existing = await tx.inventoryItem.findUnique({ where: { id: input.itemId } });
      if (!existing || !existing.isActive) throw new NotFoundException('قلم موجودی پیدا نشد');
      const data: Record<string, unknown> = {};
      if (input.brandId !== undefined) {
        if (input.brandId) {
          const brand = await tx.brand.findUnique({ where: { id: input.brandId } });
          if (!brand || !brand.isActive) throw new BadRequestException('برند نامعتبر است');
          const duplicate = await tx.inventoryItem.findFirst({
            where: {
              productId: existing.productId,
              brandId: input.brandId,
              id: { not: input.itemId },
            },
            select: { id: true },
          });
          if (duplicate)
            throw new BadRequestException('این برند قبلاً برای همین محصول ثبت شده است');
        }
        data.brandId = input.brandId;
      }
      if (input.barcode !== undefined && input.barcode !== '') {
        const barcode = input.barcode.trim();
        if (!/^\d{4,20}$/.test(barcode))
          throw new BadRequestException('بارکد باید ۴ تا ۲۰ رقم باشد');
        if (barcode !== existing.barcode) {
          const taken = await tx.inventoryItem.findUnique({ where: { barcode } });
          if (taken && taken.id !== input.itemId)
            throw new BadRequestException('این بارکد قبلاً برای قلم دیگری ثبت شده است');
        }
        data.barcode = barcode;
      }
      // Shelf + basket are resolved as one placement: the basket must belong
      // to the resulting shelf, and clearing the shelf clears the basket too
      // (a basket without its shelf is not a real address).
      const placement = await resolvePlacement(
        tx,
        { locationId: input.locationId, basketId: input.basketId },
        { locationId: existing.locationId, basketId: existing.basketId },
      );
      if (input.locationId !== undefined || input.basketId !== undefined) {
        if (placement.locationId) {
          const location = await tx.location.findUnique({
            where: { id: placement.locationId },
          });
          if (!location) throw new BadRequestException('موقعیت انبار نامعتبر است');
        }
        data.locationId = placement.locationId;
        data.basketId = placement.basketId;
      }
      for (const key of ['purchasePrice', 'salePrice'] as const) {
        const value = input[key];
        if (value === undefined) continue;
        if (typeof value !== 'string' && typeof value !== 'number')
          throw new BadRequestException('قیمت نامعتبر است');
        const text = String(value).trim();
        if (!/^\d+$/.test(text)) throw new BadRequestException('قیمت نامعتبر است');
        data[key] = BigInt(text);
      }
      if (input.minStock !== undefined) {
        if (input.minStock === null) data.minStock = null;
        else {
          if (!Number.isInteger(input.minStock) || input.minStock < 0)
            throw new BadRequestException('حداقل موجودی باید عدد صحیح و غیرمنفی باشد');
          data.minStock = input.minStock;
        }
      }
      if (input.notes !== undefined) data.notes = input.notes.trim() || null;
      if (!Object.keys(data).length) throw new BadRequestException('تغییری ارسال نشده است');
      // A real sale-price change stamps the badge timestamp on the line.
      const nextSalePrice = (data.salePrice as bigint | undefined) ?? existing.salePrice;
      if (nextSalePrice !== existing.salePrice) data.priceUpdatedAt = new Date();
      const item = await tx.inventoryItem.update({
        where: { id: input.itemId },
        data: data as never,
        include: {
          product: true,
          brand: true,
          location: { include: { parent: true } },
          basket: true,
        },
      });
      await recordSalePriceChange(tx, {
        itemId: input.itemId,
        oldSalePrice: existing.salePrice,
        newSalePrice: nextSalePrice,
        userId,
        source: operationId ? 'android' : 'panel',
        operationId,
      });
      if (operationId)
        await tx.inventoryOperation.create({
          data: { operationId, itemId: input.itemId, type: 'inventory.update_metadata' },
        });
      await writeAudit(tx, {
        userId,
        action: 'update',
        entityType: 'inventory_item',
        entityId: input.itemId,
        before: {
          purchasePrice: existing.purchasePrice.toString(),
          salePrice: existing.salePrice.toString(),
          minStock: existing.minStock,
          locationId: existing.locationId,
          basketId: existing.basketId,
          barcode: existing.barcode,
        },
        after: {
          purchasePrice: item.purchasePrice.toString(),
          salePrice: item.salePrice.toString(),
          minStock: item.minStock,
          locationId: item.locationId,
          basketId: item.basketId,
          barcode: item.barcode,
        },
        syncPayload: buildInventoryItemSyncPayload(item),
      });
      return { ok: true, data: item, duplicate: false };
    });
  }

  /** Moves a stock line to another shelf and, when given, another basket of
   * that shelf — «انتقال قفسه/سبد». */
  async transfer(
    itemId: string,
    locationId: string,
    userId: string,
    operationId?: string,
    basketId?: string | null,
  ) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (operationId) {
        const previous = await tx.inventoryTransaction.findUnique({ where: { operationId } });
        if (previous) {
          const item = await tx.inventoryItem.findUnique({ where: { id: itemId } });
          return { ok: true, data: { item, transaction: previous }, duplicate: true };
        }
      }
      const current = await tx.inventoryItem.findUnique({ where: { id: itemId } });
      if (!current) throw new NotFoundException('قلم موجودی پیدا نشد');
      // A transfer always targets a shelf; an optional basket must be one of
      // that shelf's baskets (resolvePlacement enforces it).
      const placement = await resolvePlacement(
        tx,
        { locationId: locationId || null, basketId: basketId ?? null },
        { locationId: current.locationId, basketId: current.basketId },
      );
      if (placement.locationId) {
        const location = await tx.location.findUnique({ where: { id: placement.locationId } });
        if (!location) throw new BadRequestException('موقعیت انبار نامعتبر است');
      }
      const item = await tx.inventoryItem.update({
        where: { id: itemId },
        data: { locationId: placement.locationId, basketId: placement.basketId },
      });
      const transaction = await tx.inventoryTransaction.create({
        data: {
          itemId,
          type: 'transfer',
          quantityChange: 0,
          quantityAfter: current.quantity,
          userId,
          reason: `انتقال به موقعیت ${placement.locationId ?? '—'}${
            placement.basketId ? ` / سبد ${placement.basketId}` : ''
          }`,
          operationId,
        },
      });
      await writeAudit(tx, {
        userId,
        action: 'update',
        entityType: 'inventory_item',
        entityId: itemId,
        before: { locationId: current.locationId, basketId: current.basketId },
        after: { locationId: item.locationId, basketId: item.basketId },
        syncPayload: buildInventoryItemSyncPayload(item),
      });
      return { ok: true, data: { item, transaction } };
    });
  }

  async lowStock() {
    // The low-stock condition (quantity <= COALESCE(minStock, 0)) runs in SQL —
    // the old version pulled the whole table and filtered in JavaScript.
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "inventory_items"
      WHERE "isActive" = true AND quantity <= COALESCE("minStock", 0)
      ORDER BY quantity ASC, id ASC`;
    if (!rows.length) return { ok: true, data: [] };
    const items = await this.prisma.inventoryItem.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      // Same shape as list() so the panel can render low-stock rows with the
      // identical rich cards.
      include: {
        brand: true,
        location: { include: { parent: true } },
        basket: true,
        product: {
          include: {
            images: { orderBy: [{ isPrimary: 'desc' }, { sort: 'asc' }], take: 1 },
            category: true,
            compatibilities: { include: { model: { include: { make: true } } } },
          },
        },
      },
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    const ordered = rows
      .map((row) => byId.get(row.id))
      .filter((item): item is (typeof items)[number] => Boolean(item));
    return { ok: true, data: ordered };
  }

  async byBarcode(barcode: string) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { barcode },
      include: { product: true, brand: true, location: { include: { parent: true } }, basket: true },
    });
    if (!item) throw new NotFoundException('بارکد پیدا نشد');
    return { ok: true, data: item };
  }

  async transactions(itemId: string) {
    const rows = await this.prisma.inventoryTransaction.findMany({
      where: { itemId },
      orderBy: { createdAt: 'desc' },
    });
    return { ok: true, data: rows };
  }

  /** Sale-price timeline of one stock line — the inflation-management view.
   * Timestamps are ISO for sorting and pre-formatted Shamsi (fa-IR persian
   * calendar) so every client renders the same date without a local library. */
  async priceHistory(itemId: string) {
    const rows = await this.prisma.inventoryPriceHistory.findMany({
      where: { itemId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { name: true } } },
    });
    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.id.toString(),
        itemId: row.itemId,
        oldSalePrice: row.oldSalePrice === null ? null : row.oldSalePrice.toString(),
        newSalePrice: row.newSalePrice.toString(),
        source: row.source,
        userName: row.user?.name ?? null,
        changedAt: row.createdAt.toISOString(),
        changedAtJalali: formatJalaliDate(row.createdAt, 'dateTime'),
      })),
    };
  }

  async removeItem(id: string, userId?: string) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
      include: { product: true },
    });
    if (!item) throw new NotFoundException('قلم موجودی پیدا نشد');
    const updated = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const row = await tx.inventoryItem.update({ where: { id }, data: { isActive: false } });
      await writeAudit(tx, {
        userId,
        action: 'delete',
        entityType: 'inventory_item',
        entityId: id,
        after: { isActive: false, productId: item.productId },
      });
      return row;
    });
    return { ok: true, data: { id: updated.id, isActive: updated.isActive } };
  }

  async updateItem(
    id: string,
    data: {
      minStock?: number;
      locationId?: string | null;
      basketId?: string | null;
      salePrice?: number;
      purchasePrice?: number;
      isActive?: boolean;
      notes?: string;
    },
    userId?: string,
  ) {
    const existing = await this.prisma.inventoryItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('قلم موجودی پیدا نشد');
    // Shelf + basket travel together: validate the pair before the write so
    // a stale basket from another shelf can never be saved.
    const placement = await resolvePlacement(
      this.prisma,
      { locationId: data.locationId, basketId: data.basketId },
      { locationId: existing.locationId, basketId: existing.basketId },
    );
    const placementTouched = data.locationId !== undefined || data.basketId !== undefined;

    const updated = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const nextSalePrice =
        data.salePrice !== undefined ? BigInt(data.salePrice) : existing.salePrice;
      const item = await tx.inventoryItem.update({
        where: { id },
        data: {
          minStock: data.minStock !== undefined ? data.minStock : undefined,
          locationId: placementTouched ? placement.locationId : undefined,
          basketId: placementTouched ? placement.basketId : undefined,
          salePrice: data.salePrice !== undefined ? BigInt(data.salePrice) : undefined,
          purchasePrice: data.purchasePrice !== undefined ? BigInt(data.purchasePrice) : undefined,
          isActive: data.isActive !== undefined ? data.isActive : undefined,
          notes: data.notes !== undefined ? data.notes : undefined,
          ...(nextSalePrice !== existing.salePrice ? { priceUpdatedAt: new Date() } : {}),
        },
        include: {
          product: true,
          brand: true,
          location: { include: { parent: true } },
          basket: true,
        },
      });
      await recordSalePriceChange(tx, {
        itemId: id,
        oldSalePrice: existing.salePrice,
        newSalePrice: nextSalePrice,
        userId,
        source: 'panel',
      });

      if (userId) {
        await writeAudit(tx, {
          userId,
          action: 'update',
          entityType: 'inventory_item',
          entityId: id,
          before: {
            minStock: existing.minStock,
            locationId: existing.locationId,
            basketId: existing.basketId,
            salePrice: String(existing.salePrice),
            purchasePrice: String(existing.purchasePrice),
          },
          after: {
            minStock: item.minStock,
            locationId: item.locationId,
            basketId: item.basketId,
            salePrice: String(item.salePrice),
            purchasePrice: String(item.purchasePrice),
          },
          syncPayload: buildInventoryItemSyncPayload(item),
        });
      }
      return item;
    });

    return { ok: true, data: updated };
  }

  async reconciliation() {
    const items = await this.prisma.inventoryItem.findMany({
      select: { id: true, barcode: true, quantity: true },
    });
    const anomalies: Array<{
      itemId: string;
      barcode: string;
      recordedQuantity: number;
      ledgerQuantity: number;
      drift: number;
    }> = [];

    for (const item of items) {
      const agg = await this.prisma.inventoryTransaction.aggregate({
        where: { itemId: item.id },
        _sum: { quantityChange: true },
      });
      const ledgerSum = agg._sum.quantityChange ?? 0;
      if (ledgerSum !== item.quantity) {
        anomalies.push({
          itemId: item.id,
          barcode: item.barcode,
          recordedQuantity: item.quantity,
          ledgerQuantity: ledgerSum,
          drift: item.quantity - ledgerSum,
        });
      }
    }

    return {
      ok: true,
      data: {
        checkedCount: items.length,
        matchedCount: items.length - anomalies.length,
        hasAnomalies: anomalies.length > 0,
        anomalies,
      },
    };
  }

  private async mutate(input: StockMutation, type: 'adjustment' | 'purchase') {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (input.operationId) {
        const previous = await tx.inventoryTransaction.findUnique({
          where: { operationId: input.operationId },
        });
        if (previous) {
          const item = await tx.inventoryItem.findUnique({ where: { id: input.itemId } });
          return { ok: true, data: { item, transaction: previous }, duplicate: true };
        }
      }
      const item = await tx.inventoryItem.findUnique({ where: { id: input.itemId } });
      if (!item) throw new NotFoundException('قلم موجودی پیدا نشد');
      const next = calculateNextQuantity(item.quantity, input.quantity, input.reason);
      const updated = await tx.inventoryItem.update({
        where: { id: item.id },
        data: { quantity: next },
      });
      const transaction = await tx.inventoryTransaction.create({
        data: {
          itemId: item.id,
          type,
          quantityChange: input.quantity,
          quantityAfter: next,
          userId: input.userId,
          reason: input.reason,
          refType: input.refType,
          refId: input.refId,
          operationId: input.operationId,
        },
      });
      await writeAudit(tx, {
        userId: input.userId,
        action: type === 'purchase' ? 'receive' : 'adjust',
        entityType: 'inventory_item',
        entityId: item.id,
        before: { quantity: item.quantity },
        after: { quantity: next, transactionId: String(transaction.id) },
        syncPayload: buildInventoryItemSyncPayload(updated),
      });
      return { ok: true, data: { item: updated, transaction } };
    });
  }
}
