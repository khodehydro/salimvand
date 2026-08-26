import { describe, expect, it, vi } from 'vitest';
import { DashboardService } from './dashboard.service';

function makeService() { const prisma = { product: { count: vi.fn() }, inventoryItem: { count: vi.fn() }, inventoryTransaction: { findMany: vi.fn() } }; return { service: new DashboardService(prisma as never), prisma }; }

describe('DashboardService', () => {
  it('aggregates product, inventory and recent transaction metrics', async () => {
    const { service, prisma } = makeService();
    prisma.product.count.mockResolvedValue(12); prisma.inventoryItem.count.mockResolvedValueOnce(20).mockResolvedValueOnce(3); prisma.inventoryTransaction.findMany.mockResolvedValue([{ id: '1', quantityChange: 2 }]);
    await expect(service.summary()).resolves.toEqual({ ok: true, data: { products: 12, inventoryItems: 20, lowStock: 3, recentTransactions: [{ id: '1', quantityChange: 2 }] } });
    expect(prisma.product.count).toHaveBeenCalledWith({ where: { deletedAt: null, status: 'active' } });
    expect(prisma.inventoryItem.count).toHaveBeenLastCalledWith({ where: { isActive: true, quantity: { lte: 0 } } });
    expect(prisma.inventoryTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' }, take: 8 }));
  });
});
