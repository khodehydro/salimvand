import { BadRequestException, Injectable } from '@nestjs/common';
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

  async salesTrend(from?: string, to?: string) {
    const fromDate = from ? new Date(from) : undefined; const toDate = to ? new Date(to) : undefined;
    if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime())) || (fromDate && toDate && fromDate > toDate)) throw new BadRequestException('بازهٔ تاریخ نمودار نامعتبر است');
    if (toDate && /^\\d{4}-\\d{2}-\\d{2}$/.test(to ?? '')) toDate.setUTCHours(23, 59, 59, 999);
    const invoices = await this.prisma.invoice.findMany({ where: { status: 'issued', ...(fromDate || toDate ? { issuedAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}) }, orderBy: { issuedAt: 'asc' }, select: { issuedAt: true, total: true, paidAmount: true } });
    const days = new Map<string, { date: string; revenue: bigint; paid: bigint; invoiceCount: number }>();
    for (const invoice of invoices) { const date = invoice.issuedAt.toISOString().slice(0, 10); const row = days.get(date) ?? { date, revenue: 0n, paid: 0n, invoiceCount: 0 }; row.revenue += invoice.total; row.paid += invoice.paidAmount; row.invoiceCount += 1; days.set(date, row); }
    return { ok: true, data: [...days.values()].map((row) => ({ ...row, revenue: row.revenue.toString(), paid: row.paid.toString() })) };
  }

  async inventoryTrend(from?: string, to?: string) {
    const fromDate = from ? new Date(from) : undefined; const toDate = to ? new Date(to) : undefined;
    if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime())) || (fromDate && toDate && fromDate > toDate)) throw new BadRequestException('بازهٔ تاریخ نمودار نامعتبر است');
    if (toDate && /^\\d{4}-\\d{2}-\\d{2}$/.test(to ?? '')) toDate.setUTCHours(23, 59, 59, 999);
    const rows = await this.prisma.inventoryTransaction.findMany({ where: { ...(fromDate || toDate ? { createdAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}) }, orderBy: { createdAt: 'asc' }, select: { createdAt: true, quantityChange: true, type: true } });
    const days = new Map<string, { date: string; inbound: number; outbound: number; returns: number }>();
    for (const row of rows) { const date = row.createdAt.toISOString().slice(0, 10); const day = days.get(date) ?? { date, inbound: 0, outbound: 0, returns: 0 }; if (row.type === 'return') day.returns += Math.abs(row.quantityChange); else if (row.quantityChange >= 0) day.inbound += row.quantityChange; else day.outbound += Math.abs(row.quantityChange); days.set(date, day); }
    return { ok: true, data: [...days.values()] };
  }

  async profitTrend(from?: string, to?: string) {
    const fromDate = from ? new Date(from) : undefined; const toDate = to ? new Date(to) : undefined;
    if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime())) || (fromDate && toDate && fromDate > toDate)) throw new BadRequestException('بازهٔ تاریخ نمودار نامعتبر است');
    if (toDate && /^\\d{4}-\\d{2}-\\d{2}$/.test(to ?? '')) toDate.setUTCHours(23, 59, 59, 999);
    const invoices = await this.prisma.invoice.findMany({ where: { status: 'issued', ...(fromDate || toDate ? { issuedAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}) }, orderBy: { issuedAt: 'asc' }, select: { issuedAt: true, items: { select: { quantity: true, unitPrice: true, inventoryItem: { select: { purchasePrice: true } } } } } });
    const days = new Map<string, { date: string; revenue: bigint; cost: bigint; profit: bigint }>();
    for (const invoice of invoices) { const date = invoice.issuedAt.toISOString().slice(0, 10); const day = days.get(date) ?? { date, revenue: 0n, cost: 0n, profit: 0n }; for (const item of invoice.items) { const quantity = BigInt(item.quantity); day.revenue += item.unitPrice * quantity; day.cost += item.inventoryItem.purchasePrice * quantity; } day.profit = day.revenue - day.cost; days.set(date, day); }
    return { ok: true, data: [...days.values()].map((row) => ({ ...row, revenue: row.revenue.toString(), cost: row.cost.toString(), profit: row.profit.toString() })) };
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
