import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Prisma } from '@prisma/client';
import { createEan13 } from '@salimvand/shared';
import { calculateNextQuantity } from './inventory.rules';
import { writeAudit } from '../../common/audit/audit-log';

export type StockMutation = {
  itemId: string;
  quantity: number;
  userId: string;
  reason?: string;
  refType?: string;
  refId?: string;
};

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    filters: { q?: string; brandId?: string; locationId?: string; status?: 'low' | 'out' } = {},
  ) {
    const q = filters.q?.trim();
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        isActive: true,
        ...(filters.brandId ? { brandId: filters.brandId } : {}),
        ...(filters.locationId ? { locationId: filters.locationId } : {}),
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
      include: {
        brand: true,
        // parent = the warehouse (انبار) of the shelf — the panel always
        // shows placement as «انبار · قفسه».
        location: { include: { parent: true } },
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
    const filtered =
      filters.status === 'out'
        ? items.filter((item) => item.quantity <= 0)
        : filters.status === 'low'
          ? items.filter((item) => item.quantity <= (item.minStock ?? 0))
          : items;
    return { ok: true, data: filtered };
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
          brand: item.brand.name,
          category: item.product.category.name,
          vehicles: vehicleText,
          quantity: item.quantity,
        };
      }),
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
    initialQuantity?: number;
    userId?: string;
  }) {
    if (!input.productId || !input.brandId)
      throw new BadRequestException('محصول و برند الزامی است');
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
      where: { productId: input.productId, brandId: input.brandId },
      select: { id: true },
    });
    if (brandDuplicate) throw new BadRequestException('این برند قبلاً برای همین محصول ثبت شده است');
    const initialQuantity = input.initialQuantity ?? 0;
    if (!Number.isInteger(initialQuantity) || initialQuantity < 0)
      throw new BadRequestException('موجودی اولیه باید عدد صحیح و غیرمنفی باشد');
    if (initialQuantity > 0 && !input.userId)
      throw new BadRequestException('کاربر ثبت‌کنندهٔ موجودی الزامی است');
    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const item = await tx.inventoryItem.create({
        data: {
          productId: input.productId!,
          brandId: input.brandId!,
          barcode,
          quantity: initialQuantity,
          purchasePrice: BigInt(input.purchasePrice ?? 0),
          salePrice: BigInt(input.salePrice ?? 0),
          minStock: input.minStock,
          locationId: input.locationId,
        },
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
    if (!input.brandId && !input.categoryId) throw new BadRequestException('برند یا دسته‌بندی را انتخاب کنید');
    if (!salePercent && !purchasePercent) throw new BadRequestException('درصد تغییر قیمت را وارد کنید');
    const items = await this.prisma.inventoryItem.findMany({
      where: { isActive: true, ...(input.brandId ? { brandId: input.brandId } : {}), ...(input.categoryId ? { product: { categoryId: input.categoryId } } : {}) },
      select: { id: true, purchasePrice: true, salePrice: true },
    });
    for (const item of items) {
      const apply = (value: bigint, percent: number) => {
        if (!percent) return value;
        const next = Number(value) * (1 + percent / 100);
        return BigInt(roundTo > 0 ? Math.round(next / roundTo) * roundTo : Math.round(next));
      };
      await this.prisma.inventoryItem.update({ where: { id: item.id }, data: {
        purchasePrice: apply(item.purchasePrice, purchasePercent),
        salePrice: apply(item.salePrice, salePercent),
      }});
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

  async transfer(itemId: string, locationId: string, userId: string) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const current = await tx.inventoryItem.findUnique({ where: { id: itemId } });
      if (!current) throw new NotFoundException('قلم موجودی پیدا نشد');
      const item = await tx.inventoryItem.update({ where: { id: itemId }, data: { locationId } });
      const transaction = await tx.inventoryTransaction.create({
        data: {
          itemId,
          type: 'transfer',
          quantityChange: 0,
          quantityAfter: current.quantity,
          userId,
          reason: `انتقال به موقعیت ${locationId}`,
        },
      });
      return { ok: true, data: { item, transaction } };
    });
  }

  async lowStock() {
    const items = await this.prisma.inventoryItem.findMany({
      where: { isActive: true },
      orderBy: { quantity: 'asc' },
      // Same shape as list() so the panel can render low-stock rows with the
      // identical rich cards.
      include: {
        brand: true,
        location: { include: { parent: true } },
        product: {
          include: {
            images: { orderBy: [{ isPrimary: 'desc' }, { sort: 'asc' }], take: 1 },
            category: true,
            compatibilities: { include: { model: { include: { make: true } } } },
          },
        },
      },
    });
    return {
      ok: true,
      data: items.filter(
        (item: { quantity: number; minStock: number | null }) =>
          item.quantity <= (item.minStock ?? 0),
      ),
    };
  }

  async byBarcode(barcode: string) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { barcode },
      include: { product: true, brand: true, location: { include: { parent: true } } },
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

  async updateItem(
    id: string,
    data: {
      minStock?: number;
      locationId?: string | null;
      salePrice?: number;
      purchasePrice?: number;
      isActive?: boolean;
      notes?: string;
    },
    userId?: string,
  ) {
    const existing = await this.prisma.inventoryItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('قلم موجودی پیدا نشد');

    const updated = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const item = await tx.inventoryItem.update({
        where: { id },
        data: {
          minStock: data.minStock !== undefined ? data.minStock : undefined,
          locationId: data.locationId !== undefined ? data.locationId : undefined,
          salePrice: data.salePrice !== undefined ? BigInt(data.salePrice) : undefined,
          purchasePrice: data.purchasePrice !== undefined ? BigInt(data.purchasePrice) : undefined,
          isActive: data.isActive !== undefined ? data.isActive : undefined,
          notes: data.notes !== undefined ? data.notes : undefined,
        },
        include: { product: true, brand: true, location: { include: { parent: true } } },
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
            salePrice: String(existing.salePrice),
            purchasePrice: String(existing.purchasePrice),
          },
          after: {
            minStock: item.minStock,
            locationId: item.locationId,
            salePrice: String(item.salePrice),
            purchasePrice: String(item.purchasePrice),
          },
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
        },
      });
      await writeAudit(tx, {
        userId: input.userId,
        action: type === 'purchase' ? 'receive' : 'adjust',
        entityType: 'inventory_item',
        entityId: item.id,
        before: { quantity: item.quantity },
        after: { quantity: next, transactionId: String(transaction.id) },
      });
      return { ok: true, data: { item: updated, transaction } };
    });
  }
}
