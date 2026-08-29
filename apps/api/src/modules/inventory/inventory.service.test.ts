import { describe, expect, it, vi } from 'vitest';
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
});
