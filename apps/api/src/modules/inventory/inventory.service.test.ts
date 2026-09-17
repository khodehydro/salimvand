import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';

const FULL_ITEM = {
  id: 'i1',
  productId: 'p1',
  brandId: 'b1',
  barcode: '6260000000123',
  quantity: 10,
  purchasePrice: 1000000n,
  salePrice: 1200000n,
  minStock: 2,
  locationId: 'shelf-1',
  isActive: true,
};

function makeService(item = FULL_ITEM) {
  const tx = {
    inventoryItem: {
      findUnique: vi.fn().mockResolvedValue(item),
      update: vi.fn().mockResolvedValue({ ...item, quantity: 7 }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    inventoryTransaction: {
      create: vi.fn().mockResolvedValue({ id: 't1', quantityAfter: 7 }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    inventoryOperation: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
    brand: { findUnique: vi.fn().mockResolvedValue({ id: 'b1', isActive: true }) },
    location: { findUnique: vi.fn().mockResolvedValue({ id: 'shelf-2' }) },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  return { service: new InventoryService(prisma as never), prisma, tx };
}

describe('InventoryService', () => {
  it('returns flat, label-ready rows for the product-label studio', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'item-1',
        barcode: '6260000000123',
        quantity: 4,
        brand: { name: 'ایساکو' },
        product: {
          id: 'prod-1',
          name: 'لنت ترمز جلو پژو ۲۰۶',
          code: 'BRK-00452',
          deletedAt: null,
          category: { name: 'ترمز' },
          compatibilities: [
            { model: { name: '۲۰۶', make: { name: 'پژو' } } },
            { model: { name: '۲۰۷', make: { name: 'پژو' } } },
            { model: { name: '۲۰۶', make: { name: 'پژو' } } },
          ],
        },
      },
    ]);
    const prisma = { inventoryItem: { findMany } };
    const result = await new InventoryService(prisma as never).labelItems('لنت');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          product: { deletedAt: null },
          OR: expect.any(Array),
        }),
      }),
    );
    expect(result.data).toEqual([
      {
        id: 'item-1',
        productId: 'prod-1',
        barcode: '6260000000123',
        name: 'لنت ترمز جلو پژو ۲۰۶',
        sku: 'BRK-00452',
        brand: 'ایساکو',
        category: 'ترمز',
        // duplicate model names collapse to one
        vehicles: '۲۰۶ · ۲۰۷',
        quantity: 4,
      },
    ]);
  });
  it('caps the vehicle list at four models with a summary tail', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'item-2',
        barcode: '6260000000456',
        quantity: 1,
        brand: { name: 'سرام' },
        product: {
          name: 'فیلتر روغن',
          code: 'FLT-00118',
          deletedAt: null,
          category: { name: 'فیلتراسیون' },
          compatibilities: [1, 2, 3, 4, 5, 6].map((n) => ({
            model: { name: `خودرو ${n}`, make: { name: 'ایران خودرو' } },
          })),
        },
      },
    ]);
    const prisma = { inventoryItem: { findMany } };
    const result = await new InventoryService(prisma as never).labelItems();
    expect(result.data[0].vehicles).toBe('خودرو 1 · خودرو 2 · خودرو 3 · خودرو 4 و 2 مورد دیگر');
  });
  it('allows a justified negative adjustment against current stock', async () => {
    const { service, tx } = makeService();
    const result = await service.adjust({
      itemId: 'i1',
      quantity: -3,
      userId: 'u1',
      reason: 'شمارش مجدد',
    });
    expect(result).toMatchObject({ ok: true, data: { item: { quantity: 7 } } });
    expect(tx.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { quantity: 7 },
    });
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ quantityChange: -3, quantityAfter: 7, type: 'adjustment' }),
    });
  });
  it('records a location transfer in the inventory ledger without changing quantity', async () => {
    const { service, tx } = makeService();
    const result = await service.transfer('i1', 'shelf-2', 'u1');
    expect(result).toMatchObject({ ok: true, data: { item: { quantity: 7 } } });
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        itemId: 'i1',
        type: 'transfer',
        quantityChange: 0,
        quantityAfter: 10,
        userId: 'u1',
      }),
    });
  });
  it('keeps the atomic mutation path for receiving stock', async () => {
    const { service, tx } = makeService();
    await service.receive({ itemId: 'i1', quantity: 4, userId: 'u1' });
    expect(tx.inventoryItem.update).toHaveBeenCalled();
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ quantityChange: 4, type: 'purchase' }),
    });
  });

  it('rejects a duplicate product+brand item with a readable message', async () => {
    const tx = {
      inventoryItem: { create: vi.fn() },
      inventoryTransaction: { create: vi.fn() },
    };
    const prisma = {
      product: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
      inventoryItem: {
        findFirst: vi
          .fn()
          // barcode is free, but the product+brand pair already exists
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'existing' }),
      },
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    await expect(
      new InventoryService(prisma as never).create({
        productId: 'p1',
        brandId: 'b1',
        barcode: '1234567890123',
        userId: 'u1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.inventoryItem.create).not.toHaveBeenCalled();
  });

  it('rejects an already-registered barcode with a readable message', async () => {
    const tx = { inventoryItem: { create: vi.fn() }, inventoryTransaction: { create: vi.fn() } };
    const prisma = {
      product: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: 'taken' }) },
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    await expect(
      new InventoryService(prisma as never).create({
        productId: 'p1',
        brandId: 'b1',
        barcode: '1234567890123',
        userId: 'u1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('searches the live list by barcode, product name, product code and brand', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { inventoryItem: { findMany } };
    await new InventoryService(prisma as never).list({ q: 'لنت' });
    const args = findMany.mock.calls[0][0] as {
      where: { OR: Array<Record<string, unknown>> };
      include: { product: { include: Record<string, unknown> } };
    };
    expect(args.where.OR).toEqual([
      { barcode: { contains: 'لنت' } },
      { product: { name: { contains: 'لنت', mode: 'insensitive' } } },
      { product: { code: { contains: 'لنت', mode: 'insensitive' } } },
      { brand: { name: { contains: 'لنت', mode: 'insensitive' } } },
    ]);
    // The richer cards need category + compatibilities next to the image.
    expect(Object.keys(args.include.product.include)).toEqual(
      expect.arrayContaining(['images', 'category', 'compatibilities']),
    );
  });

  it('lists everything without a filter clause when the search box is empty', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'i1', quantity: 3, minStock: null }]);
    const prisma = { inventoryItem: { findMany } };
    const result = await new InventoryService(prisma as never).list({ q: '  ' });
    const args = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toEqual({ isActive: true, product: { deletedAt: null } });
    expect(result.data).toHaveLength(1);
  });

  it('filters the list to out-of-stock rows with status=out', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'ok', quantity: 5, minStock: 2 },
      { id: 'zero', quantity: 0, minStock: null },
    ]);
    const prisma = { inventoryItem: { findMany } };
    const result = await new InventoryService(prisma as never).list({ status: 'out' });
    expect(result.data.map((item: { id: string }) => item.id)).toEqual(['zero']);
  });
});

