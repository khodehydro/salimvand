import { describe, expect, it, vi } from 'vitest';
import { DashboardService } from './dashboard.service';

function makeService() { const prisma = { product: { count: vi.fn() }, inventoryItem: { count: vi.fn(), findMany: vi.fn() }, inventoryTransaction: { findMany: vi.fn() }, invoice: { findMany: vi.fn() } }; return { service: new DashboardService(prisma as never), prisma }; }

describe('DashboardService', () => {
  it('aggregates product, inventory, threshold and recent transaction metrics', async () => {
    const { service, prisma } = makeService();
    prisma.product.count.mockResolvedValue(12); prisma.inventoryItem.count.mockResolvedValue(20); prisma.inventoryItem.findMany.mockResolvedValue([{ id: 'i1', quantity: 2, minStock: 3, product: { name: 'لنت', code: 'BRK-1' }, brand: { name: 'اصلی' }, location: { code: 'A-1', name: 'قفسه ۱' } }, { id: 'i2', quantity: 10, minStock: 3, product: { name: 'فیلتر', code: 'FLT-1' }, brand: { name: 'بوش' }, location: null }]); prisma.inventoryTransaction.findMany.mockResolvedValue([{ id: '1', quantityChange: 2 }]);
    await expect(service.summary()).resolves.toEqual({ ok: true, data: { products: 12, inventoryItems: 20, lowStock: 1, lowStockItems: [{ id: 'i1', quantity: 2, minStock: 3, product: { name: 'لنت', code: 'BRK-1' }, brand: { name: 'اصلی' }, location: { code: 'A-1', name: 'قفسه ۱' } }], recentTransactions: [{ id: '1', quantityChange: 2 }] } });
    expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20, orderBy: { quantity: 'asc' } }));
  });

  it('groups the sales trend by day and returns JSON-safe amounts', async () => {
    const { service, prisma } = makeService();
    prisma.invoice = { findMany: vi.fn().mockResolvedValue([{ issuedAt: new Date('2026-08-01T10:00:00Z'), total: 1000n, paidAmount: 400n }, { issuedAt: new Date('2026-08-01T15:00:00Z'), total: 500n, paidAmount: 500n }, { issuedAt: new Date('2026-08-02T10:00:00Z'), total: 200n, paidAmount: 0n }]) };
    await expect(service.salesTrend('2026-08-01', '2026-08-02')).resolves.toMatchObject({ ok: true, data: [{ date: '2026-08-01', revenue: '1500', paid: '900', invoiceCount: 2 }, { date: '2026-08-02', revenue: '200', paid: '0', invoiceCount: 1 }] });
  });
});
