import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';

function makeService(item = { id: 'i1', quantity: 10 }) {
  const tx = {
    inventoryItem: {
      findUnique: vi.fn().mockResolvedValue(item),
      update: vi.fn().mockResolvedValue({ ...item, quantity: 7 }),
    },
    inventoryTransaction: { create: vi.fn().mockResolvedValue({ id: 't1', quantityAfter: 7 }) },
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
});
