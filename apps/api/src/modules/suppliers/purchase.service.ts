import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { writeAudit } from '../../common/audit/audit-log';

type PurchaseLine = { inventoryItemId?: string; quantity?: number; unitPrice?: number | string };

@Injectable()
export class PurchaseService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const invoices = await this.prisma.purchaseInvoice.findMany({ orderBy: { issuedAt: 'desc' }, include: { supplier: true, items: true } });
    return { ok: true, data: invoices };
  }

  async create(supplierId: string, lines: PurchaseLine[], paidAmount: number | string | undefined, actorId: string, ip?: string) {
    if (!supplierId || !Array.isArray(lines) || !lines.length) throw new BadRequestException('تأمین‌کننده و حداقل یک قلم خرید الزامی است');
    const amounts = lines.map((line) => ({ itemId: line.inventoryItemId, quantity: Number(line.quantity), unitPrice: BigInt(line.unitPrice ?? 0) }));
    if (amounts.some((line) => !line.itemId || !Number.isInteger(line.quantity) || line.quantity <= 0 || line.unitPrice < 0n)) throw new BadRequestException('اقلام خرید معتبر نیستند');
    const paid = BigInt(paidAmount ?? 0);
    if (paid < 0n) throw new BadRequestException('مبلغ پرداخت معتبر نیست');
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const supplier = await tx.supplier.findFirst({ where: { id: supplierId, isActive: true, deletedAt: null } });
      if (!supplier) throw new NotFoundException('تأمین‌کننده پیدا نشد');
      const inventory = await Promise.all(amounts.map((line) => tx.inventoryItem.findUnique({ where: { id: line.itemId }, include: { product: true } })));
      if (inventory.some((item) => !item)) throw new NotFoundException('قلم موجودی پیدا نشد');
      const total = amounts.reduce((sum, line) => sum + BigInt(line.quantity) * line.unitPrice, 0n);
      if (paid > total) throw new BadRequestException('مبلغ پرداخت بیشتر از مبلغ فاکتور است');
      const invoice = await tx.purchaseInvoice.create({ data: { number: `PUR-${Date.now()}`, supplierId, supplierName: supplier.name, subtotal: total, total, paidAmount: paid, issuedById: actorId, items: { create: amounts.map((line, index) => ({ inventoryItemId: line.itemId!, productName: inventory[index]!.product.name, quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: BigInt(line.quantity) * line.unitPrice })) } }, include: { items: true } });
      for (const line of amounts) { const current = await tx.inventoryItem.findUnique({ where: { id: line.itemId } }); const next = current!.quantity + line.quantity; await tx.inventoryItem.update({ where: { id: line.itemId }, data: { quantity: next, purchasePrice: line.unitPrice } }); await tx.inventoryTransaction.create({ data: { itemId: line.itemId!, type: 'purchase', quantityChange: line.quantity, quantityAfter: next, refType: 'purchase_invoice', refId: invoice.id, userId: actorId, reason: `خرید ${invoice.number}` } }); }
      await writeAudit(tx, { userId: actorId, ip, action: 'create', entityType: 'purchase_invoice', entityId: invoice.id, after: { number: invoice.number, supplierId, total: String(total) } });
      return { ok: true, data: invoice };
    });
  }
}
