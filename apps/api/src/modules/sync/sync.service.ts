import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CatalogAdminService } from '../catalog/catalog-admin.service';
import { InvoiceService } from '../invoice/invoice.service';
import { PurchaseService } from '../suppliers/purchase.service';
import { validateSyncOperationEnvelope } from '@salimvand/shared';

const parseCursor = (value?: string) => {
  if (!value) return 0n;
  if (!/^\d+$/.test(value)) throw new BadRequestException('cursor نامعتبر است');
  return BigInt(value);
};

@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private recoveryTimer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService, private readonly inventory: InventoryService, private readonly catalog: CatalogAdminService, private readonly invoice: InvoiceService, private readonly purchases: PurchaseService) {}

  onModuleInit() {
    // A stale pending operation is eligible only after 30 seconds, so this
    // interval cannot race a request that is still applying its transaction.
    this.recoveryTimer = setInterval(() => {
      void this.recoverPending(50).catch((error: unknown) => {
        console.error('[sync] pending operation recovery failed', error);
      });
    }, 60_000);
    this.recoveryTimer.unref();
  }

  onModuleDestroy() {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
  }

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
      this.prisma.product.findMany({ where: { deletedAt: null }, orderBy: { updatedAt: 'asc' }, select: { id: true, code: true, slug: true, name: true, categoryId: true, status: true, availabilityOverride: true, updatedAt: true, images: { where: { isPrimary: true }, orderBy: { sort: 'asc' }, take: 1, select: { id: true, path: true, alt: true } } } }),
      this.prisma.inventoryItem.findMany({ where: { isActive: true }, orderBy: { id: 'asc' }, select: { id: true, productId: true, brandId: true, barcode: true, quantity: true, purchasePrice: true, salePrice: true, minStock: true, locationId: true } }),
      this.prisma.syncChange.aggregate({ _max: { revision: true } }),
    ]);
    const publicSiteUrl = (process.env.PUBLIC_SITE_URL ?? process.env.APP_URL ?? 'https://salimvand.ir').replace(/\/$/, '');
    const productsWithImageUrls = products.map((product) => ({
      ...product,
      imageUrl: product.images[0] ? (/^https?:\/\//i.test(product.images[0].path) ? product.images[0].path : `${publicSiteUrl}${product.images[0].path}`) : null,
    }));
    return { ok: true, data: { deviceId, categories, brands, locations, products: productsWithImageUrls, inventory, cursor: String(cursor._max.revision ?? 0n) } };
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
    const contract = validateSyncOperationEnvelope(input);
    if (!contract.ok) throw new BadRequestException(contract.error);
    const normalizedInput = contract.value;
    await this.touchDevice(userId, normalizedInput.deviceId);
    input = normalizedInput;
    const existing = await this.prisma.syncOperation.findUnique({ where: { operationId: input.operationId } });
    if (existing) {
      if (existing.userId !== userId || existing.deviceId !== input.deviceId) throw new ConflictException('شناسه عملیات متعلق به دستگاه دیگری است');
      return { ok: true, data: { operationId: existing.operationId, status: existing.status, result: existing.result, duplicate: true } };
    }
    const operation = await this.prisma.syncOperation.create({ data: { ...input, payload: input.payload as Prisma.InputJsonValue, userId }, select: { operationId: true, status: true, createdAt: true } });
    try {
      await this.assertOperationRole(userId, input.type);
      const result = await this.applyOperation(userId, { ...input, operationId: input.operationId });
      const resultData = result && typeof result === 'object' && 'data' in result ? (result as { data: unknown }).data : result;
      const safeResult = JSON.parse(JSON.stringify(resultData, (_key, value) => typeof value === 'bigint' ? value.toString() : value)) as Prisma.InputJsonValue;
      const applied = await this.prisma.syncOperation.update({ where: { operationId: input.operationId }, data: { status: 'applied', result: safeResult, appliedAt: new Date() }, select: { operationId: true, status: true, result: true, appliedAt: true } });
      return { ok: true, data: { ...applied, duplicate: false } };
    } catch (error) {
      const isConflict = error instanceof ConflictException;
      const response = isConflict ? error.getResponse() : null;
      const details = typeof response === 'object' && response !== null ? response as Record<string, unknown> : {};
      await this.prisma.syncOperation.update({ where: { operationId: input.operationId }, data: { status: isConflict ? 'conflict' : 'failed', error: error instanceof Error ? error.message.slice(0, 500) : 'عملیات ناموفق بود' } });
      if (isConflict) {
        await this.prisma.syncConflict.upsert({
          where: { operationId_status: { operationId: input.operationId, status: 'open' } },
          create: { operationId: input.operationId, userId, deviceId: input.deviceId, type: input.type, code: typeof details.code === 'string' ? details.code : 'CONFLICT', payload: input.payload as Prisma.InputJsonValue, serverState: details as Prisma.InputJsonValue },
          update: { serverState: details as Prisma.InputJsonValue },
        });
      }
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
      : type === 'invoice.create'
        ? user.role === 'manager' || user.role === 'super_admin' || user.role === 'seller'
        : type === 'purchase.create'
          ? user.role === 'manager' || user.role === 'super_admin'
          : type === 'purchase.pay'
            ? user.role === 'manager' || user.role === 'super_admin' || user.role === 'accountant'
            : type === 'invoice.pay'
              ? user.role === 'manager' || user.role === 'super_admin' || user.role === 'seller' || user.role === 'accountant'
              : productOperation
                ? user.role === 'manager' || user.role === 'super_admin'
                : false;
    if (!allowed) throw new BadRequestException('نقش کاربر اجازهٔ اجرای این عملیات را ندارد');
  }

  private async applyOperation(userId: string, input: { operationId: string; type: string; deviceId: string; payload: Record<string, unknown> }) {
    const payload = input.payload;
    const itemId = typeof payload.itemId === 'string' ? payload.itemId : '';
    if ((input.type.startsWith('inventory.') && !itemId)) throw new BadRequestException('itemId عملیات الزامی است');
    if (input.type === 'inventory.receive' || input.type === 'inventory.adjust') {
      const quantity = Number(payload.quantity);
      if (!Number.isInteger(quantity)) throw new BadRequestException('quantity عملیات نامعتبر است');
      const reason = typeof payload.reason === 'string' ? payload.reason : 'عملیات موبایل';
      return input.type === 'inventory.receive'
        ? this.inventory.receive({ itemId, quantity, userId, reason, operationId: input.operationId })
        : this.inventory.adjust({ itemId, quantity, userId, reason, operationId: input.operationId });
    }
    if (input.type === 'inventory.transfer') {
      const locationId = typeof payload.locationId === 'string' ? payload.locationId : '';
      if (!locationId) throw new BadRequestException('locationId عملیات الزامی است');
      return this.inventory.transfer(itemId, locationId, userId, input.operationId);
    }
    if (input.type === 'product.create') return this.catalog.create(payload, userId, undefined, input.operationId);
    if (input.type === 'product.update') {
      const productId = typeof payload.productId === 'string' ? payload.productId : '';
      if (!productId) throw new BadRequestException('productId عملیات الزامی است');
      const { productId: _productId, ...changes } = payload;
      return this.catalog.update(productId, changes, userId, undefined, input.operationId);
    }
    if (input.type === 'invoice.create') {
      if (!Array.isArray(payload.items) || payload.items.length === 0) throw new BadRequestException('اقلام فاکتور الزامی است');
      return this.invoice.create({ ...payload, operationId: input.operationId } as never, userId);
    }
    if (input.type === 'invoice.pay') {
      const invoiceId = typeof payload.invoiceId === 'string' ? payload.invoiceId : '';
      if (!invoiceId) throw new BadRequestException('invoiceId عملیات الزامی است');
      return this.invoice.pay(invoiceId, String(payload.amount ?? ''), payload.method as never, userId, Array.isArray(payload.checks) ? payload.checks as never : undefined, input.operationId);
    }
    if (input.type === 'purchase.create') {
      const supplierId = typeof payload.supplierId === 'string' ? payload.supplierId : '';
      if (!supplierId || !Array.isArray(payload.lines) || payload.lines.length === 0) throw new BadRequestException('تأمین‌کننده و اقلام خرید الزامی است');
      return this.purchases.create(supplierId, payload.lines as never, payload.paidAmount as never, userId, undefined, input.operationId);
    }
    if (input.type === 'purchase.pay') {
      const invoiceId = typeof payload.invoiceId === 'string' ? payload.invoiceId : '';
      if (!invoiceId) throw new BadRequestException('invoiceId خرید الزامی است');
      return this.purchases.pay(invoiceId, String(payload.amount ?? ''), payload.method as never, typeof payload.notes === 'string' ? payload.notes : undefined, userId, undefined, payload.check as never, input.operationId);
    }
    throw new BadRequestException(`نوع عملیات پشتیبانی نمی‌شود: ${input.type}`);
  }


  /** Replays only domain operations with idempotency guarantees. Product writes are
   * deliberately excluded until their own idempotency contract is complete. */
  async recoverPending(limit = 100) {
    const safeTypes = ['inventory.receive', 'inventory.adjust', 'inventory.transfer', 'invoice.create', 'invoice.pay', 'purchase.create', 'purchase.pay', 'product.create', 'product.update'];
    const candidates = await this.prisma.syncOperation.findMany({
      where: { status: 'pending', type: { in: safeTypes }, OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(Date.now() - 30_000) } }] },
      orderBy: { createdAt: 'asc' }, take: Math.min(100, Math.max(1, limit)),
    });
    const results: Array<{ operationId: string; status: string }> = [];
    for (const operation of candidates) {
      const claimed = await this.prisma.syncOperation.updateMany({
        where: { operationId: operation.operationId, status: 'pending', OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(Date.now() - 30_000) } }] },
        data: { attempts: { increment: 1 }, lastAttemptAt: new Date() },
      });
      if (claimed.count !== 1) continue;
      try {
        const result = await this.applyOperation(operation.userId, { operationId: operation.operationId, type: operation.type, deviceId: operation.deviceId, payload: operation.payload as Record<string, unknown> });
        const resultData = result && typeof result === 'object' && 'data' in result ? (result as { data: unknown }).data : result;
      const safeResult = JSON.parse(JSON.stringify(resultData, (_key, value) => typeof value === 'bigint' ? value.toString() : value)) as Prisma.InputJsonValue;
        await this.prisma.syncOperation.update({ where: { operationId: operation.operationId }, data: { status: 'applied', result: safeResult, appliedAt: new Date() } });
        results.push({ operationId: operation.operationId, status: 'applied' });
      } catch (error) {
        const conflict = error instanceof ConflictException;
        await this.prisma.syncOperation.update({ where: { operationId: operation.operationId }, data: { status: conflict ? 'conflict' : 'failed', error: error instanceof Error ? error.message.slice(0, 500) : 'بازیابی عملیات ناموفق بود' } });
        if (conflict) {
          const response = error.getResponse();
          const details = typeof response === 'object' && response !== null ? response as Record<string, unknown> : {};
          await this.prisma.syncConflict.upsert({
            where: { operationId_status: { operationId: operation.operationId, status: 'open' } },
            create: { operationId: operation.operationId, userId: operation.userId, deviceId: operation.deviceId, type: operation.type, code: typeof details.code === 'string' ? details.code : 'CONFLICT', payload: operation.payload as Prisma.InputJsonValue, serverState: details as Prisma.InputJsonValue },
            update: { serverState: details as Prisma.InputJsonValue },
          });
        }
        results.push({ operationId: operation.operationId, status: conflict ? 'conflict' : 'failed' });
      }
    }
    return { ok: true, data: { inspected: candidates.length, results } };
  }

  async conflicts(userId: string, status?: 'open' | 'resolved') {
    const rows = await this.prisma.syncConflict.findMany({ where: { userId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { ok: true, data: rows };
  }

  async resolveConflict(userId: string, id: string, resolution: Record<string, unknown>) {
    const conflict = await this.prisma.syncConflict.findFirst({ where: { id, userId, status: 'open' } });
    if (!conflict) throw new NotFoundException('Conflict پیدا نشد');
    const updated = await this.prisma.syncConflict.update({ where: { id }, data: { status: 'resolved', resolution: resolution as Prisma.InputJsonValue, resolvedAt: new Date() } });
    await this.prisma.syncOperation.updateMany({ where: { operationId: conflict.operationId, userId, status: 'conflict' }, data: { status: 'failed', error: 'Conflict توسط اپراتور حل شد؛ اجرای مجدد نیازمند تصمیم کلاینت است' } });
    return { ok: true, data: updated };
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
