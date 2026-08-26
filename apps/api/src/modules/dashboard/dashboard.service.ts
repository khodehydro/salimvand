import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}
  async summary() {
    const [products, inventoryItems, lowStock, recentTransactions] = await Promise.all([
      this.prisma.product.count({ where: { deletedAt: null, status: 'active' } }),
      this.prisma.inventoryItem.count({ where: { isActive: true } }),
      this.prisma.inventoryItem.count({ where: { isActive: true, quantity: { lte: 0 } } }),
      this.prisma.inventoryTransaction.findMany({ orderBy: { createdAt: 'desc' }, take: 8, include: { item: { include: { product: true, brand: true } } } }),
    ]);
    return { ok: true, data: { products, inventoryItems, lowStock, recentTransactions } };
  }
}
