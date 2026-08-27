import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { NotificationsService, buildInvoiceMessage, integrationConfigured } from '../notifications/notifications.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { writeAudit } from '../../common/audit/audit-log';
import { calculateInvoiceTotals, InvoiceLineInput } from './invoice.rules';
import * as QRCode from 'qrcode';
import PDFDocument = require('pdfkit');
import { existsSync } from 'node:fs';
import { createPublicShortCode, createPublicToken, hashPublicToken } from './public-token';

type DraftLine = InvoiceLineInput & { inventoryItemId: string; productName: string };
type CreateInput = { customerName?: string; customerMobile?: string; discount?: string | number; items?: Array<{ inventoryItemId?: string; quantity?: number; unitPrice?: string | number }> };

@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly notifications?: NotificationsService) {}

  buildDraft(number: string, lines: readonly DraftLine[], discount = 0n) {
    if (!/^INV-[0-9]{4,}$/.test(number)) throw new Error('شماره فاکتور معتبر نیست');
    if (lines.length === 0) throw new Error('فاکتور باید حداقل یک ردیف داشته باشد');
    if (lines.length > 100) throw new Error('تعداد ردیف‌های فاکتور بیش از حد مجاز است');
    if (new Set(lines.map((line) => line.inventoryItemId)).size !== lines.length) throw new Error('قلم موجودی نمی‌تواند در چند ردیف تکرار شود');
    if (lines.some((line) => !line.productName.trim())) throw new Error('نام محصول الزامی است');
    const totals = calculateInvoiceTotals(lines, discount);
    const publicToken = createPublicToken();
    return { ...totals, number, publicToken: publicToken.token, publicTokenHash: publicToken.hash, items: lines.map((line) => ({ ...line, lineTotal: BigInt(line.quantity) * line.unitPrice })) };
  }

  async create(input: CreateInput, userId: string) {
    if (!userId || !input.items?.length) throw new BadRequestException('کاربر و حداقل یک قلم فاکتور الزامی است');
    const ids = input.items.map((item) => item.inventoryItemId ?? '');
    if (new Set(ids).size !== ids.length) throw new BadRequestException('قلم موجودی نمی‌تواند در چند ردیف تکرار شود');
    const records = await this.prisma.inventoryItem.findMany({ where: { id: { in: ids }, isActive: true }, include: { product: true } }) as Array<{ id: string; product: { name: string } }>;
    const byId = new Map(records.map((item: { id: string; product: { name: string } }) => [item.id, item]));
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
      const counter = await tx.counter.upsert({ where: { key: 'invoice' }, update: { lastValue: { increment: 1 } }, create: { key: 'invoice', lastValue: 1 } });
      const number = `INV-${String(counter.lastValue).padStart(6, '0')}`;
      for (const line of lines) {
        const updated = await tx.inventoryItem.updateMany({ where: { id: line.inventoryItemId, quantity: { gte: line.quantity }, isActive: true }, data: { quantity: { decrement: line.quantity } } });
        if (updated.count !== 1) throw new ConflictException({ code: 'INSUFFICIENT_STOCK', message: 'موجودی کافی نیست', itemId: line.inventoryItemId });
      }
      const customerName = input.customerName?.trim();
      const customerMobile = input.customerMobile?.trim();
      const created = await tx.invoice.create({ data: { number, publicTokenHash: publicToken.hash, publicShortCodeHash: publicShortCode.hash, publicTokenExpiresAt, customerName: customerName || undefined, customerMobile: customerMobile || undefined, subtotal: totals.subtotal, discount: totals.discount, total: totals.total, issuedById: userId, items: { create: lines.map((line) => ({ inventoryItemId: line.inventoryItemId, productName: line.productName, quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: BigInt(line.quantity) * line.unitPrice })) } }, include: { items: true } });
      if (customerName && customerMobile) {
        const customer = await this.queryRaw<{ id: string }>(tx, 'INSERT INTO "customers" ("name", "mobile") VALUES ($1, $2) ON CONFLICT ("mobile") DO UPDATE SET "name" = EXCLUDED."name", "updatedAt" = CURRENT_TIMESTAMP RETURNING "id"', customerName, customerMobile);
        if (customer[0]) await this.executeRaw(tx, 'UPDATE "invoices" SET "customerId" = $1 WHERE "id" = $2', customer[0].id, created.id);
      }
      for (const line of lines) await tx.inventoryTransaction.create({ data: { itemId: line.inventoryItemId, type: 'sale', quantityChange: -line.quantity, quantityAfter: 0, userId, refType: 'invoice', refId: created.id, reason: `صدور فاکتور ${number}` } });
      // Refresh quantityAfter from the transactionally updated rows.
      await writeAudit(tx, { userId, action: 'issue', entityType: 'invoice', entityId: created.id, after: { number, total: totals.total.toString() } });
      for (const line of lines) { const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: line.inventoryItemId }, select: { quantity: true } }); await tx.inventoryTransaction.updateMany({ where: { itemId: line.inventoryItemId, refId: created.id }, data: { quantityAfter: item.quantity } }); }
      return created;
    });
    if (this.notifications && (input.customerMobile || integrationConfigured('telegram') || integrationConfigured('bale'))) await this.notifications.enqueue({ type: 'invoice.issued', invoiceId: invoice.id, mobile: input.customerMobile, message: buildInvoiceMessage(invoice.number, publicShortCode.code, totals.total.toString(), false, await this.smsTemplate('invoice')) });
    return { ok: true, data: { ...invoice, publicToken: publicToken.token, publicShortCode: publicShortCode.code } };
  }

  async getPublic(token: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { OR: [{ publicTokenHash: hashPublicToken(token) }, { publicShortCodeHash: hashPublicToken(token) }] }, select: { id: true, number: true, status: true, publicTokenExpiresAt: true, customerName: true, customerMobile: true, subtotal: true, discount: true, total: true, paymentStatus: true, paidAmount: true, paymentMethod: true, paidAt: true, issuedAt: true, voidedAt: true, items: { select: { productName: true, quantity: true, unitPrice: true, lineTotal: true, inventoryItem: { select: { brand: { select: { name: true } } } } } }, payments: { orderBy: { receivedAt: 'asc' }, select: { amount: true, method: true, receivedAt: true } }, issuedBy: { select: { name: true } } } });
    if (!invoice || invoice.status === 'voided' || (invoice.publicTokenExpiresAt && invoice.publicTokenExpiresAt.getTime() <= Date.now())) throw new NotFoundException('فاکتور پیدا نشد');
    // Never spread internal identifiers into the public payload: strip the row id,
    // the link expiry and every token hash explicitly (see public-contract.test.ts).
    const {
      id: _internalId,
      publicTokenExpiresAt: _expiresAt,
      publicTokenHash: _tokenHash,
      publicShortCodeHash: _shortCodeHash,
      ...publicInvoice
    } = invoice as typeof invoice & { publicTokenHash?: string; publicShortCodeHash?: string };
    const payments = (invoice as unknown as { payments?: Array<{ amount: bigint; method: string; receivedAt: Date }> }).payments ?? [];
    const issuedBy = (invoice as unknown as { issuedBy?: { name: string } | null }).issuedBy;
    return {
      ok: true,
      data: {
        ...publicInvoice,
        items: invoice.items.map((item: { productName: string; quantity: number; unitPrice: bigint; lineTotal: bigint; inventoryItem: { brand: { name: string } } }) => ({ productName: item.productName, brand: item.inventoryItem.brand.name, quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: item.lineTotal })),
        // The document shows who issued it, how it was paid and when the link dies.
        salesPerson: issuedBy?.name ?? null,
        payments: payments.map((payment) => ({ amount: payment.amount, method: payment.method, paidAt: payment.receivedAt })),
        linkExpiresAt: invoice.publicTokenExpiresAt ?? null,
      },
    };
  }

  async qr(shortCode: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { publicShortCodeHash: hashPublicToken(shortCode) }, select: { publicTokenExpiresAt: true } });
    if (!invoice || (invoice.publicTokenExpiresAt && invoice.publicTokenExpiresAt.getTime() <= Date.now())) throw new NotFoundException('فاکتور پیدا نشد');
    const siteUrl = (process.env.PUBLIC_SITE_URL ?? 'https://selimvand.ir').replace(/\/$/, '');
    const url = `${siteUrl}/i/${encodeURIComponent(shortCode)}`;
    const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', width: 320, margin: 2 });
    return { ok: true, data: { url, dataUrl } };
  }

  async pdf(token: string): Promise<Buffer> {
    const result = await this.getPublic(token);
    const invoice = result.data;
    const qr = await QRCode.toDataURL(`${(process.env.PUBLIC_SITE_URL ?? 'https://selimvand.ir').replace(/\/$/, '')}/i/${encodeURIComponent(token)}`, { errorCorrectionLevel: 'M', width: 240, margin: 1 });
    const doc = new PDFDocument({ size: 'A4', margin: 42, info: { Title: `Invoice ${invoice.number}`, Author: 'Salimvand' } });
    const chunks: Buffer[] = [];
    const fontPath = process.env.PDF_FONT_PATH ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    if (existsSync(fontPath)) doc.font(fontPath);
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
    const text = (value: unknown) => String(value ?? '').replace(/[<>]/g, '');
    doc.fillColor('#0d2b4b').fontSize(20).text('فاکتور فروشگاه سلیم وند', { align: 'right' });
    doc.moveDown(.4).fillColor('#4a5f79').fontSize(10).text(`شماره: ${text(invoice.number)}    تاریخ: ${new Intl.DateTimeFormat('fa-IR').format(new Date(invoice.issuedAt))}`, { align: 'right' });
    doc.moveDown(1).fillColor('#0b1c2f').fontSize(12).text(`مشتری: ${text(invoice.customerName ?? 'مشتری حضوری')}`, { align: 'right' });
    if (invoice.customerMobile) doc.text(`شماره تماس: ${text(invoice.customerMobile)}`, { align: 'right' });
    doc.moveDown(.8).fontSize(11).fillColor('#0d2b4b').text('اقلام فاکتور', { align: 'right' });
    doc.moveDown(.3).fillColor('#0b1c2f').fontSize(9);
    for (const [index, item] of invoice.items.entries()) doc.text(`${index + 1}. ${text(item.productName)} | برند: ${text(item.brand)} | تعداد: ${text(item.quantity)} | فی: ${text(item.unitPrice)} ریال | جمع: ${text(item.lineTotal)} ریال`, { align: 'right' });
    doc.moveDown(1).fontSize(11).text(`جمع اقلام: ${text(invoice.subtotal)} ریال`, { align: 'right' }).text(`تخفیف: ${text(invoice.discount)} ریال`, { align: 'right' }).fontSize(14).fillColor('#0d2b4b').text(`مبلغ نهایی: ${text(invoice.total)} ریال`, { align: 'right' });
    doc.moveDown(.5).fillColor('#0b1c2f').fontSize(11).text(`پرداخت‌شده: ${text(invoice.paidAmount)} ریال`, { align: 'right' }).text(`وضعیت: ${text(invoice.paymentStatus)}`, { align: 'right' });
    doc.image(Buffer.from(qr.split(',')[1], 'base64'), 42, doc.page.height - 150, { fit: [105, 105] });
    doc.fontSize(8).fillColor('#4a5f79').text('این فاکتور از طریق لینک امن و کوتاه قابل مشاهده است.', 165, doc.page.height - 105, { width: 380, align: 'right' });
    doc.end();
    return finished;
  }

  async customers(search?: string) {
    const pattern = search?.trim() ? `%${search.trim()}%` : '%';
    const rows = await this.queryRaw<{ id: string; name: string; mobile: string; notes: string | null; isActive: boolean; createdAt: Date }>(this.prisma as unknown as { $queryRawUnsafe: unknown }, 'SELECT "id", "name", "mobile", "notes", "isActive", "createdAt" FROM "customers" WHERE "isActive" = true AND ("name" ILIKE $1 OR "mobile" ILIKE $1) ORDER BY "createdAt" DESC LIMIT 100', pattern);
    return { ok: true, data: rows };
  }

  async createCustomer(input: { name?: string; mobile?: string; notes?: string }) {
    const name = input.name?.trim(); const mobile = input.mobile?.trim();
    if (!name || !mobile) throw new BadRequestException('نام و موبایل مشتری الزامی است');
    const rows = await this.queryRaw<{ id: string; name: string; mobile: string; notes: string | null }>(this.prisma as unknown as { $queryRawUnsafe: unknown }, 'INSERT INTO "customers" ("name", "mobile", "notes") VALUES ($1, $2, $3) ON CONFLICT ("mobile") DO UPDATE SET "name" = EXCLUDED."name", "notes" = EXCLUDED."notes", "updatedAt" = CURRENT_TIMESTAMP RETURNING "id", "name", "mobile", "notes"', name, mobile, input.notes?.trim() || null);
    return { ok: true, data: rows[0] };
  }

  async options() {
    const items = await this.prisma.inventoryItem.findMany({ where: { isActive: true, product: { deletedAt: null, status: 'active' } }, orderBy: { product: { name: 'asc' } }, select: { id: true, barcode: true, quantity: true, salePrice: true, product: { select: { name: true, code: true } }, brand: { select: { name: true } }, location: { select: { code: true, name: true } } } });
    return { ok: true, data: items };
  }

  async pay(id: string, amount: string | number, method: 'cash' | 'card' | 'transfer' | 'credit', userId: string) {
    if (!userId || !['cash', 'card', 'transfer', 'credit'].includes(method)) throw new BadRequestException('کاربر و روش پرداخت معتبر الزامی است');
    let paidAmount: bigint;
    try { paidAmount = BigInt(amount); } catch { throw new BadRequestException('مبلغ پرداخت معتبر نیست'); }
    if (paidAmount <= 0n) throw new BadRequestException('مبلغ پرداخت باید مثبت باشد');
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const invoice = await tx.invoice.findUnique({ where: { id } });
      if (!invoice || invoice.status === 'voided') throw new NotFoundException('فاکتور پیدا نشد');
      const nextPaid = invoice.paidAmount + paidAmount;
      if (nextPaid > invoice.total) throw new BadRequestException('مجموع پرداخت بیشتر از مبلغ فاکتور است');
      const status = nextPaid === invoice.total ? 'paid' : 'partial';
      const updated = await tx.invoice.update({ where: { id }, data: { paidAmount: nextPaid, paymentStatus: status, paymentMethod: method, paidAt: status === 'paid' ? new Date() : invoice.paidAt }, include: { items: true } });
      await this.executeRaw(tx, 'INSERT INTO "payments" ("invoiceId", "amount", "method", "receivedById") VALUES ($1, $2, CAST($3 AS "PaymentMethod"), $4)', id, paidAmount, method, userId);
      await writeAudit(tx, { userId, action: 'pay', entityType: 'invoice', entityId: id, before: { paidAmount: invoice.paidAmount.toString(), paymentStatus: invoice.paymentStatus }, after: { paidAmount: nextPaid.toString(), paymentStatus: status, method } });
      if (this.notifications && invoice.customerMobile) await this.notifications.enqueue({ type: 'invoice.paid', invoiceId: id, mobile: invoice.customerMobile, message: `پرداخت فاکتور ${invoice.number} ثبت شد. مبلغ: ${paidAmount.toString()} ریال` });
      return { ok: true, data: updated };
    });
  }

  async returnItems(id: string, input: { invoiceItemId?: string; quantity?: number; reason?: string; restock?: boolean }, userId: string) {
    const quantity = Number(input.quantity); const reason = input.reason?.trim();
    if (!userId || !input.invoiceItemId || !Number.isInteger(quantity) || quantity <= 0 || !reason) throw new BadRequestException('قلم، تعداد صحیح مثبت و دلیل مرجوعی الزامی است');
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id }, include: { items: true } });
      if (!invoice || invoice.status === 'voided') throw new NotFoundException('فاکتور فعال پیدا نشد');
      const line = invoice.items.find((item) => item.id === input.invoiceItemId);
      if (!line) throw new NotFoundException('ردیف فاکتور پیدا نشد');
      const previous = await tx.returnRecord.aggregate({ where: { invoiceItemId: line.id }, _sum: { quantity: true, refundAmount: true } });
      const alreadyReturned = previous._sum.quantity ?? 0; if (alreadyReturned + quantity > line.quantity) throw new BadRequestException('تعداد مرجوعی بیشتر از تعداد خریداری‌شده است');
      const refundAmount = BigInt(quantity) * line.unitPrice;
      let quantityAfter = 0;
      if (input.restock !== false) { const item = await tx.inventoryItem.update({ where: { id: line.inventoryItemId }, data: { quantity: { increment: quantity } }, select: { quantity: true } }); quantityAfter = item.quantity; await tx.inventoryTransaction.create({ data: { itemId: line.inventoryItemId, type: 'return', quantityChange: quantity, quantityAfter, userId, refType: 'return', refId: id, reason } }); }
      const record = await tx.returnRecord.create({ data: { invoiceId: id, invoiceItemId: line.id, quantity, refundAmount, reason, restock: input.restock !== false, userId } });
      await writeAudit(tx, { userId, action: 'return', entityType: 'invoice', entityId: id, after: { invoiceItemId: line.id, quantity, refundAmount: refundAmount.toString(), restock: input.restock !== false } });
      return { ok: true, data: { ...record, quantityAfter } };
    });
  }

  async void(id: string, userId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id }, include: { items: true } });
    if (!invoice || invoice.status === 'voided') throw new NotFoundException('فاکتور فعال پیدا نشد');
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const line of invoice.items) {
        const item = await tx.inventoryItem.update({ where: { id: line.inventoryItemId }, data: { quantity: { increment: line.quantity } } });
        await tx.inventoryTransaction.create({ data: { itemId: item.id, type: 'return', quantityChange: line.quantity, quantityAfter: item.quantity, userId, refType: 'invoice', refId: invoice.id, reason: `ابطال فاکتور ${invoice.number}` } });
      }
      const updated = await tx.invoice.update({ where: { id }, data: { status: 'voided', voidedAt: new Date() }, include: { items: true } });
      await writeAudit(tx, { userId, action: 'void', entityType: 'invoice', entityId: id, before: { status: invoice.status, number: invoice.number }, after: { status: updated.status } });
      return { ok: true, data: updated };
    });
  }

  /**
   * Re-sends the invoice link. The short code is stored as a hash only, so resending
   * rotates the public link and its 30-day window instead of replaying the old one.
   */
  async resendSms(id: string, userId: string, mobileOverride?: string, ip?: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id }, select: { id: true, number: true, status: true, total: true, customerMobile: true } });
    if (!invoice) throw new NotFoundException('فاکتور پیدا نشد');
    if (invoice.status === 'voided') throw new BadRequestException('برای فاکتور باطل‌شده پیامک ارسال نمی‌شود');
    const mobile = (mobileOverride?.trim() || invoice.customerMobile?.trim() || '');
    if (!/^09\d{9}$/.test(mobile)) throw new BadRequestException('شماره موبایل معتبری برای ارسال پیامک ثبت نشده است');
    if (!this.notifications) throw new BadRequestException('صف اعلان‌ها فعال نیست');
    const shortCode = createPublicShortCode();
    const token = createPublicToken();
    const linkExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.invoice.update({ where: { id }, data: { publicShortCodeHash: shortCode.hash, publicTokenHash: token.hash, publicTokenExpiresAt: linkExpiresAt, ...(mobile === invoice.customerMobile ? {} : { customerMobile: mobile }) } });
      await writeAudit(tx, { userId, ip, action: 'update', entityType: 'invoice', entityId: id, before: { publicLink: 'rotated' }, after: { publicShortCode: shortCode.code, linkExpiresAt: linkExpiresAt.toISOString() } });
    });
    await this.notifications.enqueue({ type: 'invoice.issued', invoiceId: id, mobile, message: buildInvoiceMessage(invoice.number, shortCode.code, invoice.total.toString(), false, await this.smsTemplate('invoice')) });
    return { ok: true, data: { publicShortCode: shortCode.code, publicToken: token.token, linkExpiresAt, mobile, queued: true } };
  }

  /** Operator-defined SMS template stored in settings; absent settings fall back to the built-in text. */
  private async smsTemplate(kind: 'invoice' | 'paid'): Promise<string | null> {
    const settings = this.prisma as unknown as { setting?: { findUnique: (args: { where: { key: string } }) => Promise<{ value: unknown } | null> } };
    if (!settings.setting?.findUnique) return null;
    try {
      const row = await settings.setting.findUnique({ where: { key: 'sms.templates' } });
      const templates = row?.value as { invoice?: string; paid?: string } | null;
      return (kind === 'paid' ? templates?.paid : templates?.invoice) ?? null;
    } catch { return null; }
  }

  private async queryRaw<T>(client: { $queryRawUnsafe: unknown }, query: string, ...values: unknown[]): Promise<T[]> {
    const execute = client.$queryRawUnsafe as (...args: unknown[]) => Promise<T[]>;
    return execute(query, ...values);
  }

  private async executeRaw(client: { $executeRawUnsafe: unknown }, query: string, ...values: unknown[]): Promise<number> {
    const execute = client.$executeRawUnsafe as (...args: unknown[]) => Promise<number>;
    return execute(query, ...values);
  }

  async list() { return { ok: true, data: await this.prisma.invoice.findMany({ orderBy: { issuedAt: 'desc' }, include: { items: true } }) }; }
}
