import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SyncService } from './sync.service';

const USER_ID = 'user-1';

function makeService(overrides: Record<string, unknown> = {}) {
  const prisma = {
    syncDevice: { upsert: vi.fn().mockResolvedValue({}) },
    syncOperation: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    syncConflict: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({
        id: 'conflict-2',
        code: 'INSUFFICIENT_STOCK',
        serverState: { itemId: 'i1' },
      }),
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ role: 'manager' }) },
    inventoryItem: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    product: { findUnique: vi.fn().mockResolvedValue(null) },
    productOperation: { findUnique: vi.fn().mockResolvedValue(null) },
    invoice: { findUnique: vi.fn().mockResolvedValue(null) },
    customer: { findUnique: vi.fn().mockResolvedValue(null) },
    ...overrides,
  };
  const inventory = {
    receive: vi.fn(),
    adjust: vi.fn(),
    transfer: vi.fn(),
    updateMetadata: vi.fn(),
  };
  const catalog = { create: vi.fn(), update: vi.fn() };
  const invoice = { create: vi.fn(), createCustomer: vi.fn(), pay: vi.fn() };
  const purchases = { create: vi.fn(), pay: vi.fn() };
  const service = new SyncService(
    prisma as never,
    inventory as never,
    catalog as never,
    invoice as never,
    purchases as never,
  );
  return { service, prisma, inventory, catalog, invoice, purchases };
}

const OPERATION = {
  operationId: 'android-device-op-000001',
  deviceId: 'android-device',
  type: 'inventory.receive',
  payload: { itemId: 'i1', quantity: 5 },
};

