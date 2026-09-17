import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CatalogAdminService } from '../catalog/catalog-admin.service';
import { InvoiceService } from '../invoice/invoice.service';
import { PurchaseService } from '../suppliers/purchase.service';
import { SYNC_CONFLICT_DECISIONS, validateSyncOperationEnvelope } from '@salimvand/shared';
import {
  buildInventoryItemSyncPayload,
  buildInvoiceSyncPayload,
  buildProductSyncPayload,
} from '../../common/sync/sync-payloads';

const parseCursor = (value?: string) => {
  if (!value) return 0n;
  if (!/^\d+$/.test(value)) throw new BadRequestException('cursor نامعتبر است');
  return BigInt(value);
};

/** Domain operations the recovery loop may replay on its own. Every entry has
 * a complete server-side idempotency guarantee (unique operationId on the
 * effect rows), so a replay can never double-apply. */
const RECOVERABLE_OPERATION_TYPES = [
  'inventory.receive',
  'inventory.adjust',
  'inventory.transfer',
  'inventory.update_metadata',
  'invoice.create',
  'invoice.pay',
  'purchase.create',
  'purchase.pay',
  'product.create',
  'product.update',
];

type SyncOperationRow = {
  operationId: string;
  deviceId: string;
  userId: string;
  type: string;
  payload: Prisma.JsonValue;
};

type ApplyOutcome = {
  status: 'applied' | 'conflict' | 'failed';
  result?: Prisma.InputJsonValue;
  error?: string;
  originalError?: unknown;
  conflict?: { id: string; code: string; serverState: Prisma.JsonValue | null };
};

/** Response of POST /sync/conflicts/:id/resolve — one fixed envelope whose
 * optional members depend on the decision. */
type ConflictResolution = {
  ok: true;
  data: {
    conflictId: string;
    decision: string;
    operationId: string;
    status: 'applied' | 'conflict' | 'failed';
    result?: Prisma.InputJsonValue;
    error?: string;
    serverState?: Prisma.JsonValue | null;
    snapshot?: Record<string, unknown> | null;
    draft?: { type: string; payload: Prisma.JsonValue; serverState: Prisma.JsonValue | null };
    conflict?: { id: string; code: string; serverState: Prisma.JsonValue | null };
  };
};

