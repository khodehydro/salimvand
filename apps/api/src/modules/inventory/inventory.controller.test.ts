import { describe, expect, it, vi } from 'vitest';
import { InventoryController } from './inventory.controller';

const request = { user: { id: 'user-1' } } as never;

describe('InventoryController', () => {
  it('passes inventory filters to the service', async () => {
    const list = vi.fn(async (filters: { q?: string; brandId?: string; locationId?: string; status?: 'low' | 'out' }) => ({ ok: true, data: [filters] }));
    const controller = new InventoryController({ list } as never);
    await expect(controller.list('لنت', 'brand-1', 'location-1', 'low')).resolves.toEqual({ ok: true, data: [{ q: 'لنت', brandId: 'brand-1', locationId: 'location-1', status: 'low' }] });
  });

  it('routes adjustment, receipt, transfer, and history with actor', async () => {
    const adjust = vi.fn(async () => ({ ok: true, data: {} }));
    const receive = vi.fn(async () => ({ ok: true, data: {} }));
    const transfer = vi.fn(async () => ({ ok: true, data: {} }));
    const transactions = vi.fn(async () => ({ ok: true, data: [] }));
    const controller = new InventoryController({ adjust, receive, transfer, transactions } as never);
    await controller.adjust('item-1', { quantity: '-2', reason: 'شمارش' } as never, request);
    await controller.receive({ itemId: 'item-1', quantity: 3, reason: 'خرید' } as never, request);
    await controller.transfer({ itemId: 'item-1', locationId: 'location-2' } as never, request);
    await controller.transactions('item-1');
    expect(adjust).toHaveBeenCalledWith({ itemId: 'item-1', quantity: -2, userId: 'user-1', reason: 'شمارش' });
    expect(receive).toHaveBeenCalledWith({ itemId: 'item-1', quantity: 3, userId: 'user-1', reason: 'خرید' });
    expect(transfer).toHaveBeenCalledWith('item-1', 'location-2', 'user-1');
    expect(transactions).toHaveBeenCalledWith('item-1');
  });
});
