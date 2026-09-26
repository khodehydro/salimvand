import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { calculateCustomerDebt } from '../customers/customers.service';
import * as ExcelJS from 'exceljs';

function parseReportDate(
  value: string | undefined,
  field: string,
  endOfDay = false,
): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} تاریخ معتبر نیست`);
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setUTCHours(23, 59, 59, 999);
  return date;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async sales(from?: string, to?: string) {
    const fromDate = parseReportDate(from, 'از');
    const toDate = parseReportDate(to, 'تا', true);
    if (fromDate && toDate && fromDate > toDate)
      throw new BadRequestException('بازهٔ تاریخ گزارش نامعتبر است');
    const where = {
      status: 'issued' as const,
      ...(fromDate || toDate
        ? {
            issuedAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
    };
    const invoices = (await this.prisma.invoice.findMany({
      where,
      orderBy: { issuedAt: 'asc' },
      select: {
        id: true,
        number: true,
        issuedAt: true,
        total: true,
        paidAmount: true,
        paymentStatus: true,
        items: { select: { productName: true, quantity: true, lineTotal: true } },
        returns: { select: { refundAmount: true } },
      },
    })) as Array<{
      id: string;
      number: string;
      issuedAt: Date;
      total: bigint;
      paidAmount: bigint;
      paymentStatus: string;
      items: Array<{ productName: string; quantity: number; lineTotal: bigint }>;
      returns: Array<{ refundAmount: bigint }>;
    }>;
    const products = new Map<string, { name: string; quantity: number; revenue: bigint }>();
    for (const invoice of invoices)
      for (const item of invoice.items) {
        const current = products.get(item.productName) ?? {
          name: item.productName,
          quantity: 0,
          revenue: 0n,
        };
        current.quantity += item.quantity;
        current.revenue += item.lineTotal;
        products.set(item.productName, current);
      }
    return {
      ok: true,
      data: {
        summary: {
          invoiceCount: invoices.length,
          revenue: invoices.reduce((sum, row) => sum + row.total, 0n),
          paid: invoices.reduce((sum, row) => sum + row.paidAmount, 0n),
          outstanding: calculateCustomerDebt(invoices),
        },
        products: [...products.values()],
        invoices,
      },
    };
  }

  async exportInventory() {
    const items = await this.prisma.inventoryItem.findMany({
      where: { isActive: true },
      select: {
        barcode: true,
        quantity: true,
        minStock: true,
        salePrice: true,
        product: { select: { name: true, code: true } },
        brand: { select: { name: true } },
        location: { select: { code: true, name: true } },
        basket: { select: { code: true, name: true } },
      },
      orderBy: { quantity: 'asc' },
    });
    const cell = (value: string | number | bigint | null) => {
      const text = String(value ?? '');
      return /^[=+\-@]/.test(text) ? `'${text}` : `"${text.replaceAll('"', '""')}"`;
    };
    return [
      'محصول,کد,برند,بارکد,موجودی,حداقل,قیمت فروش,قفسه,سبد',
      ...items.map((item: {
        product: { name: string; code: string | null };
        brand?: { name: string } | null;
        barcode: string;
        quantity: number;
        minStock: number | null;
        salePrice: bigint;
        location: { code: string; name: string } | null;
        basket?: { code: string; name: string } | null;
      }) =>
        [
          item.product.name,
          item.product.code,
          item.brand?.name ?? 'بدون برند',
          item.barcode,
          item.quantity,
          item.minStock ?? '',
          item.salePrice,
          item.location ? `${item.location.code} ${item.location.name}` : '',
          item.basket ? `${item.basket.code} ${item.basket.name}` : '',
        ]
          .map(cell)
          .join(','),
      ),
    ].join('\n');
  }

  async exportInventoryAccounting(): Promise<Buffer> {
    const items = await this.prisma.inventoryItem.findMany({
      where: { isActive: true },
      select: {
        barcode: true,
        quantity: true,
        minStock: true,
        purchasePrice: true,
        salePrice: true,
        product: { select: { name: true, code: true } },
        location: { select: { code: true, name: true, parent: { select: { name: true } } } },
        basket: { select: { code: true, name: true } },
      },
      orderBy: [{ product: { name: 'asc' } }, { barcode: 'asc' }],
    });
    const headers = [
      'نام کالا', 'کد کالا', 'بارکد کالا', 'واحد اصلی', 'واحد فرعی',
      'ضریب واحد فرعی اگر واحد فرعی ندارد، خالی قرار دهید', 'قیمت خرید',
      'قیمت خرید واحد فرعی اگر واحد فرعی ندارد، خالی قرار دهید', 'قیمت فروش',
      'قیمت فروش دوم', 'قیمت فروش واحد فرعی اگر واحد فرعی ندارد، خالی قرار دهید',
      'قیمت فروش دوم واحد فرعی اگر واحد فرعی ندارد، خالی قرار دهید', 'موجودی واحد اصلی',
      'موجودی واحد فرعی اگر واحد فرعی ندارد، خالی قرار دهید', 'تاریخ انقضا', 'اطلاعات بیشتر',
      'شرح در فاکتور', 'درصد مالیات بر ارزش افزوده', 'حداقل موجودی', 'حداقل روز برای هشدار تاریخ انقضا',
    ];
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'سلیم وند';
    const sheet = workbook.addWorksheet('محصولات');
    sheet.views = [{ rightToLeft: true }];
    sheet.addRow(headers);
    for (const item of items as Array<{
      barcode: string;
      quantity: number;
      minStock: number | null;
      purchasePrice: bigint | null;
      salePrice: bigint;
      product: { name: string; code: string | null };
      location: { code: string; name: string; parent: { name: string } | null } | null;
      basket?: { code: string; name: string } | null;
    }>) {
      // «انبار / قفسه / کد» plus the basket, so an exported sheet still says
      // exactly where to walk to.
      const location = [
        item.location?.parent?.name,
        item.location?.name,
        item.location?.code,
        item.basket ? item.basket.name : '',
      ]
        .filter(Boolean)
        .join(' / ');
      sheet.addRow([
        item.product.name, item.product.code ?? '', item.barcode, 'عدد', '', '',
        item.purchasePrice?.toString() ?? '', '', item.salePrice.toString(), '', '', '',
        item.quantity, '', '', location, '', '', item.minStock ?? '', '',
      ]);
    }
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: 'middle', wrapText: true };
    header.height = 42;
    sheet.columns.forEach((column: { width?: number }) => { column.width = 18; });
    sheet.getColumn(1).width = 32;
    sheet.getColumn(6).width = 36;
    sheet.getColumn(8).width = 36;
    sheet.getColumn(11).width = 36;
    sheet.getColumn(12).width = 42;
    sheet.getColumn(16).width = 30;
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async supplierChecks(status?: string) {
    const rows = await this.prisma.supplierCheck.findMany({ where: status && ['pending', 'cleared', 'bounced', 'cancelled'].includes(status) ? { status: status as never } : undefined, orderBy: { dueDate: 'asc' }, include: { payment: { include: { invoice: { select: { number: true, supplierName: true } } } } } });
    return { ok: true, data: rows.map((row) => ({ id: row.id, checkNumber: row.checkNumber, bank: row.bank, amount: row.amount.toString(), dueDate: row.dueDate, status: row.status, invoice: row.payment.invoice })) };
  }

  async returns(from?: string, to?: string) {
    const start = parseReportDate(from, 'از تاریخ');
    const end = parseReportDate(to, 'تا تاریخ', true);
    const rows = await this.prisma.returnRecord.findMany({
      where: { ...(start || end ? { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { invoice: { select: { number: true, customerName: true } }, invoiceItem: { select: { productName: true } } },
    });
    const products = new Map<string, { name: string; quantity: number; amount: bigint }>();
    const customers = new Map<string, { name: string; count: number; amount: bigint }>();
    for (const row of rows) { const current = products.get(row.invoiceItem.productName) ?? { name: row.invoiceItem.productName, quantity: 0, amount: 0n }; current.quantity += row.quantity; current.amount += row.refundAmount; products.set(row.invoiceItem.productName, current); const customerKey = row.invoice.customerName ?? 'حضوری'; const customer = customers.get(customerKey) ?? { name: customerKey, count: 0, amount: 0n }; customer.count += row.quantity; customer.amount += row.refundAmount; customers.set(customerKey, customer); }
    return { ok: true, data: { rows: rows.map((row) => ({ id: row.id, invoice: row.invoice, product: row.invoiceItem.productName, quantity: row.quantity, refundAmount: row.refundAmount.toString(), reason: row.reason, restock: row.restock, createdAt: row.createdAt })), products: [...products.values()].map((row) => ({ ...row, amount: row.amount.toString() })), customers: [...customers.values()].sort((a, b) => b.amount > a.amount ? 1 : -1).map((row) => ({ ...row, amount: row.amount.toString() })) } };
  }

  async checks(from?: string, to?: string, status?: string, bank?: string) {
    const start = parseReportDate(from, 'از تاریخ');
    const end = parseReportDate(to, 'تا تاریخ', true);
    const rows = await this.prisma.paymentCheck.findMany({
      where: { ...(start || end ? { dueDate: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}), ...(status && ['pending', 'cleared', 'bounced', 'cancelled'].includes(status) ? { status: status as never } : {}), ...(bank ? { bank: { contains: bank, mode: 'insensitive' } } : {}) },
      orderBy: { dueDate: 'asc' },
      include: { payment: { include: { invoice: { select: { number: true, customerName: true } } } } },
    });
    return { ok: true, data: rows.map((row) => ({ id: row.id, checkNumber: row.checkNumber, bank: row.bank, branch: row.branch, amount: row.amount.toString(), dueDate: row.dueDate, status: row.status, clearedAt: row.clearedAt, bouncedAt: row.bouncedAt, invoice: row.payment.invoice })) };
  }

  async inventory() {
    const [items, transactions] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: { isActive: true },
        include: {
          product: { select: { name: true, code: true } },
          brand: { select: { name: true } },
          location: true,
        },
        orderBy: { quantity: 'asc' },
      }),
      this.prisma.inventoryTransaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: { item: { include: { product: true, brand: true } } },
      }),
    ]);
    return { ok: true, data: { items, transactions } };
  }

  async exportSales(from?: string, to?: string) {
    const fromDate = parseReportDate(from, 'از');
    const toDate = parseReportDate(to, 'تا', true);
    if (fromDate && toDate && fromDate > toDate)
      throw new BadRequestException('بازهٔ تاریخ گزارش نامعتبر است');
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
      orderBy: { issuedAt: 'desc' },
      select: {
        number: true,
        customerName: true,
        customerMobile: true,
        total: true,
        paidAmount: true,
        paymentStatus: true,
        issuedAt: true,
      },
    });
    const cell = (value: string | number | bigint | null) => {
      const text = String(value ?? '');
      return /^[=+\-@]/.test(text) ? `'${text}` : `"${text.replaceAll('"', '""')}"`;
    };
    return [
      'شماره فاکتور,نام مشتری,موبایل,مبلغ,پرداخت‌شده,وضعیت,تاریخ',
      ...invoices.map((row) =>
        [
          row.number,
          row.customerName,
          row.customerMobile,
          row.total,
          row.paidAmount,
          row.paymentStatus,
          row.issuedAt.toISOString(),
        ]
          .map(cell)
          .join(','),
      ),
    ].join('\n');
  }

  async purchaseDebts() {
    const rows = await this.prisma.purchaseInvoice.groupBy({
      by: ['supplierId', 'supplierName'],
      where: { status: 'issued' },
      _sum: { total: true, paidAmount: true },
      _count: { id: true },
      orderBy: { supplierName: 'asc' },
    });
    const suppliers = rows.map((row) => ({
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      invoiceCount: row._count.id,
      total: row._sum.total ?? 0n,
      paidAmount: row._sum.paidAmount ?? 0n,
      debt: (row._sum.total ?? 0n) - (row._sum.paidAmount ?? 0n),
    }));
    return {
      ok: true,
      data: { suppliers, totalDebt: suppliers.reduce((sum, row) => sum + row.debt, 0n) },
    };
  }

  async exportPurchaseDebts() {
    const report = await this.purchaseDebts();
    const cell = (value: string | number | bigint | null) => {
      const text = String(value ?? '');
      return /^[=+\-@]/.test(text) ? `'${text}` : `"${text.replaceAll('"', '""')}"`;
    };
    return [
      'تأمین‌کننده,تعداد فاکتور,مجموع خرید,پرداخت‌شده,بدهی',
      ...report.data.suppliers.map((row) =>
        [row.supplierName, row.invoiceCount, row.total, row.paidAmount, row.debt]
          .map(cell)
          .join(','),
      ),
    ].join('\n');
  }

  async customers() {
    const rows = await this.prisma.customer.findMany({
      where: { isActive: true },
      include: {
        invoices: {
          where: { status: 'issued' },
          select: { total: true, paidAmount: true, returns: { select: { refundAmount: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const data = rows.map((customer) => ({
      id: customer.id,
      name: customer.name,
      mobile: customer.mobile,
      invoiceCount: customer.invoices.length,
      purchased: customer.invoices.reduce((sum, invoice) => sum + invoice.total, 0n),
      debt: calculateCustomerDebt(customer.invoices),
    }));
    return {
      ok: true,
      data: {
        customers: data,
        debtors: data
          .filter((customer) => customer.debt > 0n)
          .sort((a, b) => (a.debt > b.debt ? -1 : 1)),
      },
    };
  }

  async profit(from?: string, to?: string) {
    const fromDate = parseReportDate(from, 'از');
    const toDate = parseReportDate(to, 'تا', true);
    if (fromDate && toDate && fromDate > toDate)
      throw new BadRequestException('بازهٔ تاریخ گزارش نامعتبر است');
    const where = {
      status: 'issued' as const,
      ...(fromDate || toDate
        ? {
            issuedAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
    };
    const invoices = await this.prisma.invoice.findMany({
      where,
      select: {
        items: {
          select: {
            productName: true,
            quantity: true,
            unitPrice: true,
            inventoryItem: { select: { purchasePrice: true, brand: { select: { name: true } } } },
          },
        },
      },
    });
    const byBrand = new Map<
      string,
      { brand: string; quantity: number; revenue: bigint; cost: bigint; profit: bigint }
    >();
    for (const invoice of invoices)
      for (const item of invoice.items) {
        const brand = item.inventoryItem.brand?.name ?? 'بدون برند';
        const row = byBrand.get(brand) ?? { brand, quantity: 0, revenue: 0n, cost: 0n, profit: 0n };
        const quantity = BigInt(item.quantity);
        row.quantity += item.quantity;
        row.revenue += item.unitPrice * quantity;
        row.cost += item.inventoryItem.purchasePrice * quantity;
        row.profit += (item.unitPrice - item.inventoryItem.purchasePrice) * quantity;
        byBrand.set(brand, row);
      }
    const rows = [...byBrand.values()];
    return {
      ok: true,
      data: {
        summary: {
          revenue: rows.reduce((sum, row) => sum + row.revenue, 0n),
          cost: rows.reduce((sum, row) => sum + row.cost, 0n),
          profit: rows.reduce((sum, row) => sum + row.profit, 0n),
        },
        brands: rows,
      },
    };
  }
}
