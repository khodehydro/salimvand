import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { writeAudit } from '../../common/audit/audit-log';

type PurchaseLine = { inventoryItemId?: string; quantity?: number; unitPrice?: number | string };

function parseMoney(value: number | string | undefined, label: string): bigint {
  const text = String(value ?? 0).trim();
  if (!/^\d+$/.test(text)) throw new BadRequestException(`${label} معتبر نیست`);
  return BigInt(text);
}

export function calculatePurchaseDebt(total: bigint, paidAmount: bigint): bigint {
  return total > paidAmount ? total - paidAmount : 0n;
}

@Injectable()
export class PurchaseService {
  constructor(private readonly prisma: PrismaService) {}

  async list(supplierId?: string) {
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: supplierId ? { supplierId } : undefined,
      orderBy: { issuedAt: 'desc' },
      include: { supplier: true, items: true },
    });
    return { ok: true, data: invoices };
  }

  async pay(
    invoiceId: string,
    amount: number | string,
    method: 'cash' | 'card' | 'transfer' | 'credit',
    notes: string | undefined,
    actorId: string,
    ip?: string,
    check?: { checkNumber?: string; bank?: string; branch?: string; amount: string; dueDate: string },
  ) {
    const paymentAmount = parseMoney(amount, 'مبلغ پرداخت');
    if (paymentAmount <= 0n) throw new BadRequestException('مبلغ پرداخت باید مثبت باشد');
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const invoice = await tx.purchaseInvoice.findUnique({ where: { id: invoiceId } });
      if (!invoice || invoice.status !== 'issued')
        throw new NotFoundException('فاکتور خرید پیدا نشد');
      if (calculatePurchaseDebt(invoice.total, invoice.paidAmount) < paymentAmount)
        throw new BadRequestException('مبلغ پرداخت بیشتر از بدهی فاکتور است');
      const updatedCount = await tx.purchaseInvoice.updateMany({
        where: {
          id: invoiceId,
          status: 'issued',
          paidAmount: { lte: invoice.total - paymentAmount },
        },
        data: { paidAmount: { increment: paymentAmount } },
      });
      if (updatedCount.count !== 1)
        throw new ConflictException('فاکتور خرید هم‌زمان تغییر کرده است؛ دوباره تلاش کنید');
      const updated = await tx.purchaseInvoice.findUnique({ where: { id: invoiceId } });
      if (!updated) throw new NotFoundException('فاکتور خرید پیدا نشد');
      const payment = await tx.supplierPayment.create({
        data: {
          supplierId: invoice.supplierId,
          invoiceId,
          amount: paymentAmount,
          method,
          notes: notes?.trim() || null,
          receivedById: actorId,
        },
      });
      if (method === 'credit') {
        if (!check?.dueDate) throw new BadRequestException('تاریخ سررسید چک تأمین‌کننده الزامی است');
        const checkAmount = BigInt(check.amount || String(paymentAmount));
        if (checkAmount !== paymentAmount) throw new BadRequestException('مبلغ چک باید با مبلغ پرداختی برابر باشد');
        await tx.supplierCheck.create({ data: { paymentId: payment.id, amount: checkAmount, dueDate: new Date(check.dueDate), checkNumber: check.checkNumber, bank: check.bank, branch: check.branch } });
      }
      await writeAudit(tx, {
        userId: actorId,
        ip,
        action: 'pay',
        entityType: 'purchase_invoice',
        entityId: invoiceId,
        before: { paidAmount: String(invoice.paidAmount) },
        after: { paidAmount: String(updated.paidAmount), paymentId: payment.id },
      });
      return { ok: true, data: { invoice: updated, payment } };
    });
  }

  async updateCheckStatus(checkId: string, status: 'pending' | 'cleared' | 'bounced' | 'cancelled', actorId?: string, ip?: string) {
    if (!['pending', 'cleared', 'bounced', 'cancelled'].includes(status)) throw new BadRequestException('وضعیت چک معتبر نیست');
    const check = await this.prisma.supplierCheck.findUnique({ where: { id: checkId } });
    if (!check) throw new NotFoundException('چک تأمین‌کننده پیدا نشد');
    const now = new Date();
    const updated = await this.prisma.supplierCheck.update({ where: { id: checkId }, data: { status, clearedAt: status === 'cleared' ? now : null, bouncedAt: status === 'bounced' ? now : null } });
    if (actorId) await writeAudit(this.prisma, { userId: actorId, ip, action: 'update', entityType: 'supplier_check', entityId: checkId, before: { status: check.status }, after: { status: updated.status, clearedAt: updated.clearedAt, bouncedAt: updated.bouncedAt } });
    return { ok: true, data: updated };
  }

  async get(id: string) {
    const invoice = await this.prisma.purchaseInvoice.findUnique({
      where: { id },
      include: { supplier: true, items: true, payments: { orderBy: { paidAt: 'desc' }, include: { check: true } } },
    });
    if (!invoice) throw new NotFoundException('فاکتور خرید پیدا نشد');
    return {
      ok: true,
      data: { ...invoice, debt: calculatePurchaseDebt(invoice.total, invoice.paidAmount) },
    };
  }

  async create(
    supplierId: string,
    lines: PurchaseLine[],
    paidAmount: number | string | undefined,
    actorId: string,
    ip?: string,
  ) {
    if (!supplierId || !Array.isArray(lines) || !lines.length)
      throw new BadRequestException('تأمین‌کننده و حداقل یک قلم خرید الزامی است');
    const amounts = lines.map((line) => ({
      itemId: line.inventoryItemId,
      quantity: Number(line.quantity),
      unitPrice: parseMoney(line.unitPrice, 'قیمت خرید'),
    }));
    if (
      amounts.some((line) => !line.itemId || !Number.isInteger(line.quantity) || line.quantity <= 0)
    )
      throw new BadRequestException('اقلام خرید معتبر نیستند');
    const unique = new Map<string, { itemId: string; quantity: number; unitPrice: bigint }>();
    for (const line of amounts) {
      const current = unique.get(line.itemId!);
      if (current && current.unitPrice !== line.unitPrice)
        throw new BadRequestException('برای هر قلم فقط یک قیمت خرید مجاز است');
      unique.set(
        line.itemId!,
        current
          ? { ...current, quantity: current.quantity + line.quantity }
          : { itemId: line.itemId!, quantity: line.quantity, unitPrice: line.unitPrice },
      );
    }
    const normalized = [...unique.values()];
    const paid = parseMoney(paidAmount, 'مبلغ پرداخت');
    if (paid < 0n) throw new BadRequestException('مبلغ پرداخت معتبر نیست');
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: supplierId, isActive: true, deletedAt: null },
      });
      if (!supplier) throw new NotFoundException('تأمین‌کننده پیدا نشد');
      const inventory = await Promise.all(
        normalized.map((line) =>
          tx.inventoryItem.findUnique({ where: { id: line.itemId }, include: { product: true } }),
        ),
      );
      if (inventory.some((item) => !item)) throw new NotFoundException('قلم موجودی پیدا نشد');
      const total = normalized.reduce(
        (sum, line) => sum + BigInt(line.quantity) * line.unitPrice,
        0n,
      );
      if (paid > total) throw new BadRequestException('مبلغ پرداخت بیشتر از مبلغ فاکتور است');
      const invoice = await tx.purchaseInvoice.create({
        data: {
          number: `PUR-${Date.now()}`,
          supplierId,
          supplierName: supplier.name,
          subtotal: total,
          total,
          paidAmount: paid,
          issuedById: actorId,
          items: {
            create: normalized.map((line, index) => ({
              inventoryItemId: line.itemId!,
              productName: inventory[index]!.product.name,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: BigInt(line.quantity) * line.unitPrice,
            })),
          },
        },
        include: { items: true },
      });
      if (paid > 0n)
        await tx.supplierPayment.create({
          data: {
            supplierId,
            invoiceId: invoice.id,
            amount: paid,
            method: 'cash',
            receivedById: actorId,
            notes: 'پرداخت هنگام ثبت خرید',
          },
        });
      for (const line of normalized) {
        const current = await tx.inventoryItem.findUnique({ where: { id: line.itemId } });
        const next = current!.quantity + line.quantity;
        await tx.inventoryItem.update({
          where: { id: line.itemId },
          data: { quantity: next, purchasePrice: line.unitPrice },
        });
        await tx.inventoryTransaction.create({
          data: {
            itemId: line.itemId!,
            type: 'purchase',
            quantityChange: line.quantity,
            quantityAfter: next,
            refType: 'purchase_invoice',
            refId: invoice.id,
            userId: actorId,
            reason: `خرید ${invoice.number}`,
          },
        });
      }
      await writeAudit(tx, {
        userId: actorId,
        ip,
        action: 'create',
        entityType: 'purchase_invoice',
        entityId: invoice.id,
        after: { number: invoice.number, supplierId, total: String(total) },
      });
      return { ok: true, data: invoice };
    });
  }
}
