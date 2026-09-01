import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  NotificationsService,
  buildInvoiceMessage,
  integrationConfigured,
} from '../notifications/notifications.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { writeAudit } from '../../common/audit/audit-log';
import { calculateInvoiceTotals, InvoiceLineInput } from './invoice.rules';
import * as QRCode from 'qrcode';
import PDFDocument = require('pdfkit');
import { existsSync } from 'node:fs';
import { createPublicShortCode, createPublicToken, hashPublicToken } from './public-token';

type DraftLine = InvoiceLineInput & { inventoryItemId: string; productName: string };
type CreateInput = {
  customerName?: string;
  customerMobile?: string;
  storeAddress?: string;
  customerAddress?: string;
  discount?: string | number;
  items?: Array<{ inventoryItemId?: string; quantity?: number; unitPrice?: string | number }>;
};

/** Net amounts after partial returns: the original totals stay untouched as
 * the paper trail — everything the customer owes is computed against the
 * returnedTotal (sum of every ReturnRecord refundAmount for the invoice). */
export function netInvoiceTotals(
  total: bigint,
  returns: Array<{ refundAmount: bigint }>,
): { returnedTotal: bigint; netTotal: bigint } {
  const returnedTotal = returns.reduce((sum, record) => sum + record.refundAmount, 0n);
  return { returnedTotal, netTotal: total - returnedTotal };
}

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  buildDraft(number: string, lines: readonly DraftLine[], discount = 0n) {
    if (!/^INV-[0-9]{4,}$/.test(number)) throw new Error('شماره فاکتور معتبر نیست');
    if (lines.length === 0) throw new Error('فاکتور باید حداقل یک ردیف داشته باشد');
    if (lines.length > 100) throw new Error('تعداد ردیف‌های فاکتور بیش از حد مجاز است');
    if (new Set(lines.map((line) => line.inventoryItemId)).size !== lines.length)
      throw new Error('قلم موجودی نمی‌تواند در چند ردیف تکرار شود');
    if (lines.some((line) => !line.productName.trim())) throw new Error('نام محصول الزامی است');
    const totals = calculateInvoiceTotals(lines, discount);
    const publicToken = createPublicToken();
    return {
      ...totals,
      number,
      publicToken: publicToken.token,
      publicTokenHash: publicToken.hash,
      items: lines.map((line) => ({ ...line, lineTotal: BigInt(line.quantity) * line.unitPrice })),
    };
  }

  async create(input: CreateInput, userId: string) {
    if (!userId || !input.items?.length)
      throw new BadRequestException('کاربر و حداقل یک قلم فاکتور الزامی است');
    const ids = input.items.map((item) => item.inventoryItemId ?? '');
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('قلم موجودی نمی‌تواند در چند ردیف تکرار شود');
    const records = (await this.prisma.inventoryItem.findMany({
      where: { id: { in: ids }, isActive: true },
      include: { product: true },
    })) as Array<{ id: string; product: { name: string } }>;
    const byId = new Map(
      records.map((item: { id: string; product: { name: string } }) => [item.id, item]),
    );
    const lines: DraftLine[] = input.items.map((item) => {
      const record = byId.get(item.inventoryItemId ?? '');
      if (!record) throw new NotFoundException('قلم موجودی پیدا نشد');
      const quantity = Number(item.quantity);
      const unitPrice = BigInt(item.unitPrice ?? 0);
      return { inventoryItemId: record.id, productName: record.product.name, quantity, unitPrice };
    });
    const discount = BigInt(input.discount ?? 0);
    const totals = calculateInvoiceTotals(lines, discount);
    const publicToken = createPublicToken();
    const publicShortCode = createPublicShortCode();
    const publicTokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const invoice = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const counter = await tx.counter.upsert({
        where: { key: 'invoice' },
        update: { lastValue: { increment: 1 } },
        create: { key: 'invoice', lastValue: 1 },
      });
      const number = `INV-${String(counter.lastValue).padStart(6, '0')}`;
      for (const line of lines) {
        const updated = await tx.inventoryItem.updateMany({
          where: { id: line.inventoryItemId, quantity: { gte: line.quantity }, isActive: true },
          data: { quantity: { decrement: line.quantity } },
        });
        if (updated.count !== 1)
          throw new ConflictException({
            code: 'INSUFFICIENT_STOCK',
            message: 'موجودی کافی نیست',
            itemId: line.inventoryItemId,
          });
      }
      const customerName = input.customerName?.trim();
      const customerMobile = input.customerMobile?.trim();
      const created = await tx.invoice.create({
        data: {
          number,
          publicTokenHash: publicToken.hash,
          publicShortCodeHash: publicShortCode.hash,
          publicTokenExpiresAt,
          customerName: customerName || undefined,
          customerMobile: customerMobile || undefined,
          storeAddress: input.storeAddress?.trim() || undefined,
          customerAddress: input.customerAddress?.trim() || undefined,
          subtotal: totals.subtotal,
          discount: totals.discount,
          total: totals.total,
          issuedById: userId,
          items: {
            create: lines.map((line) => ({
              inventoryItemId: line.inventoryItemId,
              productName: line.productName,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: BigInt(line.quantity) * line.unitPrice,
            })),
          },
        },
        include: { items: true },
      });
      if (customerName && customerMobile) {
        const customer = await this.queryRaw<{ id: string }>(
          tx,
          'INSERT INTO "customers" ("name", "mobile") VALUES ($1, $2) ON CONFLICT ("mobile") DO UPDATE SET "name" = EXCLUDED."name", "updatedAt" = CURRENT_TIMESTAMP RETURNING "id"',
          customerName,
          customerMobile,
        );
        if (customer[0])
          await this.executeRaw(
            tx,
            'UPDATE "invoices" SET "customerId" = $1 WHERE "id" = $2',
            customer[0].id,
            created.id,
          );
      }
      for (const line of lines)
        await tx.inventoryTransaction.create({
          data: {
            itemId: line.inventoryItemId,
            type: 'sale',
            quantityChange: -line.quantity,
            quantityAfter: 0,
            userId,
            refType: 'invoice',
            refId: created.id,
            reason: `صدور فاکتور ${number}`,
          },
        });
      // Refresh quantityAfter from the transactionally updated rows.
      await writeAudit(tx, {
        userId,
        action: 'issue',
        entityType: 'invoice',
        entityId: created.id,
        after: { number, total: totals.total.toString() },
      });
      for (const line of lines) {
        const item = await tx.inventoryItem.findUniqueOrThrow({
          where: { id: line.inventoryItemId },
          select: { quantity: true },
        });
        await tx.inventoryTransaction.updateMany({
          where: { itemId: line.inventoryItemId, refId: created.id },
          data: { quantityAfter: item.quantity },
        });
      }
      return created;
    });
    if (
      this.notifications &&
      (input.customerMobile || integrationConfigured('telegram') || integrationConfigured('bale'))
    )
      await this.notifications.enqueue({
        type: 'invoice.issued',
        invoiceId: invoice.id,
        mobile: input.customerMobile,
        message: buildInvoiceMessage(
          invoice.number,
          publicShortCode.code,
          totals.total.toString(),
          false,
          await this.smsTemplate('invoice'),
        ),
      });
    return {
      ok: true,
      data: { ...invoice, publicToken: publicToken.token, publicShortCode: publicShortCode.code },
    };
  }

  async getPublic(token: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        OR: [
          { publicTokenHash: hashPublicToken(token) },
          { publicShortCodeHash: hashPublicToken(token) },
        ],
      },
      select: {
        id: true,
        number: true,
        status: true,
        publicTokenExpiresAt: true,
        customerName: true,
        customerMobile: true,
        storeAddress: true,
        customerAddress: true,
        subtotal: true,
        discount: true,
        total: true,
        paymentStatus: true,
        paidAmount: true,
        paymentMethod: true,
        paidAt: true,
        issuedAt: true,
        voidedAt: true,
        items: {
          select: {
            id: true,
            productName: true,
            quantity: true,
            unitPrice: true,
            lineTotal: true,
            inventoryItem: { select: { brand: { select: { name: true } } } },
          },
        },
        returns: {
          select: { invoiceItemId: true, quantity: true, refundAmount: true },
        },
        payments: {
          orderBy: { receivedAt: 'asc' },
          select: { amount: true, method: true, receivedAt: true },
        },
        issuedBy: { select: { name: true } },
      },
    });
    if (
      !invoice ||
      invoice.status === 'voided' ||
      (invoice.publicTokenExpiresAt && invoice.publicTokenExpiresAt.getTime() <= Date.now())
    )
      throw new NotFoundException('فاکتور پیدا نشد');
    // Never spread internal identifiers into the public payload: strip the row id,
    // the link expiry and every token hash explicitly (see public-contract.test.ts).
    const {
      id: _internalId,
      publicTokenExpiresAt: _expiresAt,
      publicTokenHash: _tokenHash,
      publicShortCodeHash: _shortCodeHash,
      returns: _internalReturns,
      ...publicInvoice
    } = invoice as typeof invoice & {
      publicTokenHash?: string;
      publicShortCodeHash?: string;
      returns?: unknown[];
    };
    const payments =
      (
        invoice as unknown as {
          payments?: Array<{ amount: bigint; method: string; receivedAt: Date }>;
        }
      ).payments ?? [];
    const issuedBy = (invoice as unknown as { issuedBy?: { name: string } | null }).issuedBy;
    // Returns lower what the customer owes: expose per-line returned quantity
    // and the net totals, but never the internal line ids, users or restock
    // flags (public payload stays customer-only).
    const { returnedTotal, netTotal } = netInvoiceTotals(
      invoice.total,
      (
        invoice as unknown as {
          returns?: Array<{ refundAmount: bigint }>;
        }
      ).returns ?? [],
    );
    const returnedPerLine = new Map<string, number>();
    for (const record of (
      invoice as unknown as { returns?: Array<{ invoiceItemId: string; quantity: number }> }
    ).returns ?? [])
      returnedPerLine.set(
        record.invoiceItemId,
        (returnedPerLine.get(record.invoiceItemId) ?? 0) + record.quantity,
      );
    return {
      ok: true,
      data: {
        ...publicInvoice,
        returnedTotal,
        netTotal,
        items: invoice.items.map(
          (item: {
            id: string;
            productName: string;
            quantity: number;
            unitPrice: bigint;
            lineTotal: bigint;
            inventoryItem: { brand: { name: string } };
          }) => ({
            productName: item.productName,
            brand: item.inventoryItem.brand.name,
            quantity: item.quantity,
            returnedQuantity: returnedPerLine.get(item.id) ?? 0,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
          }),
        ),
        // The document shows who issued it, how it was paid and when the link dies.
        salesPerson: issuedBy?.name ?? null,
        payments: payments.map((payment) => ({
          amount: payment.amount,
          method: payment.method,
          paidAt: payment.receivedAt,
        })),
        linkExpiresAt: invoice.publicTokenExpiresAt ?? null,
      },
    };
  }

  async qr(shortCode: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { publicShortCodeHash: hashPublicToken(shortCode) },
      select: { publicTokenExpiresAt: true },
    });
    if (
      !invoice ||
      (invoice.publicTokenExpiresAt && invoice.publicTokenExpiresAt.getTime() <= Date.now())
    )
      throw new NotFoundException('فاکتور پیدا نشد');
    const siteUrl = (process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir').replace(/\/$/, '');
    const url = `${siteUrl}/i/${encodeURIComponent(shortCode)}`;
    const dataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      width: 320,
      margin: 2,
    });
    return { ok: true, data: { url, dataUrl } };
  }

  async pdf(token: string): Promise<Buffer> {
    const result = await this.getPublic(token);
    const invoice = result.data;
    const qr = await QRCode.toDataURL(
      `${(process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir').replace(/\/$/, '')}/i/${encodeURIComponent(token)}`,
      { errorCorrectionLevel: 'M', width: 240, margin: 1 },
    );
    return this.renderPdf(invoice, qr);
  }

  /** Shared PDF renderer: navy header, items with brand, totals and optional QR. */
  private async renderPdf(
    invoice: {
      number: string;
      customerName?: string | null;
      customerMobile?: string | null;
      storeAddress?: string | null;
      customerAddress?: string | null;
      subtotal: bigint | number;
      discount: bigint | number;
      total: bigint | number;
      returnedTotal?: bigint | number;
      paymentStatus: string;
      paidAmount: bigint | number;
      issuedAt: string | Date;
      items: Array<{
        productName: string;
        brand?: string | null;
        quantity: number;
        unitPrice: bigint | number;
        lineTotal: bigint | number;
      }>;
      returns?: Array<{
        productName: string;
        quantity: number;
        refundAmount: bigint | number;
        restock: boolean;
        reason: string;
      }>;
    },
    qrDataUrl?: string,
  ): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 42,
      info: { Title: `Invoice ${invoice.number}`, Author: 'Salimvand' },
    });
    const chunks: Buffer[] = [];
    const fontPath = process.env.PDF_FONT_PATH ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    if (existsSync(fontPath)) doc.font(fontPath);
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    const text = (value: unknown) => String(value ?? '').replace(/[<>]/g, '');
    doc.fillColor('#0d2b4b').fontSize(20).text('فاکتور فروشگاه سلیم وند', { align: 'right' });
    doc
      .moveDown(0.4)
      .fillColor('#4a5f79')
      .fontSize(10)
      .text(
        `شماره: ${text(invoice.number)}    تاریخ: ${new Intl.DateTimeFormat('fa-IR').format(new Date(invoice.issuedAt))}`,
        { align: 'right' },
      );
    if (invoice.storeAddress)
      doc.text(`آدرس فروشگاه: ${text(invoice.storeAddress)}`, { align: 'right' });
    doc
      .moveDown(1)
      .fillColor('#0b1c2f')
      .fontSize(12)
      .text(`مشتری: ${text(invoice.customerName ?? 'مشتری حضوری')}`, { align: 'right' });
    if (invoice.customerMobile)
      doc.text(`شماره تماس: ${text(invoice.customerMobile)}`, { align: 'right' });
    if (invoice.customerAddress)
      doc.text(`آدرس مشتری: ${text(invoice.customerAddress)}`, { align: 'right' });
    doc.moveDown(0.8).fontSize(11).fillColor('#0d2b4b').text('اقلام فاکتور', { align: 'right' });
    doc.moveDown(0.3).fillColor('#0b1c2f').fontSize(9);
    for (const [index, item] of invoice.items.entries())
      doc.text(
        `${index + 1}. ${text(item.productName)}${item.brand ? ` | برند: ${text(item.brand)}` : ''} | تعداد: ${text(item.quantity)} | فی: ${text(item.unitPrice)} ریال | جمع: ${text(item.lineTotal)} ریال`,
        { align: 'right' },
      );
    if (invoice.returns?.length) {
      doc
        .moveDown(0.8)
        .fontSize(11)
        .fillColor('#0d2b4b')
        .text('مرجوعی‌ها', { align: 'right' })
        .moveDown(0.2)
        .fillColor('#0b1c2f')
        .fontSize(9);
      for (const record of invoice.returns)
        doc.text(
          `${text(record.productName)} | تعداد برگشتی: ${text(record.quantity)} | مبلغ برگشتی: ${text(record.refundAmount)} ریال | ${record.restock ? 'به انبار برگشت' : 'خراب — بدون بازگشت به انبار'} | دلیل: ${text(record.reason)}`,
          { align: 'right' },
        );
    }
    doc
      .moveDown(1)
      .fontSize(11)
      .text(`جمع اقلام: ${text(invoice.subtotal)} ریال`, { align: 'right' })
      .text(`تخفیف: ${text(invoice.discount)} ریال`, { align: 'right' });
    if (BigInt(invoice.returnedTotal ?? 0) > 0n) {
      const net = BigInt(invoice.total) - BigInt(invoice.returnedTotal ?? 0);
      doc.text(`برگشتی: ${text(invoice.returnedTotal)} ریال`, { align: 'right' });
      doc
        .fontSize(14)
        .fillColor('#0d2b4b')
        .text(`مبلغ نهایی پس از برگشتی: ${text(net)} ریال`, { align: 'right' });
    } else {
      doc
        .fontSize(14)
        .fillColor('#0d2b4b')
        .text(`مبلغ نهایی: ${text(invoice.total)} ریال`, {
          align: 'right',
        });
    }
    doc
      .moveDown(0.5)
      .fillColor('#0b1c2f')
      .fontSize(11)
      .text(`پرداخت‌شده: ${text(invoice.paidAmount)} ریال`, { align: 'right' })
      .text(`وضعیت: ${text(invoice.paymentStatus)}`, { align: 'right' });
    if (qrDataUrl) {
      doc.image(Buffer.from(qrDataUrl.split(',')[1], 'base64'), 42, doc.page.height - 150, {
        fit: [105, 105],
      });
      doc
        .fontSize(8)
        .fillColor('#4a5f79')
        .text('این فاکتور از طریق لینک امن و کوتاه قابل مشاهده است.', 165, doc.page.height - 105, {
          width: 380,
          align: 'right',
        });
    }
    doc.end();
    return finished;
  }

  async customers(search?: string) {
    const pattern = search?.trim() ? `%${search.trim()}%` : '%';
    const rows = await this.queryRaw<{
      id: string;
      name: string;
      mobile: string;
      notes: string | null;
      isActive: boolean;
      createdAt: Date;
    }>(
      this.prisma as unknown as { $queryRawUnsafe: unknown },
      'SELECT "id", "name", "mobile", "notes", "isActive", "createdAt" FROM "customers" WHERE "isActive" = true AND ("name" ILIKE $1 OR "mobile" ILIKE $1) ORDER BY "createdAt" DESC LIMIT 100',
      pattern,
    );
    return { ok: true, data: rows };
  }

  async createCustomer(input: { name?: string; mobile?: string; notes?: string }) {
    const name = input.name?.trim();
    const mobile = input.mobile?.trim();
    if (!name || !mobile) throw new BadRequestException('نام و موبایل مشتری الزامی است');
    const rows = await this.queryRaw<{
      id: string;
      name: string;
      mobile: string;
      notes: string | null;
    }>(
      this.prisma as unknown as { $queryRawUnsafe: unknown },
      'INSERT INTO "customers" ("name", "mobile", "notes") VALUES ($1, $2, $3) ON CONFLICT ("mobile") DO UPDATE SET "name" = EXCLUDED."name", "notes" = EXCLUDED."notes", "updatedAt" = CURRENT_TIMESTAMP RETURNING "id", "name", "mobile", "notes"',
      name,
      mobile,
      input.notes?.trim() || null,
    );
    return { ok: true, data: rows[0] };
  }

  async options() {
    const items = await this.prisma.inventoryItem.findMany({
      where: { isActive: true, product: { deletedAt: null, status: 'active' } },
      orderBy: { product: { name: 'asc' } },
      select: {
        id: true,
        barcode: true,
        quantity: true,
        salePrice: true,
        product: { select: { name: true, code: true } },
        brand: { select: { name: true } },
        location: { select: { code: true, name: true } },
      },
    });
    // Sellers cannot read /settings (manager-only), so the store address
    // snapshot travels with the invoice options for the issue form prefill.
    const profile = await this.prisma.setting.findUnique({ where: { key: 'store.profile' } });
    const storeAddress =
      typeof (profile?.value as { address?: unknown } | null)?.address === 'string'
        ? ((profile?.value as { address?: string }).address ?? '').trim()
        : '';
    return { ok: true, data: items, storeAddress };
  }

  async pay(
    id: string,
    amount: string | number,
    method: 'cash' | 'card' | 'transfer' | 'credit',
    userId: string,
  ) {
    if (!userId || !['cash', 'card', 'transfer', 'credit'].includes(method))
      throw new BadRequestException('کاربر و روش پرداخت معتبر الزامی است');
    let paidAmount: bigint;
    try {
      paidAmount = BigInt(amount);
    } catch {
      throw new BadRequestException('مبلغ پرداخت معتبر نیست');
    }
    if (paidAmount <= 0n) throw new BadRequestException('مبلغ پرداخت باید مثبت باشد');
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const invoice = await tx.invoice.findUnique({ where: { id } });
      if (!invoice || invoice.status === 'voided') throw new NotFoundException('فاکتور پیدا نشد');
      // Returns shrink what the customer can still owe: cap new payments at
      // the net amount, not the original total.
      const returned = await tx.returnRecord.aggregate({
        where: { invoiceId: id },
        _sum: { refundAmount: true },
      });
      const netTotal = invoice.total - (returned._sum.refundAmount ?? 0n);
      const nextPaid = invoice.paidAmount + paidAmount;
      if (nextPaid > netTotal)
        throw new BadRequestException('مجموع پرداخت بیشتر از مبلغ فاکتور پس از برگشتی‌ها است');
      const status = nextPaid === netTotal ? 'paid' : 'partial';
      const updated = await tx.invoice.update({
        where: { id },
        data: {
          paidAmount: nextPaid,
          paymentStatus: status,
          paymentMethod: method,
          paidAt: status === 'paid' ? new Date() : invoice.paidAt,
        },
        include: { items: true },
      });
      await this.executeRaw(
        tx,
        'INSERT INTO "payments" ("invoiceId", "amount", "method", "receivedById") VALUES ($1, $2, CAST($3 AS "PaymentMethod"), $4)',
        id,
        paidAmount,
        method,
        userId,
      );
      await writeAudit(tx, {
        userId,
        action: 'pay',
        entityType: 'invoice',
        entityId: id,
        before: { paidAmount: invoice.paidAmount.toString(), paymentStatus: invoice.paymentStatus },
        after: { paidAmount: nextPaid.toString(), paymentStatus: status, method },
      });
      if (this.notifications && invoice.customerMobile)
        await this.notifications.enqueue({
          type: 'invoice.paid',
          invoiceId: id,
          mobile: invoice.customerMobile,
          message: `پرداخت فاکتور ${invoice.number} ثبت شد. مبلغ: ${paidAmount.toString()} ریال`,
        });
      return { ok: true, data: updated };
    });
  }

  async returnItems(
    id: string,
    input: { invoiceItemId?: string; quantity?: number; reason?: string; restock?: boolean },
    userId: string,
  ) {
    const quantity = Number(input.quantity);
    const reason = input.reason?.trim();
    if (!userId || !input.invoiceItemId || !Number.isInteger(quantity) || quantity <= 0 || !reason)
      throw new BadRequestException('قلم، تعداد صحیح مثبت و دلیل مرجوعی الزامی است');
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id }, include: { items: true } });
      if (!invoice || invoice.status === 'voided')
        throw new NotFoundException('فاکتور فعال پیدا نشد');
      const line = invoice.items.find((item) => item.id === input.invoiceItemId);
      if (!line) throw new NotFoundException('ردیف فاکتور پیدا نشد');
      const previous = await tx.returnRecord.aggregate({
        where: { invoiceItemId: line.id },
        _sum: { quantity: true, refundAmount: true },
      });
      const alreadyReturned = previous._sum.quantity ?? 0;
      if (alreadyReturned + quantity > line.quantity)
        throw new BadRequestException('تعداد مرجوعی بیشتر از تعداد خریداری‌شده است');
      const refundAmount = BigInt(quantity) * line.unitPrice;
      let quantityAfter = 0;
      if (input.restock !== false) {
        const item = await tx.inventoryItem.update({
          where: { id: line.inventoryItemId },
          data: { quantity: { increment: quantity } },
          select: { quantity: true },
        });
        quantityAfter = item.quantity;
        await tx.inventoryTransaction.create({
          data: {
            itemId: line.inventoryItemId,
            type: 'return',
            quantityChange: quantity,
            quantityAfter,
            userId,
            refType: 'return',
            refId: id,
            reason,
          },
        });
      }
      const record = await tx.returnRecord.create({
        data: {
          invoiceId: id,
          invoiceItemId: line.id,
          quantity,
          refundAmount,
          reason,
          restock: input.restock !== false,
          userId,
        },
      });
      await writeAudit(tx, {
        userId,
        action: 'return',
        entityType: 'invoice',
        entityId: id,
        after: {
          invoiceItemId: line.id,
          quantity,
          refundAmount: refundAmount.toString(),
          restock: input.restock !== false,
        },
      });
      return { ok: true, data: { ...record, quantityAfter } };
    });
  }

  /** Editable store/customer addresses on an issued invoice. */
  async updateAddresses(
    id: string,
    input: { storeAddress?: string; customerAddress?: string },
    userId: string,
    ip?: string,
  ) {
    if (!userId) throw new BadRequestException('کاربر الزامی است');
    const storeAddress = input.storeAddress?.trim();
    const customerAddress = input.customerAddress?.trim();
    if (storeAddress === undefined && customerAddress === undefined)
      throw new BadRequestException('حداقل یکی از آدرس‌ها را وارد کنید');
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      select: { id: true, status: true, storeAddress: true, customerAddress: true },
    });
    if (!invoice || invoice.status === 'voided')
      throw new NotFoundException('فاکتور فعال پیدا نشد');
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        ...(storeAddress !== undefined ? { storeAddress: storeAddress || null } : {}),
        ...(customerAddress !== undefined ? { customerAddress: customerAddress || null } : {}),
      },
    });
    await writeAudit(this.prisma, {
      userId,
      ip,
      action: 'update',
      entityType: 'invoice',
      entityId: id,
      before: { storeAddress: invoice.storeAddress, customerAddress: invoice.customerAddress },
      after: {
        storeAddress: storeAddress ?? invoice.storeAddress,
        customerAddress: customerAddress ?? invoice.customerAddress,
      },
    });
    return { ok: true, data: updated };
  }

  async void(id: string, userId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!invoice || invoice.status === 'voided')
      throw new NotFoundException('فاکتور فعال پیدا نشد');
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const line of invoice.items) {
        const item = await tx.inventoryItem.update({
          where: { id: line.inventoryItemId },
          data: { quantity: { increment: line.quantity } },
        });
        await tx.inventoryTransaction.create({
          data: {
            itemId: item.id,
            type: 'return',
            quantityChange: line.quantity,
            quantityAfter: item.quantity,
            userId,
            refType: 'invoice',
            refId: invoice.id,
            reason: `ابطال فاکتور ${invoice.number}`,
          },
        });
      }
      const updated = await tx.invoice.update({
        where: { id },
        data: { status: 'voided', voidedAt: new Date() },
        include: { items: true },
      });
      await writeAudit(tx, {
        userId,
        action: 'void',
        entityType: 'invoice',
        entityId: id,
        before: { status: invoice.status, number: invoice.number },
        after: { status: updated.status },
      });
      return { ok: true, data: updated };
    });
  }

  /**
   * Re-sends the invoice link. The short code is stored as a hash only, so resending
   * rotates the public link and its 30-day window instead of replaying the old one.
   */
  async resendSms(id: string, userId: string, mobileOverride?: string, ip?: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      select: { id: true, number: true, status: true, total: true, customerMobile: true },
    });
    if (!invoice) throw new NotFoundException('فاکتور پیدا نشد');
    if (invoice.status === 'voided')
      throw new BadRequestException('برای فاکتور باطل‌شده پیامک ارسال نمی‌شود');
    const mobile = mobileOverride?.trim() || invoice.customerMobile?.trim() || '';
    if (!/^09\d{9}$/.test(mobile))
      throw new BadRequestException('شماره موبایل معتبری برای ارسال پیامک ثبت نشده است');
    if (!this.notifications) throw new BadRequestException('صف اعلان‌ها فعال نیست');
    const shortCode = createPublicShortCode();
    const token = createPublicToken();
    const linkExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.invoice.update({
        where: { id },
        data: {
          publicShortCodeHash: shortCode.hash,
          publicTokenHash: token.hash,
          publicTokenExpiresAt: linkExpiresAt,
          ...(mobile === invoice.customerMobile ? {} : { customerMobile: mobile }),
        },
      });
      await writeAudit(tx, {
        userId,
        ip,
        action: 'update',
        entityType: 'invoice',
        entityId: id,
        before: { publicLink: 'rotated' },
        after: { publicShortCode: shortCode.code, linkExpiresAt: linkExpiresAt.toISOString() },
      });
    });
    await this.notifications.enqueue({
      type: 'invoice.issued',
      invoiceId: id,
      mobile,
      message: buildInvoiceMessage(
        invoice.number,
        shortCode.code,
        invoice.total.toString(),
        false,
        await this.smsTemplate('invoice'),
      ),
    });
    return {
      ok: true,
      data: {
        publicShortCode: shortCode.code,
        publicToken: token.token,
        linkExpiresAt,
        mobile,
        queued: true,
      },
    };
  }

  /** Operator-defined SMS template stored in settings; absent settings fall back to the built-in text. */
  private async smsTemplate(kind: 'invoice' | 'paid'): Promise<string | null> {
    const settings = this.prisma as unknown as {
      setting?: {
        findUnique: (args: { where: { key: string } }) => Promise<{ value: unknown } | null>;
      };
    };
    if (!settings.setting?.findUnique) return null;
    try {
      const row = await settings.setting.findUnique({ where: { key: 'sms.templates' } });
      const templates = row?.value as { invoice?: string; paid?: string } | null;
      return (kind === 'paid' ? templates?.paid : templates?.invoice) ?? null;
    } catch {
      return null;
    }
  }

  private async queryRaw<T>(
    client: { $queryRawUnsafe: unknown },
    query: string,
    ...values: unknown[]
  ): Promise<T[]> {
    const execute = client.$queryRawUnsafe as (...args: unknown[]) => Promise<T[]>;
    return execute(query, ...values);
  }

  private async executeRaw(
    client: { $executeRawUnsafe: unknown },
    query: string,
    ...values: unknown[]
  ): Promise<number> {
    const execute = client.$executeRawUnsafe as (...args: unknown[]) => Promise<number>;
    return execute(query, ...values);
  }

  async list() {
    const rows = await this.prisma.invoice.findMany({
      orderBy: { issuedAt: 'desc' },
      select: {
        id: true,
        number: true,
        status: true,
        customerName: true,
        customerMobile: true,
        storeAddress: true,
        customerAddress: true,
        subtotal: true,
        discount: true,
        total: true,
        paidAmount: true,
        paymentStatus: true,
        paymentMethod: true,
        paidAt: true,
        issuedAt: true,
        voidedAt: true,
        publicTokenExpiresAt: true,
        items: {
          select: {
            id: true,
            productName: true,
            quantity: true,
            unitPrice: true,
            lineTotal: true,
            inventoryItem: { select: { brand: { select: { name: true } } } },
          },
        },
        returns: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            invoiceItemId: true,
            quantity: true,
            refundAmount: true,
            reason: true,
            restock: true,
            createdAt: true,
          },
        },
      },
    });
    // Never surface the token hashes — the raw public link is only ever handed
    // out once at issue time or through the audited rotate endpoint. Net
    // amounts after partial returns are computed here so the panel and the
    // debt views always show what the customer effectively owes.
    return {
      ok: true,
      data: rows.map((row) => {
        const rowReturns = row.returns ?? [];
        const { returnedTotal, netTotal } = netInvoiceTotals(row.total, rowReturns);
        const returnedPerLine = new Map<string, number>();
        for (const record of rowReturns)
          returnedPerLine.set(
            record.invoiceItemId,
            (returnedPerLine.get(record.invoiceItemId) ?? 0) + record.quantity,
          );
        return {
          ...row,
          returnedTotal,
          netTotal,
          items: row.items.map((item) => ({
            ...item,
            returnedQuantity: returnedPerLine.get(item.id) ?? 0,
          })),
        };
      }),
    };
  }

  /** Issues a fresh public link for an invoice (the old link stops working). */
  async rotateLink(id: string, userId: string, ip?: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!invoice) throw new NotFoundException('فاکتور پیدا نشد');
    if (invoice.status === 'voided')
      throw new BadRequestException('لینک عمومی برای فاکتور باطل‌شده صادر نمی‌شود');
    const token = createPublicToken();
    const shortCode = createPublicShortCode();
    const linkExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.invoice.update({
        where: { id },
        data: {
          publicTokenHash: token.hash,
          publicShortCodeHash: shortCode.hash,
          publicTokenExpiresAt: linkExpiresAt,
        },
      });
      await writeAudit(tx, {
        userId,
        ip,
        action: 'update',
        entityType: 'invoice',
        entityId: id,
        before: { publicLink: 'rotated (panel view)' },
        after: { linkExpiresAt: linkExpiresAt.toISOString() },
      });
    });
    return {
      ok: true,
      data: {
        publicToken: token.token,
        publicShortCode: shortCode.code,
        linkExpiresAt,
      },
    };
  }

  /** Panel-side PDF: renders straight from the database row, no public link needed. */
  async pdfById(id: string): Promise<Buffer> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      select: {
        number: true,
        customerName: true,
        customerMobile: true,
        storeAddress: true,
        customerAddress: true,
        subtotal: true,
        discount: true,
        total: true,
        paymentStatus: true,
        paidAmount: true,
        issuedAt: true,
        items: {
          select: {
            id: true,
            productName: true,
            quantity: true,
            unitPrice: true,
            lineTotal: true,
            inventoryItem: { select: { brand: { select: { name: true } } } },
          },
        },
        returns: {
          orderBy: { createdAt: 'asc' },
          select: {
            invoiceItemId: true,
            quantity: true,
            refundAmount: true,
            restock: true,
            reason: true,
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('فاکتور پیدا نشد');
    const invoiceReturns = invoice.returns ?? [];
    const { returnedTotal } = netInvoiceTotals(invoice.total, invoiceReturns);
    const lineName = new Map(invoice.items.map((item) => [item.id, item.productName]));
    return this.renderPdf({
      number: invoice.number,
      customerName: invoice.customerName,
      customerMobile: invoice.customerMobile,
      storeAddress: invoice.storeAddress,
      customerAddress: invoice.customerAddress,
      subtotal: invoice.subtotal,
      discount: invoice.discount,
      total: invoice.total,
      returnedTotal,
      paymentStatus: invoice.paymentStatus,
      paidAmount: invoice.paidAmount,
      issuedAt: invoice.issuedAt,
      items: invoice.items.map((item) => ({
        productName: item.productName,
        brand: item.inventoryItem.brand.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
      returns: invoiceReturns.map((record) => ({
        productName: lineName.get(record.invoiceItemId) ?? '—',
        quantity: record.quantity,
        refundAmount: record.refundAmount,
        restock: record.restock,
        reason: record.reason,
      })),
    });
  }
}
