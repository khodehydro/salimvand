import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { writeAudit } from '../../common/audit/audit-log';

export function calculateCustomerDebt(invoices: ReadonlyArray<{ total: bigint; paidAmount: bigint }>): bigint {
  return invoices.reduce((sum, invoice) => sum + invoice.total - invoice.paidAmount, 0n);
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}
  async list(search?: string) { const q = search?.trim(); const customers = await this.prisma.customer.findMany({ where: { isActive: true, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { mobile: { contains: q } }] } : {}) }, orderBy: { createdAt: 'desc' }, take: 100, include: { invoices: { where: { status: 'issued' }, select: { total: true, paidAmount: true } } } }); return { ok: true, data: customers.map((customer) => ({ ...customer, debt: customer.invoices.reduce((sum, invoice) => sum + invoice.total - invoice.paidAmount, 0n), invoiceCount: customer.invoices.length, invoices: undefined })) }; }
  async get(id: string) { const customer = await this.prisma.customer.findFirst({ where: { id, isActive: true }, include: { invoices: { orderBy: { issuedAt: 'desc' }, include: { items: true } } } }); if (!customer) throw new NotFoundException('مشتری پیدا نشد'); return { ok: true, data: { ...customer, debt: customer.invoices.filter((item) => item.status === 'issued').reduce((sum, invoice) => sum + invoice.total - invoice.paidAmount, 0n) } }; }
  async create(input: { name?: string; mobile?: string; notes?: string }, actorId?: string, ip?: string) { const name = input.name?.trim(); const mobile = input.mobile?.trim(); if (!name || !mobile || !/^09\d{9}$/.test(mobile)) throw new BadRequestException('نام و شماره موبایل معتبر الزامی است'); const customer = await this.prisma.customer.create({ data: { name, mobile, notes: input.notes?.trim() || undefined } }); if (actorId) await writeAudit(this.prisma, { userId: actorId, ip, action: 'create', entityType: 'customer', entityId: customer.id, after: { name, mobile } }); return { ok: true, data: customer }; }
  async update(id: string, input: { name?: string; mobile?: string; notes?: string; isActive?: boolean }, actorId?: string, ip?: string) { const before = await this.prisma.customer.findUnique({ where: { id } }); if (!before) throw new NotFoundException('مشتری پیدا نشد'); const data: Prisma.CustomerUpdateInput = {}; if (input.name?.trim()) data.name = input.name.trim(); if (input.mobile !== undefined) { if (!/^09\d{9}$/.test(input.mobile)) throw new BadRequestException('شماره موبایل معتبر نیست'); data.mobile = input.mobile; } if (input.notes !== undefined) data.notes = input.notes.trim() || null; if (input.isActive !== undefined) data.isActive = input.isActive; const customer = await this.prisma.customer.update({ where: { id }, data }); if (actorId) await writeAudit(this.prisma, { userId: actorId, ip, action: input.isActive === false ? 'delete' : 'update', entityType: 'customer', entityId: id, before: { name: before.name, isActive: before.isActive }, after: { name: customer.name, isActive: customer.isActive } }); return { ok: true, data: customer }; }
  async payment(id: string, input: { amount?: string | number; method?: string; invoiceId?: string; notes?: string }, actorId: string, ip?: string) {
    let amount: bigint;
    try { amount = BigInt(input.amount ?? 0); } catch { throw new BadRequestException('مبلغ پرداخت معتبر نیست'); }
    const methods = new Set(['cash', 'card', 'transfer', 'credit']);
    if (amount <= 0n || !input.method || !methods.has(input.method)) throw new BadRequestException('مبلغ مثبت و روش پرداخت معتبر الزامی است');
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const customer = await tx.customer.findFirst({ where: { id, isActive: true }, include: { invoices: { where: { status: 'issued' }, orderBy: { issuedAt: 'asc' }, select: { id: true, total: true, paidAmount: true, paymentStatus: true } } } });
      if (!customer) throw new NotFoundException('مشتری پیدا نشد');
      const debt = calculateCustomerDebt(customer.invoices);
      if (amount > debt) throw new BadRequestException('مبلغ پرداخت بیشتر از بدهی مشتری است');
      if (input.invoiceId && !customer.invoices.some((invoice) => invoice.id === input.invoiceId)) throw new NotFoundException('فاکتور مشتری پیدا نشد');
      const allocation = input.invoiceId ? customer.invoices.filter((invoice) => invoice.id === input.invoiceId) : customer.invoices;
      let remaining = amount;
      const allocations: Array<{ invoiceId: string; amount: bigint }> = [];
      for (const invoice of allocation) {
        if (remaining <= 0n) break;
        const outstanding = invoice.total - invoice.paidAmount;
        const applied = remaining < outstanding ? remaining : outstanding;
        if (applied > 0n) { allocations.push({ invoiceId: invoice.id, amount: applied }); remaining -= applied; }
      }
      if (remaining !== 0n) throw new BadRequestException('مبلغ پرداخت به فاکتورهای مشتری تخصیص داده نشد');
      const receipt = await tx.customerPayment.create({ data: { customerId: id, invoiceId: input.invoiceId || undefined, amount, method: input.method as never, notes: input.notes?.trim() || undefined, receivedById: actorId } });
      for (const allocationItem of allocations) {
        const invoice = customer.invoices.find((item) => item.id === allocationItem.invoiceId)!;
        const paidAmount = invoice.paidAmount + allocationItem.amount;
        await tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount, paymentStatus: paidAmount === invoice.total ? 'paid' : 'partial', paidAt: paidAmount === invoice.total ? new Date() : undefined } });
        await tx.payment.create({ data: { invoiceId: invoice.id, amount: allocationItem.amount, method: input.method as never, receivedById: actorId } });
      }
      await writeAudit(tx, { userId: actorId, ip, action: 'pay', entityType: 'customer', entityId: id, before: { debt: debt.toString() }, after: { amount: amount.toString(), remainingDebt: (debt - amount).toString(), receiptId: receipt.id, allocations: allocations.map((item) => ({ invoiceId: item.invoiceId, amount: item.amount.toString() })) } });
      return { ok: true, data: { ...receipt, remainingDebt: debt - amount } };
    });
  }

  async debtors() { const customers = await this.prisma.customer.findMany({ where: { isActive: true }, include: { invoices: { where: { status: 'issued', paymentStatus: { in: ['unpaid', 'partial'] } }, select: { total: true, paidAmount: true } } } }); return { ok: true, data: customers.map((customer) => ({ id: customer.id, name: customer.name, mobile: customer.mobile, debt: customer.invoices.reduce((sum, invoice) => sum + invoice.total - invoice.paidAmount, 0n), invoiceCount: customer.invoices.length })).filter((customer) => customer.debt > 0n).sort((a, b) => (a.debt > b.debt ? -1 : 1)) }; }
}
