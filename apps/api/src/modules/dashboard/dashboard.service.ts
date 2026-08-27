import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}
  async audit(page = 1, pageSize = 50, entityType?: string) {
    const safePage = Math.max(1, page); const safeSize = Math.min(100, Math.max(1, pageSize));
    const where = entityType ? { entityType } : {};
    const [rows, total] = await Promise.all([this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (safePage - 1) * safeSize, take: safeSize, include: { user: { select: { name: true, username: true, role: true } } } }), this.prisma.auditLog.count({ where })]);
    return { ok: true, data: rows, meta: { page: safePage, pageSize: safeSize, total, totalPages: Math.ceil(total / safeSize) } };
  }

  async summary() {
    const [products, inventoryItems, lowStockItems, recentTransactions] = await Promise.all([
      this.prisma.product.count({ where: { deletedAt: null, status: 'active' } }),
      this.prisma.inventoryItem.count({ where: { isActive: true } }),
      this.prisma.inventoryItem.findMany({ where: { isActive: true }, orderBy: { quantity: 'asc' }, take: 20, select: { id: true, quantity: true, minStock: true, product: { select: { name: true, code: true } }, brand: { select: { name: true } }, location: { select: { code: true, name: true } } } }),
      this.prisma.inventoryTransaction.findMany({ orderBy: { createdAt: 'desc' }, take: 8, include: { item: { include: { product: true, brand: true } } } }),
    ]);
    const lowStock = lowStockItems.filter((item) => item.quantity <= (item.minStock ?? 0));
    return { ok: true, data: { products, inventoryItems, lowStock: lowStock.length, lowStockItems: lowStock, recentTransactions } };
  }
}
