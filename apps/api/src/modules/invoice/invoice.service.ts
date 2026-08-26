import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { writeAudit } from '../../common/audit/audit-log';
import { calculateInvoiceTotals, InvoiceLineInput } from './invoice.rules';
import { createPublicToken, hashPublicToken } from './public-token';

type DraftLine = InvoiceLineInput & { inventoryItemId: string; productName: string };
type CreateInput = { customerName?: string; customerMobile?: string; discount?: string | number; items?: Array<{ inventoryItemId?: string; quantity?: number; unitPrice?: string | number }> };

@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaService) {}

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
    const invoice = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const counter = await tx.counter.upsert({ where: { key: 'invoice' }, update: { lastValue: { increment: 1 } }, create: { key: 'invoice', lastValue: 1 } });
      const number = `INV-${String(counter.lastValue).padStart(6, '0')}`;
      for (const line of lines) {
        const updated = await tx.inventoryItem.updateMany({ where: { id: line.inventoryItemId, quantity: { gte: line.quantity }, isActive: true }, data: { quantity: { decrement: line.quantity } } });
        if (updated.count !== 1) throw new ConflictException({ code: 'INSUFFICIENT_STOCK', message: 'موجودی کافی نیست', itemId: line.inventoryItemId });
      }
      const created = await tx.invoice.create({ data: { number, publicTokenHash: publicToken.hash, customerName: input.customerName?.trim() || undefined, customerMobile: input.customerMobile?.trim() || undefined, subtotal: totals.subtotal, discount: totals.discount, total: totals.total, issuedById: userId, items: { create: lines.map((line) => ({ inventoryItemId: line.inventoryItemId, productName: line.productName, quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: BigInt(line.quantity) * line.unitPrice })) } }, include: { items: true } });
      for (const line of lines) await tx.inventoryTransaction.create({ data: { itemId: line.inventoryItemId, type: 'sale', quantityChange: -line.quantity, quantityAfter: 0, userId, refType: 'invoice', refId: created.id, reason: `صدور فاکتور ${number}` } });
      // Refresh quantityAfter from the transactionally updated rows.
      await writeAudit(tx, { userId, action: 'issue', entityType: 'invoice', entityId: created.id, after: { number, total: totals.total.toString() } });
      for (const line of lines) { const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: line.inventoryItemId }, select: { quantity: true } }); await tx.inventoryTransaction.updateMany({ where: { itemId: line.inventoryItemId, refId: created.id }, data: { quantityAfter: item.quantity } }); }
      return created;
    });
    return { ok: true, data: { ...invoice, publicToken: publicToken.token } };
  }

  async getPublic(token: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { publicTokenHash: hashPublicToken(token) }, select: { id: true, number: true, status: true, customerName: true, customerMobile: true, subtotal: true, discount: true, total: true, paymentStatus: true, paidAmount: true, paymentMethod: true, paidAt: true, issuedAt: true, voidedAt: true, items: true } });
    if (!invoice || invoice.status === 'voided') throw new NotFoundException('فاکتور پیدا نشد');
    return { ok: true, data: invoice };
  }

  async options() {
    const items = await this.prisma.inventoryItem.findMany({ where: { isActive: true, product: { deletedAt: null, status: 'active' } }, orderBy: { product: { name: 'asc' } }, select: { id: true, barcode: true, quantity: true, salePrice: true, product: { select: { name: true, code: true } }, brand: { select: { name: true } } } });
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
      await writeAudit(tx, { userId, action: 'pay', entityType: 'invoice', entityId: id, before: { paidAmount: invoice.paidAmount.toString(), paymentStatus: invoice.paymentStatus }, after: { paidAmount: nextPaid.toString(), paymentStatus: status, method } });
      return { ok: true, data: updated };
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

  async list() { return { ok: true, data: await this.prisma.invoice.findMany({ orderBy: { issuedAt: 'desc' }, include: { items: true } }) }; }
}