@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private recoveryTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly catalog: CatalogAdminService,
    private readonly invoice: InvoiceService,
    private readonly purchases: PurchaseService,
  ) {}

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
      this.prisma.category.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, parentId: true, name: true, slug: true, code: true },
      }),
      this.prisma.brand.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.location.findMany({
        orderBy: { code: 'asc' },
        select: { id: true, parentId: true, type: true, code: true, name: true },
      }),
      this.prisma.product.findMany({
        where: { deletedAt: null },
        orderBy: { updatedAt: 'asc' },
        select: {
          id: true,
          code: true,
          slug: true,
          name: true,
          categoryId: true,
          status: true,
          availabilityOverride: true,
          updatedAt: true,
          images: {
            where: { isPrimary: true },
            orderBy: { sort: 'asc' },
            take: 1,
            select: { id: true, path: true, alt: true },
          },
        },
      }),
      this.prisma.inventoryItem.findMany({
        where: { isActive: true },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          productId: true,
          brandId: true,
          barcode: true,
          quantity: true,
          purchasePrice: true,
          salePrice: true,
          minStock: true,
          locationId: true,
        },
      }),
      this.prisma.syncChange.aggregate({ _max: { revision: true } }),
    ]);
    const publicSiteUrl = (
      process.env.PUBLIC_SITE_URL ??
      process.env.APP_URL ??
      'https://salimvand.ir'
    ).replace(/\/$/, '');
    const productsWithImageUrls = products.map((product) => ({
      ...product,
      imageUrl: product.images[0]
        ? /^https?:\/\//i.test(product.images[0].path)
          ? product.images[0].path
          : `${publicSiteUrl}${product.images[0].path}`
        : null,
    }));
    return {
      ok: true,
      data: {
        deviceId,
        categories,
        brands,
        locations,
        products: productsWithImageUrls,
        inventory,
        cursor: String(cursor._max.revision ?? 0n),
      },
    };
  }

  async pull(userId: string, deviceId: string, cursorValue?: string, limitValue?: string) {
    await this.touchDevice(userId, deviceId);
    const cursor = parseCursor(cursorValue);
    const limit = Math.min(500, Math.max(1, Number(limitValue ?? 200) || 200));
    const changes = await this.prisma.syncChange.findMany({
      where: { revision: { gt: cursor } },
      orderBy: { revision: 'asc' },
      take: limit,
    });
    const nextCursor = changes.length ? changes[changes.length - 1].revision : cursor;
    return {
      ok: true,
      data: { changes, cursor: String(nextCursor), hasMore: changes.length === limit },
    };
  }

  /** Records an operation exactly once. Applying operation types is intentionally
   * a separate step: every mutation must be wired to its domain transaction
   * before Android is allowed to submit it. */
  async queueOperation(
    userId: string,
    input: {
      operationId: string;
      deviceId: string;
      type: string;
      payload: Record<string, unknown>;
    },
  ) {
    const contract = validateSyncOperationEnvelope(input);
    if (!contract.ok) throw new BadRequestException(contract.error);
    const normalizedInput = contract.value;
    // Role is verified before the row exists: a rejected operation must never
    // linger as pending, because the recovery loop only replays accepted work.
    await this.assertOperationRole(userId, normalizedInput.type);
    await this.touchDevice(userId, normalizedInput.deviceId);
    const existing = await this.prisma.syncOperation.findUnique({
      where: { operationId: normalizedInput.operationId },
    });
    if (existing) {
      if (existing.userId !== userId || existing.deviceId !== normalizedInput.deviceId)
        throw new ConflictException('شناسه عملیات متعلق به دستگاه دیگری است');
      // A pending duplicate is either an in-flight request or an operation the
      // caller deliberately revived (conflict decision `retry`). Claiming it
      // here — with the stale-attempt guard — makes the retry path work even
      // when the client simply re-POSTs the same operationId.
      if (
        existing.status === 'pending' &&
        (await this.claimOperation(normalizedInput.operationId))
      ) {
        const outcome = await this.applyAndRecord(userId, {
          operationId: existing.operationId,
          type: existing.type,
          deviceId: existing.deviceId,
          payload: existing.payload as Record<string, unknown>,
        });
        if (outcome.status !== 'applied') this.throwOutcome(outcome);
        return {
          ok: true,
          data: {
            operationId: existing.operationId,
            status: 'applied',
            result: outcome.result,
            duplicate: true,
          },
        };
      }
      return {
        ok: true,
        data: {
          operationId: existing.operationId,
          status: existing.status,
          result: existing.result,
          duplicate: true,
        },
      };
    }
    await this.prisma.syncOperation.create({
      data: {
        ...normalizedInput,
        payload: normalizedInput.payload as Prisma.InputJsonValue,
        userId,
      },
    });
    const outcome = await this.applyAndRecord(userId, {
      ...normalizedInput,
      operationId: normalizedInput.operationId,
    });
    if (outcome.status !== 'applied') this.throwOutcome(outcome);
    return {
      ok: true,
      data: {
        operationId: normalizedInput.operationId,
        status: 'applied',
        result: outcome.result,
        duplicate: false,
      },
    };
  }

  /** Applies the domain operation and records the terminal operation state
   * (applied / conflict / failed) plus, on conflict, the open conflict row. */
  private async applyAndRecord(
    userId: string,
    input: {
      operationId: string;
      type: string;
      deviceId: string;
      payload: Record<string, unknown>;
    },
  ): Promise<ApplyOutcome> {
    try {
      const result = await this.applyOperation(userId, input);
      const resultData =
        result && typeof result === 'object' && 'data' in result
          ? (result as { data: unknown }).data
          : result;
      const safeResult = JSON.parse(
        JSON.stringify(resultData, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value,
        ),
      ) as Prisma.InputJsonValue;
      await this.prisma.syncOperation.update({
        where: { operationId: input.operationId },
        data: { status: 'applied', result: safeResult, appliedAt: new Date() },
      });
      return { status: 'applied', result: safeResult };
    } catch (error) {
      const isConflict = error instanceof ConflictException;
      const response = isConflict ? error.getResponse() : null;
      const details =
        typeof response === 'object' && response !== null
          ? (response as Record<string, unknown>)
          : {};
      const message = error instanceof Error ? error.message.slice(0, 500) : 'عملیات ناموفق بود';
      await this.prisma.syncOperation.update({
        where: { operationId: input.operationId },
        data: { status: isConflict ? 'conflict' : 'failed', error: message },
      });
      if (isConflict) {
        const conflict = await this.prisma.syncConflict.upsert({
          where: { operationId_status: { operationId: input.operationId, status: 'open' } },
          create: {
            operationId: input.operationId,
            userId,
            deviceId: input.deviceId,
            type: input.type,
            code: typeof details.code === 'string' ? details.code : 'CONFLICT',
            payload: input.payload as Prisma.InputJsonValue,
            serverState: details as Prisma.InputJsonValue,
          },
          update: { serverState: details as Prisma.InputJsonValue },
        });
        return {
          status: 'conflict',
          error: message,
          originalError: error,
          conflict: { id: conflict.id, code: conflict.code, serverState: conflict.serverState },
        };
      }
      return { status: 'failed', error: message, originalError: error };
    }
  }

  /** Re-throws the original error of a recorded non-applied outcome, keeping
   * its exact HTTP status and payload (409 conflict details included). */
  private throwOutcome(outcome: ApplyOutcome): never {
    if (outcome.originalError) throw outcome.originalError;
    throw new BadRequestException(outcome.error ?? 'عملیات ناموفق بود');
  }

  /** Atomic claim so a replaying operation can only ever be applied by one
   * worker at a time; returns false when someone else holds the attempt. */
  private async claimOperation(operationId: string): Promise<boolean> {
    const claimed = await this.prisma.syncOperation.updateMany({
      where: {
        operationId,
        status: 'pending',
        OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(Date.now() - 30_000) } }],
      },
      data: { attempts: { increment: 1 }, lastAttemptAt: new Date() },
    });
    return claimed.count === 1;
  }

  private async assertOperationRole(userId: string, type: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) throw new BadRequestException('کاربر عملیات پیدا نشد');
    const inventoryOperation = type.startsWith('inventory.');
    const productOperation = type.startsWith('product.');
    const customerOperation = type === 'customer.create';
    const allowed = inventoryOperation
      ? user.role === 'manager' || user.role === 'super_admin' || user.role === 'warehouse'
      : type === 'invoice.create'
        ? user.role === 'manager' || user.role === 'super_admin' || user.role === 'seller'
        : type === 'purchase.create'
          ? user.role === 'manager' || user.role === 'super_admin'
          : type === 'purchase.pay'
            ? user.role === 'manager' || user.role === 'super_admin' || user.role === 'accountant'
            : type === 'invoice.pay'
              ? user.role === 'manager' ||
                user.role === 'super_admin' ||
                user.role === 'seller' ||
                user.role === 'accountant'
              : productOperation
                ? user.role === 'manager' || user.role === 'super_admin'
                : customerOperation
                  ? user.role === 'seller' || user.role === 'manager' || user.role === 'super_admin'
                  : false;
    if (!allowed) throw new BadRequestException('نقش کاربر اجازهٔ اجرای این عملیات را ندارد');
  }

  private async applyOperation(
    userId: string,
    input: {
      operationId: string;
      type: string;
      deviceId: string;
      payload: Record<string, unknown>;
    },
  ) {
    const payload = input.payload;
    const itemId = typeof payload.itemId === 'string' ? payload.itemId : '';
    if (
      input.type.startsWith('inventory.') &&
      input.type !== 'inventory.update_metadata' &&
      !itemId
    )
      throw new BadRequestException('itemId عملیات الزامی است');
    if (input.type === 'inventory.receive' || input.type === 'inventory.adjust') {
      const quantity = Number(payload.quantity);
      if (!Number.isInteger(quantity)) throw new BadRequestException('quantity عملیات نامعتبر است');
      const reason = typeof payload.reason === 'string' ? payload.reason : 'عملیات موبایل';
      return input.type === 'inventory.receive'
        ? this.inventory.receive({
            itemId,
            quantity,
            userId,
            reason,
            operationId: input.operationId,
          })
        : this.inventory.adjust({
            itemId,
            quantity,
            userId,
            reason,
            operationId: input.operationId,
          });
    }
    if (input.type === 'inventory.update_metadata') {
      if (!itemId) throw new BadRequestException('itemId عملیات الزامی است');
      return this.inventory.updateMetadata(
        {
          itemId,
          purchasePrice:
            typeof payload.purchasePrice === 'string' || typeof payload.purchasePrice === 'number'
              ? payload.purchasePrice
              : undefined,
          salePrice:
            typeof payload.salePrice === 'string' || typeof payload.salePrice === 'number'
              ? payload.salePrice
              : undefined,
          minStock:
            payload.minStock === null
              ? null
              : typeof payload.minStock === 'number'
                ? payload.minStock
                : undefined,
          locationId:
            payload.locationId === null
              ? null
              : typeof payload.locationId === 'string'
                ? payload.locationId
                : undefined,
          barcode: typeof payload.barcode === 'string' ? payload.barcode : undefined,
          brandId:
            payload.brandId === null
              ? null
              : typeof payload.brandId === 'string'
                ? payload.brandId
                : undefined,
          notes: typeof payload.notes === 'string' ? payload.notes : undefined,
        },
        userId,
        input.operationId,
      );
    }
    if (input.type === 'inventory.transfer') {
      const locationId = typeof payload.locationId === 'string' ? payload.locationId : '';
      if (!locationId) throw new BadRequestException('locationId عملیات الزامی است');
      return this.inventory.transfer(itemId, locationId, userId, input.operationId);
    }
    if (input.type === 'product.create')
      return this.catalog.create(payload, userId, undefined, input.operationId);
    if (input.type === 'product.update') {
      const productId = typeof payload.productId === 'string' ? payload.productId : '';
      if (!productId) throw new BadRequestException('productId عملیات الزامی است');
      // The nested inventory object is handled by catalog.update itself; only
      // the catalog fields travel through `changes`.
      const { productId: _productId, inventory: _inventory, ...changes } = payload;
      return this.catalog.update(productId, changes, userId, undefined, input.operationId);
    }
    if (input.type === 'invoice.create') {
      if (!Array.isArray(payload.items) || payload.items.length === 0)
        throw new BadRequestException('اقلام فاکتور الزامی است');
      return this.invoice.create({ ...payload, operationId: input.operationId } as never, userId);
    }
    if (input.type === 'customer.create') {
      const name = typeof payload.name === 'string' ? payload.name : '';
      const mobile = typeof payload.mobile === 'string' ? payload.mobile : '';
      if (!name || !mobile) throw new BadRequestException('نام و موبایل مشتری الزامی است');
      return this.invoice.createCustomer({
        name,
        mobile,
        notes: typeof payload.notes === 'string' ? payload.notes : undefined,
      });
    }
    if (input.type === 'invoice.pay') {
      const invoiceId = typeof payload.invoiceId === 'string' ? payload.invoiceId : '';
      if (!invoiceId) throw new BadRequestException('invoiceId عملیات الزامی است');
      return this.invoice.pay(
        invoiceId,
        String(payload.amount ?? ''),
        payload.method as never,
        userId,
        Array.isArray(payload.checks) ? (payload.checks as never) : undefined,
        input.operationId,
      );
    }
    if (input.type === 'purchase.create') {
      const supplierId = typeof payload.supplierId === 'string' ? payload.supplierId : '';
      if (!supplierId || !Array.isArray(payload.lines) || payload.lines.length === 0)
        throw new BadRequestException('تأمین‌کننده و اقلام خرید الزامی است');
      return this.purchases.create(
        supplierId,
        payload.lines as never,
        payload.paidAmount as never,
        userId,
        undefined,
        input.operationId,
      );
    }
    if (input.type === 'purchase.pay') {
      const invoiceId = typeof payload.invoiceId === 'string' ? payload.invoiceId : '';
      if (!invoiceId) throw new BadRequestException('invoiceId خرید الزامی است');
      return this.purchases.pay(
        invoiceId,
        String(payload.amount ?? ''),
        payload.method as never,
        typeof payload.notes === 'string' ? payload.notes : undefined,
        userId,
        undefined,
        payload.check as never,
        input.operationId,
      );
    }
    throw new BadRequestException(`نوع عملیات پشتیبانی نمی‌شود: ${input.type}`);
  }

  /** Replays only domain operations with idempotency guarantees. */
  async recoverPending(limit = 100) {
    const candidates = await this.prisma.syncOperation.findMany({
      where: {
        status: 'pending',
        type: { in: RECOVERABLE_OPERATION_TYPES },
        OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(Date.now() - 30_000) } }],
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(100, Math.max(1, limit)),
    });
    const results: Array<{ operationId: string; status: string }> = [];
    for (const operation of candidates) {
      const claimed = await this.claimOperation(operation.operationId);
      if (!claimed) continue;
      const outcome = await this.applyAndRecord(operation.userId, {
        operationId: operation.operationId,
        type: operation.type,
        deviceId: operation.deviceId,
        payload: operation.payload as Record<string, unknown>,
      });
      results.push({ operationId: operation.operationId, status: outcome.status });
    }
    return { ok: true, data: { inspected: candidates.length, results } };
  }

  async conflicts(userId: string, status?: 'open' | 'resolved') {
    const rows = await this.prisma.syncConflict.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { ok: true, data: rows };
  }

  /** Operator decision on an open conflict. The decision vocabulary is fixed:
   * retry | reject | accept_server_state | create_new_draft.
   *
   * - retry revives the original operation and applies it immediately; the
   *   response carries the final status (applied / conflict / failed), so the
   *   client never has to guess whether the retry actually ran.
   * - reject terminally fails the operation.
   * - accept_server_state fails the operation and returns the fresh server
   *   snapshot so the cache can be corrected without blind LWW writes.
   * - create_new_draft fails the operation and returns the original payload
   *   plus the server state as draft guidance. */
  async resolveConflict(
    userId: string,
    id: string,
    resolution: Record<string, unknown>,
  ): Promise<ConflictResolution> {
    const decision = typeof resolution.decision === 'string' ? resolution.decision : '';
    if (!(SYNC_CONFLICT_DECISIONS as readonly string[]).includes(decision))
      throw new BadRequestException(
        'decision باید یکی از retry، reject، accept_server_state یا create_new_draft باشد',
      );
    const note =
      typeof resolution.note === 'string' && resolution.note.trim()
        ? resolution.note.trim().slice(0, 500)
        : undefined;
    const conflict = await this.prisma.syncConflict.findFirst({
      where: { id, userId, status: 'open' },
    });
    if (!conflict) throw new NotFoundException('Conflict پیدا نشد');
    const operation = await this.prisma.syncOperation.findUnique({
      where: { operationId: conflict.operationId },
    });
    await this.prisma.syncConflict.update({
      where: { id },
      data: {
        status: 'resolved',
        resolution: { decision, ...(note ? { note } : {}) } as Prisma.InputJsonValue,
        resolvedAt: new Date(),
      },
    });
    const base = {
      conflictId: id,
      decision: decision as (typeof SYNC_CONFLICT_DECISIONS)[number],
      operationId: conflict.operationId,
    };
    if (decision === 'retry') {
      // Back to an executable state, then apply right away. If it conflicts
      // again a fresh open conflict is recorded and returned.
      await this.prisma.syncOperation.updateMany({
        where: { operationId: conflict.operationId, userId, status: 'conflict' },
        data: { status: 'pending', error: null, lastAttemptAt: null },
      });
      if (!operation)
        return { ok: true, data: { ...base, status: 'failed', error: 'عملیات اصلی پیدا نشد' } };
      const outcome = await this.applyAndRecord(userId, {
        operationId: operation.operationId,
        type: operation.type,
        deviceId: operation.deviceId,
        payload: operation.payload as Record<string, unknown>,
      });
      if (outcome.status === 'applied')
        return { ok: true, data: { ...base, status: 'applied', result: outcome.result } };
      return {
        ok: true,
        data: { ...base, status: outcome.status, error: outcome.error, conflict: outcome.conflict },
      };
    }
    if (decision === 'accept_server_state') {
      await this.prisma.syncOperation.updateMany({
        where: { operationId: conflict.operationId, userId, status: 'conflict' },
        data: { status: 'failed', error: 'وضعیت سرور توسط اپراتور پذیرفته شد' },
      });
      const snapshot = operation ? await this.serverSnapshot(operation) : null;
      return {
        ok: true,
        data: { ...base, status: 'failed', serverState: conflict.serverState, snapshot },
      };
    }
    if (decision === 'create_new_draft') {
      await this.prisma.syncOperation.updateMany({
        where: { operationId: conflict.operationId, userId, status: 'conflict' },
        data: { status: 'failed', error: 'اپراتور پیش‌نویس جدید درخواست کرد' },
      });
      return {
        ok: true,
        data: {
          ...base,
          status: 'failed',
          draft: {
            type: conflict.type,
            payload: conflict.payload,
            serverState: conflict.serverState,
          },
        },
      };
    }
    // reject
    await this.prisma.syncOperation.updateMany({
      where: { operationId: conflict.operationId, userId, status: 'conflict' },
      data: { status: 'failed', error: 'عملیات توسط اپراتور رد شد' },
    });
    return { ok: true, data: { ...base, status: 'failed' } };
  }

  /** Fresh, cache-rebuildable server state for the entity a conflicted
   * operation targeted — the payload accept_server_state hands to the client. */
  private async serverSnapshot(
    operation: SyncOperationRow,
  ): Promise<Record<string, unknown> | null> {
    const payload = (operation.payload ?? {}) as Record<string, unknown>;
    try {
      if (operation.type.startsWith('inventory.')) {
        const itemId = typeof payload.itemId === 'string' ? payload.itemId : '';
        if (!itemId) return null;
        const item = await this.prisma.inventoryItem.findUnique({ where: { id: itemId } });
        return item ? buildInventoryItemSyncPayload(item) : null;
      }
      if (operation.type.startsWith('product.')) {
        const productId =
          operation.type === 'product.update' && typeof payload.productId === 'string'
            ? payload.productId
            : (
                await this.prisma.productOperation.findUnique({
                  where: { operationId: operation.operationId },
                })
              )?.productId;
        if (!productId) return null;
        const product = await this.prisma.product.findUnique({
          where: { id: productId },
          include: { images: { where: { isPrimary: true }, orderBy: { sort: 'asc' }, take: 1 } },
        });
        if (!product) return null;
        const items = await this.prisma.inventoryItem.findMany({
          where: { productId, isActive: true },
        });
        return {
          ...buildProductSyncPayload(product, product.images[0]),
          inventoryItems: items.map(buildInventoryItemSyncPayload),
        };
      }
      if (operation.type === 'invoice.create' || operation.type === 'invoice.pay') {
        const invoiceId =
          typeof payload.invoiceId === 'string' && payload.invoiceId
            ? payload.invoiceId
            : (
                await this.prisma.invoice.findUnique({
                  where: { operationId: operation.operationId },
                })
              )?.id;
        if (!invoiceId) return null;
        const invoice = await this.prisma.invoice.findUnique({
          where: { id: invoiceId },
          include: {
            items: {
              select: {
                id: true,
                inventoryItemId: true,
                productName: true,
                quantity: true,
                unitPrice: true,
                lineTotal: true,
              },
            },
          },
        });
        return invoice ? buildInvoiceSyncPayload(invoice, invoice.items) : null;
      }
      if (operation.type === 'customer.create') {
        const mobile = typeof payload.mobile === 'string' ? payload.mobile : '';
        if (!mobile) return null;
        const customer = await this.prisma.customer.findUnique({ where: { mobile } });
        return customer
          ? {
              id: customer.id,
              name: customer.name,
              mobile: customer.mobile,
              isActive: customer.isActive,
            }
          : null;
      }
    } catch {
      return null;
    }
    return null;
  }

  async operations(userId: string, ids: string[]) {
    const rows = await this.prisma.syncOperation.findMany({
      where: { userId, operationId: { in: ids } },
      select: {
        operationId: true,
        type: true,
        status: true,
        result: true,
        error: true,
        appliedAt: true,
      },
    });
    return { ok: true, data: rows };
  }

  private async touchDevice(userId: string, deviceId: string) {
    if (!deviceId || deviceId.length > 100) throw new BadRequestException('deviceId الزامی است');
    await this.prisma.syncDevice.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      create: { userId, deviceId },
      update: { lastSeenAt: new Date() },
    });
  }
}