describe('SyncService.queueOperation', () => {
  it('applies a fresh operation and returns the fixed response schema', async () => {
    const { service, prisma, inventory } = makeService();
    inventory.receive.mockResolvedValue({ ok: true, data: { item: { id: 'i1', quantity: 5n } } });
    const result = await service.queueOperation(USER_ID, OPERATION);
    expect(result).toEqual({
      ok: true,
      data: {
        operationId: 'android-device-op-000001',
        status: 'applied',
        result: { item: { id: 'i1', quantity: '5' } },
        duplicate: false,
      },
    });
    expect(prisma.syncOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'applied' }) }),
    );
  });

  it('verifies the role before the operation row is created', async () => {
    const { service, prisma } = makeService();
    // Accountants never touch stock operations; sellers and warehouse staff
    // are now allowed (the mobile app is their workflow).
    prisma.user.findUnique.mockResolvedValue({ role: 'accountant' });
    await expect(service.queueOperation(USER_ID, OPERATION)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.syncOperation.create).not.toHaveBeenCalled();
  });

  it('lets sellers and warehouse staff run catalog and inventory operations from the app', async () => {
    const { service, prisma, inventory, catalog } = makeService();
    prisma.user.findUnique.mockResolvedValue({ role: 'seller' });
    inventory.receive.mockResolvedValue({ ok: true, data: { item: { id: 'i1' } } });
    await service.queueOperation(USER_ID, OPERATION);
    expect(inventory.receive).toHaveBeenCalled();

    catalog.create.mockResolvedValue({ ok: true, data: { id: 'p1', inventoryItems: [] } });
    await service.queueOperation(USER_ID, {
      operationId: 'android-device-product-000099',
      deviceId: 'android-device',
      type: 'product.create',
      payload: { name: 'لنت', categoryId: 'c1', items: [] },
    });
    expect(catalog.create).toHaveBeenCalled();

    prisma.user.findUnique.mockResolvedValue({ role: 'warehouse' });
    await service.queueOperation(USER_ID, {
      operationId: 'android-device-product-000098',
      deviceId: 'android-device',
      type: 'product.create',
      payload: { name: 'فیلتر', categoryId: 'c1', items: [] },
    });
    expect(catalog.create).toHaveBeenCalledTimes(2);
  });

  it('re-applies a duplicate pending operation so a revived retry actually runs', async () => {
    const { service, prisma, inventory } = makeService();
    prisma.syncOperation.findUnique.mockResolvedValue({
      ...OPERATION,
      userId: USER_ID,
      status: 'pending',
      payload: OPERATION.payload,
    });
    inventory.receive.mockResolvedValue({ ok: true, data: { item: { id: 'i1' } } });
    const result = await service.queueOperation(USER_ID, OPERATION);
    expect(result.data).toMatchObject({
      operationId: OPERATION.operationId,
      status: 'applied',
      duplicate: true,
    });
    expect(inventory.receive).toHaveBeenCalled();
  });

  it('re-claims a pending operation after the 5-second stale window', async () => {
    const { service, prisma, inventory } = makeService();
    prisma.syncOperation.findUnique.mockResolvedValue({
      ...OPERATION,
      userId: USER_ID,
      status: 'pending',
      payload: OPERATION.payload,
    });
    inventory.receive.mockResolvedValue({ ok: true, data: { item: { id: 'i1' } } });
    await service.queueOperation(USER_ID, OPERATION);
    const claim = prisma.syncOperation.updateMany.mock.calls
      .map((call) => call[0] as { where?: { OR?: Array<{ lastAttemptAt?: { lt: Date } }> } })
      .find((args) => args.where?.OR?.[1]?.lastAttemptAt);
    // The claim window dropped from 30s to 5s so a crashed apply no longer
    // leaves the mobile client looping on duplicate/pending for half a minute.
    const staleBefore = claim?.where?.OR?.[1]?.lastAttemptAt?.lt;
    expect(staleBefore).toBeInstanceOf(Date);
    const staleFor = Date.now() - (staleBefore as Date).getTime();
    expect(staleFor).toBeGreaterThanOrEqual(4_000);
    expect(staleFor).toBeLessThanOrEqual(6_000);
  });

  it('retries a failed operation instead of replaying the stale failure', async () => {
    const { service, prisma, inventory } = makeService();
    prisma.syncOperation.findUnique.mockResolvedValue({
      ...OPERATION,
      userId: USER_ID,
      status: 'failed',
      error: 'این برند قبلاً برای همین محصول ثبت شده است',
      payload: OPERATION.payload,
    });
    inventory.receive.mockResolvedValue({ ok: true, data: { item: { id: 'i1' } } });
    const result = await service.queueOperation(USER_ID, OPERATION);
    expect(result.data).toMatchObject({
      operationId: OPERATION.operationId,
      status: 'applied',
      duplicate: true,
    });
    expect(inventory.receive).toHaveBeenCalled();
    // A failed claim is immediate (no 5s guard) and clears the stale outcome.
    const claim = prisma.syncOperation.updateMany.mock.calls[0][0] as {
      where: { status: string };
      data: Record<string, unknown>;
    };
    expect(claim.where.status).toBe('failed');
    // Prisma.JsonNull is the typed null for the Json result column.
    expect(claim.data).toMatchObject({ status: 'pending', error: null, result: Prisma.JsonNull });
  });

  it('replays a terminal conflict with its recorded error and no side effects', async () => {
    const { service, prisma, inventory } = makeService();
    prisma.syncOperation.findUnique.mockResolvedValue({
      ...OPERATION,
      userId: USER_ID,
      status: 'conflict',
      error: 'موجودی کافی نیست',
      result: null,
      payload: OPERATION.payload,
    });
    const result = await service.queueOperation(USER_ID, OPERATION);
    expect(result.data).toMatchObject({
      status: 'conflict',
      duplicate: true,
      error: 'موجودی کافی نیست',
    });
    expect(inventory.receive).not.toHaveBeenCalled();
    expect(prisma.syncOperation.updateMany).not.toHaveBeenCalled();
  });

  it('answers with the stale status and error when the claim is not won', async () => {
    const { service, prisma } = makeService();
    prisma.syncOperation.findUnique.mockResolvedValue({
      ...OPERATION,
      userId: USER_ID,
      status: 'pending',
      payload: OPERATION.payload,
    });
    // Another worker holds the attempt (0 rows matched the claim).
    prisma.syncOperation.updateMany.mockResolvedValue({ count: 0 });
    const result = await service.queueOperation(USER_ID, OPERATION);
    expect(result.data).toMatchObject({ status: 'pending', duplicate: true });
    expect(result.data.error).toBeUndefined();
  });

  it('keeps a duplicate applied operation read-only', async () => {
    const { service, prisma, inventory } = makeService();
    prisma.syncOperation.findUnique.mockResolvedValue({
      ...OPERATION,
      userId: USER_ID,
      status: 'applied',
      result: { item: { id: 'i1' } },
    });
    const result = await service.queueOperation(USER_ID, OPERATION);
    expect(result.data).toMatchObject({ status: 'applied', duplicate: true });
    expect(inventory.receive).not.toHaveBeenCalled();
  });

  it('records a conflict with the open row and rethrows the original 409', async () => {
    const { service, prisma, inventory } = makeService();
    inventory.receive.mockRejectedValue(
      new ConflictException({
        code: 'INSUFFICIENT_STOCK',
        message: 'موجودی کافی نیست',
        itemId: 'i1',
      }),
    );
    await expect(service.queueOperation(USER_ID, OPERATION)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.syncOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'conflict' }) }),
    );
    expect(prisma.syncConflict.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { operationId_status: { operationId: OPERATION.operationId, status: 'open' } },
      }),
    );
  });

  it('rejects an operation from another device owner', async () => {
    const { service, prisma } = makeService();
    prisma.syncOperation.findUnique.mockResolvedValue({
      ...OPERATION,
      userId: 'someone-else',
      status: 'applied',
    });
    await expect(service.queueOperation(USER_ID, OPERATION)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('SyncService.applyOperation routing', () => {
  it('routes product.create with the inventory sub-object to the atomic catalog service', async () => {
    const { service, catalog } = makeService();
    catalog.create.mockResolvedValue({ ok: true, data: { id: 'p1', inventoryItem: { id: 'i1' } } });
    const payload = {
      name: 'لنت',
      categoryId: 'c1',
      inventory: { salePrice: '1000', initialQuantity: 2 },
    };
    const result = await service.queueOperation(USER_ID, {
      operationId: 'android-device-product-000001',
      deviceId: 'android-device',
      type: 'product.create',
      payload,
    });
    expect(result.data.status).toBe('applied');
    expect(catalog.create).toHaveBeenCalledWith(
      payload,
      USER_ID,
      undefined,
      'android-device-product-000001',
    );
    expect(result.data.result).toEqual({ id: 'p1', inventoryItem: { id: 'i1' } });
  });

  it('routes customer.create with the address and notes to the invoice customer service', async () => {
    const { service, invoice } = makeService();
    invoice.createCustomer.mockResolvedValue({ ok: true, data: { id: 'customer-1' } });
    const result = await service.queueOperation(USER_ID, {
      operationId: 'android-device-customer-000001',
      deviceId: 'android-device',
      type: 'customer.create',
      payload: {
        name: 'حسن رضایی',
        mobile: '09121234567',
        address: 'تهران، خیابان نمونه، پلاک ۱۲',
        notes: 'مشتری تعمیرگاه',
      },
    });
    expect(result.data.status).toBe('applied');
    expect(invoice.createCustomer).toHaveBeenCalledWith({
      name: 'حسن رضایی',
      mobile: '09121234567',
      address: 'تهران، خیابان نمونه، پلاک ۱۲',
      notes: 'مشتری تعمیرگاه',
    });
  });

  it('routes product.update and forwards the nested inventory object to the atomic catalog service', async () => {
    const { service, catalog } = makeService();
    catalog.update.mockResolvedValue({ ok: true, data: { id: 'p1', inventoryItem: { id: 'i1' } } });
    await service.queueOperation(USER_ID, {
      operationId: 'android-device-product-000002',
      deviceId: 'android-device',
      type: 'product.update',
      payload: {
        productId: 'p1',
        name: 'نام جدید',
        inventory: { itemId: 'i1', salePrice: '2000' },
      },
    });
    // Only productId is stripped; inventory must survive the routing so
    // CatalogAdminService.update can apply it in the same transaction.
    expect(catalog.update).toHaveBeenCalledWith(
      'p1',
      { name: 'نام جدید', inventory: { itemId: 'i1', salePrice: '2000' } },
      USER_ID,
      undefined,
      'android-device-product-000002',
    );
  });

  it('routes inventory.update_metadata with idempotency and the caller identity', async () => {
    const { service, inventory } = makeService();
    inventory.updateMetadata.mockResolvedValue({ ok: true, data: { id: 'i1' } });
    const result = await service.queueOperation(USER_ID, {
      operationId: 'android-device-meta-000001',
      deviceId: 'android-device',
      type: 'inventory.update_metadata',
      payload: {
        itemId: 'i1',
        salePrice: '2000',
        minStock: 4,
        locationId: 'shelf-9',
        barcode: '6260000000123',
      },
    });
    expect(result.data.status).toBe('applied');
    expect(inventory.updateMetadata).toHaveBeenCalledWith(
      {
        itemId: 'i1',
        salePrice: '2000',
        minStock: 4,
        locationId: 'shelf-9',
        barcode: '6260000000123',
        purchasePrice: undefined,
        brandId: undefined,
        notes: undefined,
      },
      USER_ID,
      'android-device-meta-000001',
    );
  });

  it('rejects an unsupported operation type at the envelope level', async () => {
    const { service } = makeService();
    await expect(
      service.queueOperation(USER_ID, { ...OPERATION, type: 'inventory.delete' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SyncService.resolveConflict', () => {
  const conflictRow = {
    id: 'conflict-1',
    operationId: OPERATION.operationId,
    userId: USER_ID,
    deviceId: 'android-device',
    type: 'inventory.receive',
    code: 'INSUFFICIENT_STOCK',
    payload: OPERATION.payload,
    serverState: { code: 'INSUFFICIENT_STOCK', itemId: 'i1' },
    status: 'open',
  };
  const operationRow = { ...OPERATION, userId: USER_ID, status: 'conflict' };

  it('rejects any decision outside the fixed vocabulary', async () => {
    const { service, prisma } = makeService();
    prisma.syncConflict.findFirst.mockResolvedValue(conflictRow);
    await expect(
      service.resolveConflict(USER_ID, 'conflict-1', { decision: 'force_local' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.resolveConflict(USER_ID, 'conflict-1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('retry revives the operation, applies it and returns the final status', async () => {
    const { service, prisma, inventory } = makeService();
    prisma.syncConflict.findFirst.mockResolvedValue(conflictRow);
    prisma.syncOperation.findUnique.mockResolvedValue(operationRow);
    inventory.receive.mockResolvedValue({ ok: true, data: { item: { id: 'i1', quantity: 5n } } });
    const result = await service.resolveConflict(USER_ID, 'conflict-1', { decision: 'retry' });
    expect(prisma.syncOperation.updateMany).toHaveBeenCalledWith({
      where: { operationId: OPERATION.operationId, userId: USER_ID, status: 'conflict' },
      data: { status: 'pending', error: null, lastAttemptAt: null },
    });
    expect(inventory.receive).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'i1', operationId: OPERATION.operationId }),
    );
    expect(result.data).toMatchObject({
      decision: 'retry',
      operationId: OPERATION.operationId,
      status: 'applied',
    });
    expect(result.data.result).toEqual({ item: { id: 'i1', quantity: '5' } });
  });

  it('retry that conflicts again returns the new open conflict instead of a duplicate failed operation', async () => {
    const { service, prisma, inventory } = makeService();
    prisma.syncConflict.findFirst.mockResolvedValue(conflictRow);
    prisma.syncOperation.findUnique.mockResolvedValue(operationRow);
    inventory.receive.mockRejectedValue(
      new ConflictException({ code: 'INSUFFICIENT_STOCK', message: 'موجودی کافی نیست' }),
    );
    const result = await service.resolveConflict(USER_ID, 'conflict-1', { decision: 'retry' });
    expect(result.data.status).toBe('conflict');
    expect(result.data.conflict).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(prisma.syncOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'conflict' }) }),
    );
  });

  it('reject marks the operation terminally failed', async () => {
    const { service, prisma } = makeService();
    prisma.syncConflict.findFirst.mockResolvedValue(conflictRow);
    const result = await service.resolveConflict(USER_ID, 'conflict-1', {
      decision: 'reject',
      note: 'اشتباه بود',
    });
    expect(result.data).toMatchObject({ decision: 'reject', status: 'failed' });
    expect(prisma.syncOperation.updateMany).toHaveBeenCalledWith({
      where: { operationId: OPERATION.operationId, userId: USER_ID, status: 'conflict' },
      data: { status: 'failed', error: 'عملیات توسط اپراتور رد شد' },
    });
  });

  it('accept_server_state returns a fresh server snapshot for the cache', async () => {
    const { service, prisma } = makeService();
    prisma.syncConflict.findFirst.mockResolvedValue(conflictRow);
    prisma.syncOperation.findUnique.mockResolvedValue(operationRow);
    prisma.inventoryItem.findUnique.mockResolvedValue({
      id: 'i1',
      productId: 'p1',
      brandId: null,
      barcode: '6260000000123',
      quantity: 3,
      purchasePrice: 100n,
      salePrice: 120n,
      minStock: null,
      locationId: null,
      isActive: true,
    });
    const result = await service.resolveConflict(USER_ID, 'conflict-1', {
      decision: 'accept_server_state',
    });
    expect(result.data.status).toBe('failed');
    expect(result.data.serverState).toEqual({ code: 'INSUFFICIENT_STOCK', itemId: 'i1' });
    expect(result.data.snapshot).toEqual({
      id: 'i1',
      productId: 'p1',
      brandId: null,
      barcode: '6260000000123',
      quantity: 3,
      purchasePrice: '100',
      salePrice: '120',
      minStock: null,
      locationId: null,
      isActive: true,
      priceUpdatedAt: null,
      priceUpdatedAtJalali: null,
    });
  });

  it('accept_server_state for customer.create returns the full customer payload with the address', async () => {
    const { service, prisma } = makeService();
    const customerConflict = {
      ...conflictRow,
      type: 'customer.create',
      payload: { name: 'حسن رضایی', mobile: '09121234567' },
    };
    prisma.syncConflict.findFirst.mockResolvedValue(customerConflict);
    prisma.syncOperation.findUnique.mockResolvedValue({
      ...operationRow,
      type: 'customer.create',
      payload: { name: 'حسن رضایی', mobile: '09121234567' },
    });
    prisma.customer.findUnique.mockResolvedValue({
      id: 'customer-1',
      name: 'حسن رضایی',
      mobile: '09121234567',
      address: 'تهران، خیابان نمونه، پلاک ۱۲',
      notes: 'مشتری تعمیرگاه',
      isActive: true,
      updatedAt: new Date('2026-09-18T12:00:00Z'),
    });
    const result = await service.resolveConflict(USER_ID, 'conflict-1', {
      decision: 'accept_server_state',
    });
    expect(result.data.snapshot).toEqual({
      id: 'customer-1',
      name: 'حسن رضایی',
      mobile: '09121234567',
      address: 'تهران، خیابان نمونه، پلاک ۱۲',
      notes: 'مشتری تعمیرگاه',
      isActive: true,
      updatedAt: '2026-09-18T12:00:00.000Z',
    });
  });

  it('create_new_draft returns the original payload and server state as draft guidance', async () => {
    const { service, prisma } = makeService();
    prisma.syncConflict.findFirst.mockResolvedValue(conflictRow);
    const result = await service.resolveConflict(USER_ID, 'conflict-1', {
      decision: 'create_new_draft',
    });
    expect(result.data).toMatchObject({ decision: 'create_new_draft', status: 'failed' });
    expect(result.data.draft).toEqual({
      type: 'inventory.receive',
      payload: OPERATION.payload,
      serverState: { code: 'INSUFFICIENT_STOCK', itemId: 'i1' },
    });
  });

  it('throws 404 when the conflict does not belong to the caller', async () => {
    const { service, prisma } = makeService();
    prisma.syncConflict.findFirst.mockResolvedValue(null);
    await expect(
      service.resolveConflict(USER_ID, 'missing', { decision: 'retry' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SyncService.recoverPending', () => {
  it('replays stale pending operations and records their outcome', async () => {
    const { service, prisma, inventory } = makeService();
    prisma.syncOperation.findMany.mockResolvedValue([
      { ...OPERATION, userId: USER_ID, status: 'pending', lastAttemptAt: null },
    ]);
    inventory.receive.mockResolvedValue({ ok: true, data: { item: { id: 'i1' } } });
    const result = await service.recoverPending();
    expect(prisma.syncOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'pending' }) }),
    );
    expect(inventory.receive).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: OPERATION.operationId }),
    );
    expect(result.data).toEqual({
      inspected: 1,
      results: [{ operationId: OPERATION.operationId, status: 'applied' }],
    });
  });
});

describe('SyncService.bootstrap', () => {
  it('ships the 100 most recent customers with addresses for the first login', async () => {
    const updatedAt = new Date('2026-09-18T12:00:00Z');
    const { service, result } = await (async () => {
      const made = makeService({
        category: { findMany: vi.fn().mockResolvedValue([]) },
        brand: { findMany: vi.fn().mockResolvedValue([]) },
        location: { findMany: vi.fn().mockResolvedValue([]) },
        product: { findMany: vi.fn().mockResolvedValue([]) },
        customer: {
          findUnique: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'customer-1',
              name: 'حسن رضایی',
              mobile: '09121234567',
              address: 'تهران، خیابان نمونه، پلاک ۱۲',
              notes: 'مشتری تعمیرگاه',
              isActive: true,
              updatedAt,
            },
          ]),
        },
        syncChange: { aggregate: vi.fn().mockResolvedValue({ _max: { revision: 42n } }) },
      });
      const bootstrapped = await made.service.bootstrap(USER_ID, 'android-device');
      return { service: made.service, result: bootstrapped };
    })();
    // Same shape as the pull stream, so the client caches both identically.
    expect(result.data.customers).toEqual([
      {
        id: 'customer-1',
        name: 'حسن رضایی',
        mobile: '09121234567',
        address: 'تهران، خیابان نمونه، پلاک ۱۲',
        notes: 'مشتری تعمیرگاه',
        isActive: true,
        updatedAt: updatedAt.toISOString(),
      },
    ]);
    expect(result.data.cursor).toBe('42');
  });
});
