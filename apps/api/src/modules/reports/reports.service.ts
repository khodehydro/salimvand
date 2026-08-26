import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

function parseReportDate(value: string | undefined, field: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} تاریخ معتبر نیست`);
  return date;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async sales(from?: string, to?: string) {
    const fromDate = parseReportDate(from, 'از'); const toDate = parseReportDate(to, 'تا');
    const where = { status: 'issued' as const, ...(fromDate || toDate ? { issuedAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}) };
    const invoices = await this.prisma.invoice.findMany({ where, orderBy: { issuedAt: 'asc' }, select: { id: true, number: true, issuedAt: true, total: true, paidAmount: true, paymentStatus: true, items: { select: { productName: true, quantity: true, lineTotal: true } } } }) as Array<{ id: string; number: string; issuedAt: Date; total: bigint; paidAmount: bigint; paymentStatus: string; items: Array<{ productName: string; quantity: number; lineTotal: bigint }> }>;
    const products = new Map<string, { name: string; quantity: number; revenue: bigint }>();
    for (const invoice of invoices) for (const item of invoice.items) { const current = products.get(item.productName) ?? { name: item.productName, quantity: 0, revenue: 0n }; current.quantity += item.quantity; current.revenue += item.lineTotal; products.set(item.productName, current); }
    return { ok: true, data: { summary: { invoiceCount: invoices.length, revenue: invoices.reduce((sum, row) => sum + row.total, 0n), paid: invoices.reduce((sum, row) => sum + row.paidAmount, 0n), outstanding: invoices.reduce((sum, row) => sum + row.total - row.paidAmount, 0n) }, products: [...products.values()], invoices } };
  }

  async exportInventory() {
    const items = await this.prisma.inventoryItem.findMany({ where: { isActive: true }, select: { barcode: true, quantity: true, minStock: true, salePrice: true, product: { select: { name: true, code: true } }, brand: { select: { name: true } }, location: { select: { code: true, name: true } } }, orderBy: { quantity: 'asc' } });
    const cell = (value: string | number | bigint | null) => { const text = String(value ?? ''); return /^[=+\-@]/.test(text) ? `'${text}` : `"${text.replaceAll('"', '""')}"`; };
    return ['محصول,کد,برند,بارکد,موجودی,حداقل,قیمت فروش,قفسه', ...items.map((item) => [item.product.name, item.product.code, item.brand.name, item.barcode, item.quantity, item.minStock ?? '', item.salePrice, item.location ? `${item.location.code} ${item.location.name}` : ''].map(cell).join(','))].join('\n');
  }

  async inventory() {
    const [items, transactions] = await Promise.all([this.prisma.inventoryItem.findMany({ where: { isActive: true }, include: { product: { select: { name: true, code: true } }, brand: { select: { name: true } }, location: true }, orderBy: { quantity: 'asc' } }), this.prisma.inventoryTransaction.findMany({ orderBy: { createdAt: 'desc' }, take: 500, include: { item: { include: { product: true, brand: true } } } })]);
    return { ok: true, data: { items, transactions } };
  }

  async exportSales() {
    const invoices = await this.prisma.invoice.findMany({ where: { status: 'issued' }, orderBy: { issuedAt: 'desc' }, select: { number: true, customerName: true, customerMobile: true, total: true, paidAmount: true, paymentStatus: true, issuedAt: true } });
    const cell = (value: string | number | bigint | null) => { const text = String(value ?? ''); return /^[=+\-@]/.test(text) ? `'${text}` : `"${text.replaceAll('"', '""')}"`; };
    return ['شماره فاکتور,نام مشتری,موبایل,مبلغ,پرداخت‌شده,وضعیت,تاریخ', ...invoices.map((row) => [row.number, row.customerName, row.customerMobile, row.total, row.paidAmount, row.paymentStatus, row.issuedAt.toISOString()].map(cell).join(','))].join('\n');
  }

  async customers() {
    const rows = await this.prisma.customer.findMany({ where: { isActive: true }, include: { invoices: { where: { status: 'issued' }, select: { total: true, paidAmount: true } } }, orderBy: { createdAt: 'desc' }, take: 500 });
    const data = rows.map((customer) => ({ id: customer.id, name: customer.name, mobile: customer.mobile, invoiceCount: customer.invoices.length, purchased: customer.invoices.reduce((sum, invoice) => sum + invoice.total, 0n), debt: customer.invoices.reduce((sum, invoice) => sum + invoice.total - invoice.paidAmount, 0n) }));
    return { ok: true, data: { customers: data, debtors: data.filter((customer) => customer.debt > 0n).sort((a, b) => (a.debt > b.debt ? -1 : 1)) } };
  }

  async profit(from?: string, to?: string) {
    const fromDate = parseReportDate(from, 'از'); const toDate = parseReportDate(to, 'تا');
    const where = { status: 'issued' as const, ...(fromDate || toDate ? { issuedAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}) };
    const invoices = await this.prisma.invoice.findMany({ where, select: { items: { select: { productName: true, quantity: true, unitPrice: true, inventoryItem: { select: { purchasePrice: true, brand: { select: { name: true } } } } } } } });
    const byBrand = new Map<string, { brand: string; quantity: number; revenue: bigint; cost: bigint; profit: bigint }>();
    for (const invoice of invoices) for (const item of invoice.items) { const brand = item.inventoryItem.brand.name; const row = byBrand.get(brand) ?? { brand, quantity: 0, revenue: 0n, cost: 0n, profit: 0n }; const quantity = BigInt(item.quantity); row.quantity += item.quantity; row.revenue += item.unitPrice * quantity; row.cost += item.inventoryItem.purchasePrice * quantity; row.profit += (item.unitPrice - item.inventoryItem.purchasePrice) * quantity; byBrand.set(brand, row); }
    const rows = [...byBrand.values()];
    return { ok: true, data: { summary: { revenue: rows.reduce((sum, row) => sum + row.revenue, 0n), cost: rows.reduce((sum, row) => sum + row.cost, 0n), profit: rows.reduce((sum, row) => sum + row.profit, 0n) }, brands: rows } };
  }
}
