import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CatalogAdminService } from '../catalog/catalog-admin.service';

const parseCursor = (value?: string) => {
  if (!value) return 0n;
  if (!/^\d+$/.test(value)) throw new BadRequestException('cursor نامعتبر است');
  return BigInt(value);
};

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService, private readonly inventory: InventoryService, private readonly catalog: CatalogAdminService) {}

  async registerDevice(userId: string, deviceId: string, name?: string) {
    const device = await this.prisma.syncDevice.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      create: { userId, deviceId, name },
      update: { name, lastSeenAt: new Date() },
      select: { id: true, deviceId: true, name: true, lastSeenAt: true },
    });
    return { ok: true, data: device };
  }

  /** Initial local database snapshot. It deliberately excludes secrets and
   * internal tokens; the mobile client only receives operational catalog data. */
  async bootstrap(userId: string, deviceId: string) {
    await this.touchDevice(userId, deviceId);
    const [categories, brands, locations, products, inventory, cursor] = await Promise.all([
      this.prisma.category.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, parentId: true, name: true, slug: true, code: true } }),
      this.prisma.brand.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.location.findMany({ orderBy: { code: 'asc' }, select: { id: true, parentId: true, type: true, code: true, name: true } }),
      this.prisma.product.findMany({ where: { deletedAt: null }, orderBy: { updatedAt: 'asc' }, select: { id: true, code: true, slug: true, name: true, categoryId: true, status: true, availabilityOverride: true, updatedAt: true } }),
      this.prisma.inventoryItem.findMany({ where: { isActive: true }, orderBy: { id: 'asc' }, select: { id: true, productId: true, brandId: true, barcode: true, quantity: true, purchasePrice: true, salePrice: true, minStock: true, locationId: true } }),
      this.prisma.syncChange.aggregate({ _max: { revision: true } }),
    ]);
    return { ok: true, data: { deviceId, categories, brands, locations, products, inventory, cursor: String(cursor._max.revision ?? 0n) } };
  }

  async pull(userId: string, deviceId: string, cursorValue?: string, limitValue?: string) {
    await this.touchDevice(userId, deviceId);
    const cursor = parseCursor(cursorValue);
    const limit = Math.min(500, Math.max(1, Number(limitValue ?? 200) || 200));
    const changes = await this.prisma.syncChange.findMany({ where: { revision: { gt: cursor } }, orderBy: { revision: 'asc' }, take: limit });
    const nextCursor = changes.length ? changes[changes.length - 1].revision : cursor;
    return { ok: true, data: { changes, cursor: String(nextCursor), hasMore: changes.length === limit } };
  }

  /** Records an operation exactly once. Applying operation types is intentionally
   * a separate step: every mutation must be wired to its domain transaction
   * before Android is allowed to submit it. */
  async queueOperation(userId: string, input: { operationId: string; deviceId: string; type: string; payload: Record<string, unknown> }) {
    await this.touchDevice(userId, input.deviceId);
    const existing = await this.prisma.syncOperation.findUnique({ where: { operationId: input.operationId } });
    if (existing) {
      if (existing.userId !== userId || existing.deviceId !== input.deviceId) throw new ConflictException('شناسه عملیات متعلق به دستگاه دیگری است');
      return { ok: true, data: { operationId: existing.operationId, status: existing.status, result: existing.result, duplicate: true } };
    }
    const operation = await this.prisma.syncOperation.create({ data: { ...input, payload: input.payload as Prisma.InputJsonValue, userId }, select: { operationId: true, status: true, createdAt: true } });
    try {
      await this.assertOperationRole(userId, input.type);
      const result = await this.applyOperation(userId, input);
      const safeResult = JSON.parse(JSON.stringify(result, (_key, value) => typeof value === 'bigint' ? value.toString() : value)) as Prisma.InputJsonValue;
      const applied = await this.prisma.syncOperation.update({ where: { operationId: input.operationId }, data: { status: 'applied', result: safeResult, appliedAt: new Date() }, select: { operationId: true, status: true, result: true, appliedAt: true } });
      return { ok: true, data: { ...applied, duplicate: false } };
    } catch (error) {
      await this.prisma.syncOperation.update({ where: { operationId: input.operationId }, data: { status: 'failed', error: error instanceof Error ? error.message.slice(0, 500) : 'عملیات ناموفق بود' } });
      throw error;
    }
  }

  private async assertOperationRole(userId: string, type: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) throw new BadRequestException('کاربر عملیات پیدا نشد');
    const inventoryOperation = type.startsWith('inventory.');
    const productOperation = type.startsWith('product.');
    const allowed = inventoryOperation
      ? user.role === 'manager' || user.role === 'super_admin' || user.role === 'warehouse'
      : productOperation
        ? user.role === 'manager' || user.role === 'super_admin'
        : false;
    if (!allowed) throw new BadRequestException('نقش کاربر اجازهٔ اجرای این عملیات را ندارد');
  }

  private async applyOperation(userId: string, input: { type: string; deviceId: string; payload: Record<string, unknown> }) {
    const payload = input.payload;
    const itemId = typeof payload.itemId === 'string' ? payload.itemId : '';
    if (!itemId) throw new BadRequestException('itemId عملیات الزامی است');
    if (input.type === 'inventory.receive' || input.type === 'inventory.adjust') {
      const quantity = Number(payload.quantity);
      if (!Number.isInteger(quantity)) throw new BadRequestException('quantity عملیات نامعتبر است');
      const reason = typeof payload.reason === 'string' ? payload.reason : 'عملیات موبایل';
      return input.type === 'inventory.receive'
        ? this.inventory.receive({ itemId, quantity, userId, reason })
        : this.inventory.adjust({ itemId, quantity, userId, reason });
    }
    if (input.type === 'inventory.transfer') {
      const locationId = typeof payload.locationId === 'string' ? payload.locationId : '';
      if (!locationId) throw new BadRequestException('locationId عملیات الزامی است');
      return this.inventory.transfer(itemId, locationId, userId);
    }
    if (input.type === 'product.create') return this.catalog.create(payload, userId);
    if (input.type === 'product.update') {
      const productId = typeof payload.productId === 'string' ? payload.productId : '';
      if (!productId) throw new BadRequestException('productId عملیات الزامی است');
      const { productId: _productId, ...changes } = payload;
      return this.catalog.update(productId, changes, userId);
    }
    throw new BadRequestException(`نوع عملیات پشتیبانی نمی‌شود: ${input.type}`);
  }

  async operations(userId: string, ids: string[]) {
    const rows = await this.prisma.syncOperation.findMany({ where: { userId, operationId: { in: ids } }, select: { operationId: true, type: true, status: true, result: true, error: true, appliedAt: true } });
    return { ok: true, data: rows };
  }

  private async touchDevice(userId: string, deviceId: string) {
    if (!deviceId || deviceId.length > 100) throw new BadRequestException('deviceId الزامی است');
    await this.prisma.syncDevice.upsert({ where: { userId_deviceId: { userId, deviceId } }, create: { userId, deviceId }, update: { lastSeenAt: new Date() } });
  }
}
