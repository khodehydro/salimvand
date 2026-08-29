import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Prisma } from '@prisma/client';
import { createEan13 } from '@salimvand/shared';
import { calculateNextQuantity } from './inventory.rules';
import { writeAudit } from '../../common/audit/audit-log';

export type StockMutation = { itemId: string; quantity: number; userId: string; reason?: string; refType?: string; refId?: string };

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: { q?: string; brandId?: string; locationId?: string; status?: 'low' | 'out' } = {}) {
    const q = filters.q?.trim();
    const items = await this.prisma.inventoryItem.findMany({ where: { isActive: true, ...(filters.brandId ? { brandId: filters.brandId } : {}), ...(filters.locationId ? { locationId: filters.locationId } : {}), ...(q ? { OR: [{ barcode: { contains: q } }, { product: { name: { contains: q, mode: 'insensitive' } } }] } : {}) }, orderBy: { id: 'desc' }, include: { product: true, brand: true, location: true } });
    const filtered = filters.status === 'out' ? items.filter((item) => item.quantity <= 0) : filters.status === 'low' ? items.filter((item) => item.quantity <= (item.minStock ?? 0)) : items;
    return { ok: true, data: filtered };
  }

  async create(input: { productId?: string; brandId?: string; barcode?: string; purchasePrice?: number; salePrice?: number; minStock?: number; locationId?: string; initialQuantity?: number; userId?: string }) {
    if (!input.productId || !input.brandId) throw new BadRequestException('محصول و برند الزامی است');
    const product = await this.prisma.product.findFirst({ where: { id: input.productId, deletedAt: null } });
    if (!product) throw new NotFoundException('محصول پیدا نشد');
    const barcode = input.barcode?.trim() || createEan13(`${Date.now()}`);
    const initialQuantity = input.initialQuantity ?? 0;
    if (!Number.isInteger(initialQuantity) || initialQuantity < 0) throw new BadRequestException('موجودی اولیه باید عدد صحیح و غیرمنفی باشد');
    if (initialQuantity > 0 && !input.userId) throw new BadRequestException('کاربر ثبت‌کنندهٔ موجودی الزامی است');
    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const item = await tx.inventoryItem.create({ data: { productId: input.productId!, brandId: input.brandId!, barcode, quantity: initialQuantity, purchasePrice: BigInt(input.purchasePrice ?? 0), salePrice: BigInt(input.salePrice ?? 0), minStock: input.minStock, locationId: input.locationId } });
      if (initialQuantity > 0) await tx.inventoryTransaction.create({ data: { itemId: item.id, type: 'initial', quantityChange: initialQuantity, quantityAfter: initialQuantity, userId: input.userId!, reason: 'موجودی اولیه' } });
      return item;
    });
    return { ok: true, data: result };
  }

  async adjust(input: StockMutation) {
    return this.mutate(input, 'adjustment');
  }

  async receive(input: StockMutation) {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new BadRequestException('تعداد ورود باید مثبت باشد');
    return this.mutate(input, 'purchase');
  }

  async transfer(itemId: string, locationId: string, userId: string) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const current = await tx.inventoryItem.findUnique({ where: { id: itemId } });
      if (!current) throw new NotFoundException('قلم موجودی پیدا نشد');
      const item = await tx.inventoryItem.update({ where: { id: itemId }, data: { locationId } });
      const transaction = await tx.inventoryTransaction.create({ data: { itemId, type: 'transfer', quantityChange: 0, quantityAfter: current.quantity, userId, reason: `انتقال به موقعیت ${locationId}` } });
      return { ok: true, data: { item, transaction } };
    });
  }

  async lowStock() {
    const items = await this.prisma.inventoryItem.findMany({ where: { isActive: true }, orderBy: { quantity: 'asc' }, include: { product: true, brand: true, location: true } });
    return { ok: true, data: items.filter((item: { quantity: number; minStock: number | null }) => item.quantity <= (item.minStock ?? 0)) };
  }

  async byBarcode(barcode: string) {
    const item = await this.prisma.inventoryItem.findUnique({ where: { barcode }, include: { product: true, brand: true, location: true } });
    if (!item) throw new NotFoundException('بارکد پیدا نشد');
    return { ok: true, data: item };
  }

  async transactions(itemId: string) {
    const rows = await this.prisma.inventoryTransaction.findMany({ where: { itemId }, orderBy: { createdAt: 'desc' } });
    return { ok: true, data: rows };
  }

  async updateItem(id: string, data: { minStock?: number; locationId?: string | null; salePrice?: number; purchasePrice?: number; isActive?: boolean; notes?: string }, userId?: string) {
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
        include: { product: true, brand: true, location: true },
      });

      if (userId) {
        await writeAudit(tx, {
          userId,
          action: 'update',
          entityType: 'inventory_item',
          entityId: id,
          before: { minStock: existing.minStock, locationId: existing.locationId, salePrice: String(existing.salePrice), purchasePrice: String(existing.purchasePrice) },
          after: { minStock: item.minStock, locationId: item.locationId, salePrice: String(item.salePrice), purchasePrice: String(item.purchasePrice) },
        });
      }
      return item;
    });

    return { ok: true, data: updated };
  }

  async reconciliation() {
    const items = await this.prisma.inventoryItem.findMany({ select: { id: true, barcode: true, quantity: true } });
    const anomalies: Array<{ itemId: string; barcode: string; recordedQuantity: number; ledgerQuantity: number; drift: number }> = [];

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
      const updated = await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: next } });
      const transaction = await tx.inventoryTransaction.create({ data: { itemId: item.id, type, quantityChange: input.quantity, quantityAfter: next, userId: input.userId, reason: input.reason, refType: input.refType, refId: input.refId } });
      await writeAudit(tx, { userId: input.userId, action: type === 'purchase' ? 'receive' : 'adjust', entityType: 'inventory_item', entityId: item.id, before: { quantity: item.quantity }, after: { quantity: next, transactionId: String(transaction.id) } });
      return { ok: true, data: { item: updated, transaction } };
    });
  }
}
