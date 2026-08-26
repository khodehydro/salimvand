import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { calculateInvoiceTotals, InvoiceLineInput } from './invoice.rules';
import { createPublicToken, hashPublicToken } from './public-token';

type DraftLine = InvoiceLineInput & { inventoryItemId: string; productName: string };
type CreateInput = { customerName?: string; customerMobile?: string; discount?: string | number; items?: Array<{ inventoryItemId?: string; quantity?: number; unitPrice?: string | number }> };

@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateInput, userId: string) {
    if (!userId || !input.items?.length) throw new BadRequestException('کاربر و حداقل یک قلم فاکتور الزامی است');
    const ids = input.items.map((item) => item.inventoryItemId ?? '');
    const records = await this.prisma.inventoryItem.findMany({ where: { id: { in: ids }, isActive: true }, include: { product: true } });
    const byId = new Map(records.map((item) => [item.id, item]));
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
      for (const line of lines) { const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: line.inventoryItemId }, select: { quantity: true } }); await tx.inventoryTransaction.updateMany({ where: { itemId: line.inventoryItemId, refId: created.id }, data: { quantityAfter: item.quantity } }); }
      return created;
    });
    return { ok: true, data: { ...invoice, publicToken: publicToken.token } };
  }

  async getPublic(token: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { publicTokenHash: hashPublicToken(token) }, include: { items: true } });
    if (!invoice || invoice.status === 'voided') throw new NotFoundException('فاکتور پیدا نشد');
    return { ok: true, data: invoice };
  }

  async list() { return { ok: true, data: await this.prisma.invoice.findMany({ orderBy: { issuedAt: 'desc' }, include: { items: true } }) }; }
}