describe('InventoryService.updateMetadata (offline command inventory.update_metadata)', () => {
  it('updates prices, shelf and barcode atomically without touching quantity', async () => {
    const { service, tx } = makeService();
    const result = await service.updateMetadata(
      {
        itemId: 'i1',
        purchasePrice: '1500000',
        salePrice: '1900000',
        minStock: 5,
        locationId: 'shelf-2',
        barcode: '6261111222333',
      },
      'u1',
      'android-meta-0001',
    );
    expect(result).toMatchObject({ ok: true, duplicate: false });
    const update = tx.inventoryItem.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(update.data).toEqual({
      purchasePrice: 1500000n,
      salePrice: 1900000n,
      minStock: 5,
      locationId: 'shelf-2',
      barcode: '6261111222333',
    });
    expect(update.data).not.toHaveProperty('quantity');
    expect(tx.inventoryOperation.create).toHaveBeenCalledWith({
      data: { operationId: 'android-meta-0001', itemId: 'i1', type: 'inventory.update_metadata' },
    });
  });

  it('is idempotent per operationId and replays the stored line', async () => {
    const { service, tx } = makeService();
    tx.inventoryOperation.findUnique.mockResolvedValue({
      operationId: 'android-meta-0002',
      itemId: 'i1',
      type: 'inventory.update_metadata',
    });
    tx.inventoryItem.findUnique.mockResolvedValue(FULL_ITEM);
    const result = await service.updateMetadata(
      { itemId: 'i1', salePrice: '1900000' },
      'u1',
      'android-meta-0002',
    );
    expect(result).toMatchObject({ ok: true, duplicate: true, data: { id: 'i1' } });
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  });

  it('rejects brand duplicates on the same product and unknown locations', async () => {
    const { service, tx } = makeService();
    tx.inventoryItem.findFirst.mockResolvedValue({ id: 'other' });
    await expect(
      service.updateMetadata({ itemId: 'i1', brandId: 'b1' }, 'u1', 'android-meta-0003'),
    ).rejects.toThrow('این برند قبلاً برای همین محصول ثبت شده است');
    tx.inventoryItem.findFirst.mockResolvedValue(null);
    tx.location.findUnique.mockResolvedValue(null);
    await expect(
      service.updateMetadata({ itemId: 'i1', locationId: 'void' }, 'u1', 'android-meta-0004'),
    ).rejects.toThrow('موقعیت انبار نامعتبر است');
  });

  it('rejects an empty metadata payload instead of writing a no-op', async () => {
    const { service } = makeService();
    await expect(
      service.updateMetadata({ itemId: 'i1' }, 'u1', 'android-meta-0005'),
    ).rejects.toThrow('تغییری ارسال نشده است');
  });
});
