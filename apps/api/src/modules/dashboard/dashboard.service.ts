import { BadRequestException, Injectable } from '@nestjs/common';
import { freemem, totalmem } from 'node:os';
import { statfs } from 'node:fs/promises';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class DashboardService {
  /**
   * Server resources for the dashboard health card: RAM (used vs total) and
   * disk usage of the deployment volume. Both are JSON-safe byte counters.
   */
  async systemStats() {
    const total = totalmem();
    const free = freemem();
    let disk: { total: number; used: number; free: number } | null = null;
    try {
      const stats = await statfs(process.env.DISK_ROOT ?? '/');
      const blockSize = Number(stats.bsize) || 4096;
      const totalBytes = Number(stats.blocks) * blockSize;
      const freeBytes = Number(stats.bavail) * blockSize;
      disk = { total: totalBytes, used: totalBytes - freeBytes, free: freeBytes };
    } catch {
      disk = null; // non-POSIX or restricted environments
    }
    return {
      ok: true,
      data: {
        memory: { total, used: total - free, free },
        disk,
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
      },
    };
  }

  constructor(private readonly prisma: PrismaService) {}
  async audit(page = 1, pageSize = 50, entityType?: string) {
    const safePage = Math.max(1, page);
    const safeSize = Math.min(100, Math.max(1, pageSize));
    const where = entityType ? { entityType } : {};
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
        include: { user: { select: { name: true, username: true, role: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      ok: true,
      data: rows,
      meta: { page: safePage, pageSize: safeSize, total, totalPages: Math.ceil(total / safeSize) },
    };
  }

  async salesTrend(from?: string, to?: string) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if (
      (fromDate && Number.isNaN(fromDate.getTime())) ||
      (toDate && Number.isNaN(toDate.getTime())) ||
      (fromDate && toDate && fromDate > toDate)
    )
      throw new BadRequestException('بازهٔ تاریخ نمودار نامعتبر است');
    if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(to ?? '')) toDate.setUTCHours(23, 59, 59, 999);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: 'issued',
        ...(fromDate || toDate
          ? {
              issuedAt: {
                ...(fromDate ? { gte: fromDate } : {}),
                ...(toDate ? { lte: toDate } : {}),
              },
            }
          : {}),
      },
      orderBy: { issuedAt: 'asc' },
      select: { issuedAt: true, total: true, paidAmount: true },
    });
    const days = new Map<
      string,
      { date: string; revenue: bigint; paid: bigint; invoiceCount: number }
    >();
    for (const invoice of invoices) {
      const date = invoice.issuedAt.toISOString().slice(0, 10);
      const row = days.get(date) ?? { date, revenue: 0n, paid: 0n, invoiceCount: 0 };
      row.revenue += invoice.total;
      row.paid += invoice.paidAmount;
      row.invoiceCount += 1;
      days.set(date, row);
    }
    return {
      ok: true,
      data: [...days.values()].map((row) => ({
        ...row,
        revenue: row.revenue.toString(),
        paid: row.paid.toString(),
      })),
    };
  }

  async inventoryTrend(from?: string, to?: string) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if (
      (fromDate && Number.isNaN(fromDate.getTime())) ||
      (toDate && Number.isNaN(toDate.getTime())) ||
      (fromDate && toDate && fromDate > toDate)
    )
      throw new BadRequestException('بازهٔ تاریخ نمودار نامعتبر است');
    if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(to ?? '')) toDate.setUTCHours(23, 59, 59, 999);
    const rows = await this.prisma.inventoryTransaction.findMany({
      where: {
        ...(fromDate || toDate
          ? {
              createdAt: {
                ...(fromDate ? { gte: fromDate } : {}),
                ...(toDate ? { lte: toDate } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, quantityChange: true, type: true },
    });
    const days = new Map<
      string,
      { date: string; inbound: number; outbound: number; returns: number }
    >();
    for (const row of rows) {
      const date = row.createdAt.toISOString().slice(0, 10);
      const day = days.get(date) ?? { date, inbound: 0, outbound: 0, returns: 0 };
      if (row.type === 'return') day.returns += Math.abs(row.quantityChange);
      else if (row.quantityChange >= 0) day.inbound += row.quantityChange;
      else day.outbound += Math.abs(row.quantityChange);
      days.set(date, day);
    }
    return { ok: true, data: [...days.values()] };
  }

  async profitTrend(from?: string, to?: string) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if (
      (fromDate && Number.isNaN(fromDate.getTime())) ||
      (toDate && Number.isNaN(toDate.getTime())) ||
      (fromDate && toDate && fromDate > toDate)
    )
      throw new BadRequestException('بازهٔ تاریخ نمودار نامعتبر است');
    if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(to ?? '')) toDate.setUTCHours(23, 59, 59, 999);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: 'issued',
        ...(fromDate || toDate
          ? {
              issuedAt: {
                ...(fromDate ? { gte: fromDate } : {}),
                ...(toDate ? { lte: toDate } : {}),
              },
            }
          : {}),
      },
      orderBy: { issuedAt: 'asc' },
      select: {
        issuedAt: true,
        items: {
          select: {
            quantity: true,
            unitPrice: true,
            inventoryItem: { select: { purchasePrice: true } },
          },
        },
      },
    });
    const days = new Map<string, { date: string; revenue: bigint; cost: bigint; profit: bigint }>();
    for (const invoice of invoices) {
      const date = invoice.issuedAt.toISOString().slice(0, 10);
      const day = days.get(date) ?? { date, revenue: 0n, cost: 0n, profit: 0n };
      for (const item of invoice.items) {
        const quantity = BigInt(item.quantity);
        day.revenue += item.unitPrice * quantity;
        day.cost += item.inventoryItem.purchasePrice * quantity;
      }
      day.profit = day.revenue - day.cost;
      days.set(date, day);
    }
    return {
      ok: true,
      data: [...days.values()].map((row) => ({
        ...row,
        revenue: row.revenue.toString(),
        cost: row.cost.toString(),
        profit: row.profit.toString(),
      })),
    };
  }

  async summary() {
    const [
      products,
      inventoryItems,
      lowStockItems,
      stockComposition,
      categoryComposition,
      recentTransactions,
      unpaidInvoices,
      productsWithoutImages,
      productsWithoutPartNumber,
      productsWithoutVehicles,
      productsWithoutBrand,
      inventoryWithoutLocation,
      productsWithoutSalePrice,
      pendingPurchases,
    ] = await Promise.all([
      this.prisma.product.count({ where: { deletedAt: null, status: 'active' } }),
      this.prisma.inventoryItem.count({ where: { isActive: true } }),
      this.prisma.inventoryItem.findMany({
        where: { isActive: true },
        orderBy: { quantity: 'asc' },
        take: 20,
        select: {
          id: true,
          quantity: true,
          minStock: true,
          product: { select: { name: true, code: true } },
          brand: { select: { name: true } },
          location: { select: { code: true, name: true, parent: { select: { name: true } } } },
        },
      }),
      this.prisma.inventoryItem.findMany({
        where: { isActive: true, quantity: { gt: 0 } },
        select: { quantity: true, brand: { select: { name: true } } },
      }),
      // Dashboard donut is grouped by product category (per the design doc).
      this.prisma.inventoryItem.findMany({
        where: { isActive: true, quantity: { gt: 0 } },
        select: {
          quantity: true,
          product: { select: { category: { select: { name: true } } } },
        },
      }),
      this.prisma.inventoryTransaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { item: { include: { product: true, brand: true } } },
      }),
      this.prisma.invoice.count({ where: { status: 'issued', paymentStatus: { in: ['unpaid', 'partial'] } } }),
      this.prisma.product.count({ where: { deletedAt: null, status: 'active', images: { none: {} } } }),
      this.prisma.product.count({ where: { deletedAt: null, status: 'active', OR: [{ partNumber: null }, { partNumber: '' }] } }),
      this.prisma.product.count({ where: { deletedAt: null, status: 'active', compatibilities: { none: {} } } }),
      this.prisma.product.count({ where: { deletedAt: null, status: 'active', inventoryItems: { none: { isActive: true } } } }),
      this.prisma.inventoryItem.count({ where: { isActive: true, locationId: null } }),
      this.prisma.inventoryItem.count({ where: { isActive: true, salePrice: 0 } }),
      this.prisma.purchaseInvoice.count({ where: { status: 'issued' } }),
    ]);
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday); startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const [todayInvoices, todayPayments] = await Promise.all([
      this.prisma.invoice.findMany({ where: { status: 'issued', issuedAt: { gte: startOfToday, lt: startOfTomorrow } }, select: { total: true } }),
      this.prisma.payment.findMany({ where: { receivedAt: { gte: startOfToday, lt: startOfTomorrow } }, select: { amount: true } }),
    ]);
    const todaySales = todayInvoices.reduce((sum, row) => sum + row.total, 0n);
    const todayReceived = todayPayments.reduce((sum, row) => sum + row.amount, 0n);
    const dayAfterTomorrow = new Date(startOfToday); dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 3);
    const dueChecks = await this.prisma.paymentCheck.findMany({
      where: { dueDate: { gte: new Date(new Date(startOfToday).setDate(startOfToday.getDate() + 1)), lt: dayAfterTomorrow } },
      orderBy: { dueDate: 'asc' },
      include: { payment: { include: { invoice: { select: { id: true, number: true, customerName: true } } } } },
    });
    const lowStock = lowStockItems.filter(
      (item: { quantity: number; minStock: number | null }) => item.quantity <= (item.minStock ?? 0),
    );
    return {
      ok: true,
      data: {
        products,
        inventoryItems,
        lowStock: lowStock.length,
        lowStockItems: lowStock,
        stockComposition,
        categoryComposition,
        recentTransactions,
        unpaidInvoices,
        productsWithoutImages,
        productsWithoutPartNumber,
        productsWithoutVehicles,
        productsWithoutBrand,
        inventoryWithoutLocation,
        productsWithoutSalePrice,
        pendingPurchases,
        todaySales: todaySales.toString(),
        todayReceived: todayReceived.toString(),
        todayInvoiceCount: todayInvoices.length,
        dueChecks: dueChecks.map((check) => ({ id: check.id, checkNumber: check.checkNumber, bank: check.bank, amount: check.amount.toString(), dueDate: check.dueDate, invoice: check.payment.invoice })),
      },
    };
  }
}
