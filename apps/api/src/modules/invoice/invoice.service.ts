import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { NotificationsService, buildInvoiceMessage } from '../notifications/notifications.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { writeAudit } from '../../common/audit/audit-log';
import { calculateInvoiceTotals, InvoiceLineInput } from './invoice.rules';
import * as QRCode from 'qrcode';
import PDFDocument = require('pdfkit');
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicShortCode, createPublicToken, hashPublicToken } from './public-token';
import { faText, ltrNumber } from './pdf-text';
import { formatGroupedPersian, formatPersianNumber } from '@salimvand/shared';

type DraftLine = InvoiceLineInput & { inventoryItemId: string; productName: string };
type CreateInput = {
  customerName?: string;
  customerMobile?: string;
  storeAddress?: string;
  storePhone?: string;
  customerAddress?: string;
  discount?: string | number;
  operationId?: string;
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

  /** Store contact block from settings (store.profile): used to default the
   * invoice snapshot so sellers never type the store address/phone per
   * invoice — settings stay the single source of truth. */
  private async storeProfile(): Promise<{ address: string; phone: string; logoUrl: string }> {
    try {
      const row = await this.prisma.setting.findUnique({ where: { key: 'store.profile' } });
      const profile = (row?.value ?? {}) as { address?: unknown; phones?: unknown; logoUrl?: unknown };
      return {
        address: typeof profile.address === 'string' ? profile.address.trim() : '',
        phone: typeof profile.phones === 'string' ? profile.phones.trim() : '',
        logoUrl: typeof profile.logoUrl === 'string' ? profile.logoUrl.trim() : '',
      };
    } catch {
      return { address: '', phone: '', logoUrl: '' };
    }
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
    // Store address/phone default from settings when the panel did not send
    // an explicit override — nobody should retype them on every invoice.
    const profile = await this.storeProfile();
    const storeAddress = input.storeAddress?.trim() || profile.address || undefined;
    const storePhone = input.storePhone?.trim() || profile.phone || undefined;
    const publicToken = createPublicToken();
    const publicShortCode = createPublicShortCode();
    const publicTokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const invoice = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (input.operationId) {
        const previous = await tx.invoice.findUnique({ where: { operationId: input.operationId }, include: { items: true } });
        if (previous) return previous;
      }
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
          storeAddress,
          storePhone,
          customerAddress: input.customerAddress?.trim() || undefined,
          subtotal: totals.subtotal,
          discount: totals.discount,
          total: totals.total,
          operationId: input.operationId,
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
        // Prisma upsert: ids are generated client-side, no database-side
        // uuid function has to exist for this to work.
        const customer = await tx.customer.upsert({
          where: { mobile: customerMobile },
          create: { name: customerName, mobile: customerMobile },
          update: { name: customerName },
          select: { id: true },
        });
        await tx.invoice.update({
          where: { id: created.id },
          data: { customerId: customer.id },
        });
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
    // Invoice delivery is private: only queue the customer's SMS. Telegram
    // and Bale are channel/broadcast providers and must never receive invoice
    // links as a side effect of issuing an invoice.
    if (this.notifications && input.customerMobile)
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
          input.customerName?.trim(),
        ),
        invoicePreview: {
          number: invoice.number,
          shortCode: publicShortCode.code,
          total: totals.total.toString(),
          items: lines.map((line) => ({ name: line.productName, quantity: line.quantity })),
        },
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
        storePhone: true,
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
    // Older invoices were issued before the store snapshot existed — fill
    // the store contact block from settings so the customer still sees it.
    let storeContact: { storeAddress?: string | null; storePhone?: string | null; storeLogoUrl?: string | null } = {};
    {
      const profile = await this.storeProfile();
      storeContact = {
        storeAddress: publicInvoice.storeAddress || profile.address || null,
        storePhone: publicInvoice.storePhone || profile.phone || null,
        storeLogoUrl: profile.logoUrl || null,
      };
    }
    return {
      ok: true,
      data: {
        ...publicInvoice,
        ...storeContact,
        returnedTotal,
        netTotal,
        items: invoice.items.map(
          (item: {
            id: string;
            productName: string;
            quantity: number;
            unitPrice: bigint;
            lineTotal: bigint;
            inventoryItem: { brand?: { name: string } | null };
          }) => ({
            productName: item.productName,
            brand: item.inventoryItem.brand?.name ?? 'بدون برند',
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
      storePhone?: string | null;
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
    // PDFKit cannot shape Persian on its own, so the bundled Vazirmatn (which
    // carries the contextual presentation forms) plus faText() are both
    // required — without them the PDF renders as disconnected latin junk.
    const fontCandidates = [
      process.env.PDF_FONT_PATH,
      join(__dirname, '..', '..', '..', 'assets', 'fonts', 'Vazirmatn-Regular.ttf'),
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ].filter((candidate): candidate is string => Boolean(candidate));
    const fontPath = fontCandidates.find((candidate) => existsSync(candidate));
    if (fontPath) {
      doc.font(fontPath);
      // pdfkit word-splits text and fontkit's layout engine then REVERSES
      // every Arabic word (the arab script defaults to rtl) before it is
      // drawn. faText() already emits visual left-to-right order, so that
      // second reversal mirrors each word on the page («وند» shows as «دنو»).
      // Force this one font instance to lay out ltr: glyphs are then drawn
      // exactly in the order bidi-js computed, while Persian digits, Latin
      // runs and punctuation keep their bidi-js positions too.
      const engine = (
        doc as unknown as {
          _font?: { font?: { _layoutEngine?: Record<string, unknown> } };
        }
      )._font?.font?._layoutEngine as
        | {
            layout: (
              string: string,
              features?: unknown,
              script?: unknown,
              language?: unknown,
              direction?: string,
            ) => unknown;
          }
        | undefined;
      if (engine) {
        const originalLayout = engine.layout.bind(engine);
        engine.layout = (string, features, script, language, _direction) =>
          originalLayout(string, features, script, language, 'ltr');
      }
    }
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    // EVERY drawn line goes through faText: pdfkit has no shaping engine, so
    // an unshaped Persian label (labels used to bypass it) renders as reversed,
    // disconnected letters. Persian digits have no presentation forms and pass
    // through untouched; embedded Latin runs stay readable via bidi.
    const text = (value: unknown) => faText(String(value ?? '').replace(/[<>]/g, '')) as string;
    const statusLabels: Record<string, string> = {
      paid: 'تسویه شده',
      partial: 'پرداخت بخشی',
      unpaid: 'پرداخت نشده',
    };
    doc.fillColor('#0d2b4b').fontSize(20).text(text('فاکتور فروشگاه سلیم وند'), { align: 'right' });
    doc
      .moveDown(0.4)
      .fillColor('#4a5f79')
      .fontSize(10)
      .text(
        text(
          `شماره: ${formatPersianNumber(invoice.number)}    تاریخ: ${new Intl.DateTimeFormat('fa-IR').format(new Date(invoice.issuedAt))}`,
        ),
        { align: 'right' },
      );
    if (invoice.storePhone)
      doc.text(text(`شماره تماس فروشگاه: ${ltrNumber(formatPersianNumber(invoice.storePhone))}`), {
        align: 'right',
      });
    if (invoice.storeAddress)
      doc.text(text(`آدرس فروشگاه: ${invoice.storeAddress}`), { align: 'right' });
    doc
      .moveDown(1)
      .fillColor('#0b1c2f')
      .fontSize(12)
      .text(text(`مشتری: ${invoice.customerName ?? 'مشتری حضوری'}`), { align: 'right' });
    if (invoice.customerMobile)
      doc.text(text(`شماره تماس: ${ltrNumber(formatPersianNumber(invoice.customerMobile))}`), {
        align: 'right',
      });
    if (invoice.customerAddress)
      doc.text(text(`آدرس مشتری: ${invoice.customerAddress}`), { align: 'right' });
    const drawTable = (title: string, headers: string[], rows: string[][], widths: number[]) => {
      const tableX = doc.page.margins.left;
      const tableWidth = widths.reduce((sum, width) => sum + width, 0);
      const headerHeight = 29;
      const rowHeight = 34;
      const drawHeader = () => {
        const headerY = doc.y;
        doc.save().fillColor('#0d2b4b').rect(tableX, headerY, tableWidth, headerHeight).fill().restore();
        let x = tableX;
        headers.forEach((header, index) => {
          doc.fillColor('#ffffff').fontSize(8).text(text(header), x + 5, headerY + 9, { width: widths[index] - 10, align: 'right', lineBreak: false });
          x += widths[index];
        });
        doc.y = headerY + headerHeight;
      };
      doc.moveDown(0.7).fillColor('#0d2b4b').fontSize(11).text(text(title), { align: 'right' });
      doc.moveDown(0.25);
      drawHeader();
      rows.forEach((row, rowIndex) => {
        if (doc.y + rowHeight > doc.page.height - 80) { doc.addPage(); drawHeader(); }
        const y = doc.y;
        doc.save().fillColor(rowIndex % 2 === 0 ? '#f4f7fa' : '#ffffff').rect(tableX, y, tableWidth, rowHeight).fill().restore();
        doc.strokeColor('#cbd5df').lineWidth(0.5).rect(tableX, y, tableWidth, rowHeight).stroke();
        let x = tableX;
        row.forEach((cell, index) => {
          doc.strokeColor('#d6dee7').moveTo(x, y).lineTo(x, y + rowHeight).stroke();
          doc.fillColor('#17243b').fontSize(8).text(text(cell), x + 5, y + 9, { width: widths[index] - 10, height: rowHeight - 10, align: 'right', ellipsis: true, lineBreak: false });
          x += widths[index];
        });
        doc.moveTo(tableX + tableWidth, y).lineTo(tableX + tableWidth, y + rowHeight).stroke();
        doc.y = y + rowHeight;
      });
    };

    drawTable(
      'اقلام فاکتور',
      ['ردیف', 'شرح کالا', 'برند', 'تعداد', 'قیمت واحد (ریال)', 'مبلغ (ریال)'],
      invoice.items.map((item, index) => [
        formatPersianNumber(index + 1),
        item.productName,
        item.brand ?? '—',
        formatPersianNumber(item.quantity),
        formatGroupedPersian(item.unitPrice),
        formatGroupedPersian(item.lineTotal),
      ]),
      [38, 180, 72, 55, 86, 80],
    );
    if (invoice.returns?.length) {
      drawTable(
        'مرجوعی‌ها',
        ['شرح کالا', 'تعداد', 'مبلغ برگشتی (ریال)', 'مقصد', 'دلیل'],
        invoice.returns.map((record) => [
          record.productName,
          formatPersianNumber(record.quantity),
          formatGroupedPersian(record.refundAmount),
          record.restock ? 'بازگشت به انبار' : 'ضایعات',
          record.reason,
        ]),
        [170, 55, 105, 90, 91],
      );
    }
    const returnedTotal = BigInt(invoice.returnedTotal ?? 0);
    const netTotal = BigInt(invoice.total) - returnedTotal;
    const paidAmount = BigInt(invoice.paidAmount);
    const remaining = netTotal - paidAmount;
    doc
      .moveDown(1)
      .fontSize(11)
      .text(text(`جمع اقلام: ${formatGroupedPersian(invoice.subtotal)} ریال`), { align: 'right' })
      .text(text(`تخفیف: ${formatGroupedPersian(invoice.discount)} ریال`), { align: 'right' });
    if (returnedTotal > 0n) {
      doc.text(text(`برگشتی: ${formatGroupedPersian(returnedTotal)} ریال`), { align: 'right' });
      doc
        .fontSize(14)
        .fillColor('#0d2b4b')
        .text(text(`مبلغ نهایی پس از برگشتی: ${formatGroupedPersian(netTotal)} ریال`), {
          align: 'right',
        });
    } else {
      doc
        .fontSize(14)
        .fillColor('#0d2b4b')
        .text(text(`مبلغ نهایی: ${formatGroupedPersian(invoice.total)} ریال`), {
          align: 'right',
        });
    }
    doc
      .moveDown(0.5)
      .fillColor('#0b1c2f')
      .fontSize(11)
      .text(text(`پرداخت‌شده: ${formatGroupedPersian(paidAmount)} ریال`), { align: 'right' });
    if (remaining > 0n)
      doc.text(text(`باقی‌مانده (بدهی): ${formatGroupedPersian(remaining)} ریال`), {
        align: 'right',
      });
    doc.text(text(`وضعیت: ${statusLabels[invoice.paymentStatus] ?? invoice.paymentStatus}`), {
      align: 'right',
    });
    if (qrDataUrl) {
      doc.image(Buffer.from(qrDataUrl.split(',')[1], 'base64'), 42, doc.page.height - 150, {
        fit: [105, 105],
      });
      doc
        .fontSize(8)
        .fillColor('#4a5f79')
        .text(
          text('این فاکتور از طریق لینک امن و کوتاه قابل مشاهده است.'),
          165,
          doc.page.height - 105,
          {
            width: 380,
            align: 'right',
          },
        );
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
    const customer = await this.prisma.customer.upsert({
      where: { mobile },
      create: { name, mobile, notes: input.notes?.trim() || undefined },
      update: { name, notes: input.notes?.trim() || undefined },
    });
    return { ok: true, data: customer };
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
    // Sellers cannot read /settings (manager-only), so the store contact
    // block travels with the invoice options: the issue form shows it as a
    // read-only hint (no per-invoice typing) and the server snapshots it.
    const profile = await this.storeProfile();
    return {
      ok: true,
      data: items,
      storeAddress: profile.address,
      storePhone: profile.phone,
      storeLogoUrl: profile.logoUrl,
    };
  }

  async updateCheckStatus(checkId: string, status: 'pending' | 'cleared' | 'bounced' | 'cancelled', notes?: string, actorId?: string) {
    if (!['pending', 'cleared', 'bounced', 'cancelled'].includes(status)) throw new BadRequestException('وضعیت چک معتبر نیست');
    const check = await this.prisma.paymentCheck.findUnique({ where: { id: checkId } });
    if (!check) throw new NotFoundException('چک پیدا نشد');
    const now = new Date();
    const updated = await this.prisma.paymentCheck.update({ where: { id: checkId }, data: { status, notes: notes?.trim() || undefined, clearedAt: status === 'cleared' ? now : null, bouncedAt: status === 'bounced' ? now : null } });
    if (actorId) await writeAudit(this.prisma, { userId: actorId, action: 'update', entityType: 'payment_check', entityId: checkId, before: { status: check.status }, after: { status: updated.status, clearedAt: updated.clearedAt, bouncedAt: updated.bouncedAt } });
    return { ok: true, data: updated };
  }

  async pay(
    id: string,
    amount: string | number,
    method: 'cash' | 'card' | 'transfer' | 'credit',
    userId: string,
    checks?: Array<{ checkNumber?: string; bank?: string; branch?: string; amount: string; dueDate: string }>,
    operationId?: string,
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
    if (method === 'credit') {
      if (!checks?.length) throw new BadRequestException('حداقل یک چک برای پرداخت چکی وارد کنید');
      const todayTehran = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
      for (const check of checks) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(check.dueDate) || Number.isNaN(new Date(`${check.dueDate}T00:00:00Z`).getTime()) || check.dueDate < todayTehran)
          throw new BadRequestException({ code: 'INVALID_CHECK_DUE_DATE', message: 'تاریخ سررسید چک نمی‌تواند گذشته باشد' });
      }
    }
    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (operationId) {
        const previous = await tx.payment.findUnique({ where: { operationId } });
        if (previous) return { ok: true, data: { payment: previous, duplicate: true } };
      }
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
      // Prisma supplies the uuid client-side: no raw SQL, no dependency on
      // gen_random_uuid()/pgcrypto being available on the server database.
      const payment = await tx.payment.create({
        data: {
          invoiceId: id,
          amount: paidAmount,
          method,
          receivedById: userId,
          operationId,
        },
      });
      if (method === 'credit') {
        if (!checks?.length) throw new BadRequestException('حداقل یک چک برای پرداخت چکی وارد کنید');
        const checkRows = checks.map((check) => ({ ...check, amount: BigInt(check.amount || '0') }));
        if (checkRows.some((check) => !check.dueDate || check.amount <= 0n)) throw new BadRequestException('تاریخ و مبلغ همهٔ چک‌ها الزامی است');
        const checksTotal = checkRows.reduce((sum, check) => sum + check.amount, 0n);
        if (checksTotal !== paidAmount) throw new BadRequestException('جمع مبالغ چک‌ها باید با مبلغ پرداختی برابر باشد');
        await tx.paymentCheck.createMany({ data: checkRows.map((check) => ({ paymentId: payment.id, amount: check.amount, dueDate: new Date(check.dueDate), checkNumber: check.checkNumber, bank: check.bank, branch: check.branch })) });
      }
      await writeAudit(tx, {
        userId,
        action: 'pay',
        entityType: 'invoice',
        entityId: id,
        before: { paidAmount: invoice.paidAmount.toString(), paymentStatus: invoice.paymentStatus },
        after: { paidAmount: nextPaid.toString(), paymentStatus: status, method },
      });
      return { ok: true, data: updated };
    });
    // Business rule: registering a payment must NOT send an SMS. Invoice SMS
    // goes out only on issue and on manual resend (debt reminder).
    return result;
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
      // A return shrinks what the customer still owes: settle the payment
      // status against the NET amount so a fully-covered invoice stops
      // showing debt (50k debt + a 50k return → status "paid", debt 0).
      const refunded = await tx.returnRecord.aggregate({
        where: { invoiceId: id },
        _sum: { refundAmount: true },
      });
      const netTotal = invoice.total - (refunded._sum.refundAmount ?? 0n);
      const nextStatus =
        invoice.paidAmount >= netTotal ? 'paid' : invoice.paidAmount > 0n ? 'partial' : 'unpaid';
      if (nextStatus !== invoice.paymentStatus)
        await tx.invoice.update({
          where: { id },
          data: {
            paymentStatus: nextStatus,
            paidAt: nextStatus === 'paid' ? (invoice.paidAt ?? new Date()) : invoice.paidAt,
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
          ...(nextStatus !== invoice.paymentStatus ? { paymentStatus: nextStatus } : {}),
        },
      });
      return { ok: true, data: { ...record, quantityAfter } };
    });
  }

  /** Editable store/customer contact block on an issued invoice. Empty store
   * fields fall back to the settings profile instead of being wiped. */
  async updateAddresses(
    id: string,
    input: { storeAddress?: string; storePhone?: string; customerAddress?: string },
    userId: string,
    ip?: string,
  ) {
    if (!userId) throw new BadRequestException('کاربر الزامی است');
    const storeAddress = input.storeAddress?.trim();
    const storePhone = input.storePhone?.trim();
    const customerAddress = input.customerAddress?.trim();
    if (storeAddress === undefined && customerAddress === undefined && storePhone === undefined)
      throw new BadRequestException('حداقل یکی از فیلدها را وارد کنید');
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        storeAddress: true,
        storePhone: true,
        customerAddress: true,
      },
    });
    if (!invoice || invoice.status === 'voided')
      throw new NotFoundException('فاکتور فعال پیدا نشد');
    const profile = await this.storeProfile();
    const nextStoreAddress =
      storeAddress !== undefined ? storeAddress || profile.address || null : invoice.storeAddress;
    const nextStorePhone =
      storePhone !== undefined ? storePhone || profile.phone || null : invoice.storePhone;
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        ...(storeAddress !== undefined ? { storeAddress: nextStoreAddress } : {}),
        ...(storePhone !== undefined ? { storePhone: nextStorePhone } : {}),
        ...(customerAddress !== undefined ? { customerAddress: customerAddress || null } : {}),
      },
    });
    await writeAudit(this.prisma, {
      userId,
      ip,
      action: 'update',
      entityType: 'invoice',
      entityId: id,
      before: {
        storeAddress: invoice.storeAddress,
        storePhone: invoice.storePhone,
        customerAddress: invoice.customerAddress,
      },
      after: {
        storeAddress: nextStoreAddress,
        storePhone: nextStorePhone,
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
      select: {
        id: true,
        number: true,
        status: true,
        total: true,
        customerMobile: true,
        customerName: true,
        items: { select: { productName: true, quantity: true } },
      },
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
        invoice.customerName,
      ),
      invoicePreview: {
        number: invoice.number,
        shortCode: shortCode.code,
        total: invoice.total.toString(),
        items: ((invoice.items ?? []) as Array<{ productName: string; quantity: number }>).map((item) => ({
          name: item.productName,
          quantity: item.quantity,
        })),
      },
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

  async get(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: true,
        items: { include: { inventoryItem: { include: { product: true, brand: true, location: { include: { parent: true } } } } } },
        payments: { include: { checks: true }, orderBy: { receivedAt: 'desc' } },
        returns: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!invoice) throw new NotFoundException('فاکتور پیدا نشد');
    return { ok: true, data: invoice };
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
        storePhone: true,
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
    const profile = await this.storeProfile();
    return this.renderPdf({
      number: invoice.number,
      customerName: invoice.customerName,
      customerMobile: invoice.customerMobile,
      storeAddress: invoice.storeAddress || profile.address || null,
      storePhone: invoice.storePhone || profile.phone || null,
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
        brand: item.inventoryItem.brand?.name ?? 'بدون برند',
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
