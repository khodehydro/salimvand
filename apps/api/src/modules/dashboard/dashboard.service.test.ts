import { describe, expect, it, vi } from 'vitest';
import { DashboardService } from './dashboard.service';

function makeService() {
  const prisma = {
    product: { count: vi.fn() },
    inventoryItem: { count: vi.fn(), findMany: vi.fn() },
    inventoryTransaction: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
  };
  return { service: new DashboardService(prisma as never), prisma };
}

describe('DashboardService', () => {
  it('aggregates product, inventory, threshold and recent transaction metrics', async () => {
    const { service, prisma } = makeService();
    prisma.product.count.mockResolvedValue(12);
    prisma.inventoryItem.count.mockResolvedValue(20);
    prisma.inventoryItem.findMany
      .mockResolvedValueOnce([
        {
          id: 'i1',
          quantity: 2,
          minStock: 3,
          product: { name: 'لنت', code: 'BRK-1' },
          brand: { name: 'اصلی' },
          location: { code: 'A-1', name: 'قفسه ۱' },
        },
        {
          id: 'i2',
          quantity: 10,
          minStock: 3,
          product: { name: 'فیلتر', code: 'FLT-1' },
          brand: { name: 'بوش' },
          location: null,
        },
      ])
      .mockResolvedValueOnce([
        { quantity: 12, brand: { name: 'اصلی' } },
        { quantity: 8, brand: { name: 'بوش' } },
      ]);
    prisma.inventoryTransaction.findMany.mockResolvedValue([{ id: '1', quantityChange: 2 }]);
    await expect(service.summary()).resolves.toEqual({
      ok: true,
      data: {
        products: 12,
        inventoryItems: 20,
        lowStock: 1,
        lowStockItems: [
          {
            id: 'i1',
            quantity: 2,
            minStock: 3,
            product: { name: 'لنت', code: 'BRK-1' },
            brand: { name: 'اصلی' },
            location: { code: 'A-1', name: 'قفسه ۱' },
          },
        ],
        stockComposition: [
          { quantity: 12, brand: { name: 'اصلی' } },
          { quantity: 8, brand: { name: 'بوش' } },
        ],
        recentTransactions: [{ id: '1', quantityChange: 2 }],
      },
    });
    expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20, orderBy: { quantity: 'asc' } }),
    );
  });

  it('groups the sales trend by day and returns JSON-safe amounts', async () => {
    const { service, prisma } = makeService();
    prisma.invoice = {
      findMany: vi.fn().mockResolvedValue([
        { issuedAt: new Date('2026-08-01T10:00:00Z'), total: 1000n, paidAmount: 400n },
        { issuedAt: new Date('2026-08-01T15:00:00Z'), total: 500n, paidAmount: 500n },
        { issuedAt: new Date('2026-08-02T10:00:00Z'), total: 200n, paidAmount: 0n },
      ]),
    };
    await expect(service.salesTrend('2026-08-01', '2026-08-02')).resolves.toMatchObject({
      ok: true,
      data: [
        { date: '2026-08-01', revenue: '1500', paid: '900', invoiceCount: 2 },
        { date: '2026-08-02', revenue: '200', paid: '0', invoiceCount: 1 },
      ],
    });
    expect(prisma.invoice.findMany.mock.calls[0][0].where.issuedAt.lte.toISOString()).toBe(
      '2026-08-02T23:59:59.999Z',
    );
  });

  it('groups inventory movements by day and direction', async () => {
    const { service, prisma } = makeService();
    prisma.inventoryTransaction.findMany.mockResolvedValue([
      { createdAt: new Date('2026-08-01T10:00:00Z'), quantityChange: 5, type: 'purchase' },
      { createdAt: new Date('2026-08-01T11:00:00Z'), quantityChange: -2, type: 'sale' },
      { createdAt: new Date('2026-08-01T12:00:00Z'), quantityChange: 1, type: 'return' },
    ]);
    await expect(service.inventoryTrend('2026-08-01', '2026-08-01')).resolves.toEqual({
      ok: true,
      data: [{ date: '2026-08-01', inbound: 5, outbound: 2, returns: 1 }],
    });
    expect(
      prisma.inventoryTransaction.findMany.mock.calls[0][0].where.createdAt.lte.toISOString(),
    ).toBe('2026-08-01T23:59:59.999Z');
  });

  it('calculates daily revenue, cost and gross profit', async () => {
    const { service, prisma } = makeService();
    prisma.invoice.findMany.mockResolvedValue([
      {
        issuedAt: new Date('2026-08-01T10:00:00Z'),
        items: [{ quantity: 2, unitPrice: 100n, inventoryItem: { purchasePrice: 60n } }],
      },
    ]);
    await expect(service.profitTrend('2026-08-01', '2026-08-01')).resolves.toEqual({
      ok: true,
      data: [{ date: '2026-08-01', revenue: '200', cost: '120', profit: '80' }],
    });
    expect(prisma.invoice.findMany.mock.calls[0][0].where.issuedAt.lte.toISOString()).toBe(
      '2026-08-01T23:59:59.999Z',
    );
  });
});
