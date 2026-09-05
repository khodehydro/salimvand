import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { writeAudit } from '../../common/audit/audit-log';

/** Outstanding debt per invoice = total − returns − paid (never below 0 for
 * the sum): a returned item stops counting as debt the moment the return is
 * registered, everywhere the customer debt is shown. */
export function calculateCustomerDebt(
  invoices: ReadonlyArray<{
    total: bigint;
    paidAmount: bigint;
    returns?: ReadonlyArray<{ refundAmount: bigint }> | null;
  }>,
): bigint {
  let debt = 0n;
  for (const invoice of invoices) {
    const returned = (invoice.returns ?? []).reduce(
      (refunds, record) => refunds + record.refundAmount,
      0n,
    );
    debt += invoice.total - returned - invoice.paidAmount;
  }
  return debt < 0n ? 0n : debt;
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}
  async list(search?: string) {
    const q = search?.trim();
    const customers = await this.prisma.customer.findMany({
      where: {
        isActive: true,
        ...(q
          ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { mobile: { contains: q } }] }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        invoices: {
          where: { status: 'issued' },
          select: { total: true, paidAmount: true, issuedAt: true, returns: { select: { refundAmount: true } } },
        },
      },
    });
    return {
      ok: true,
      data: customers.map((customer) => {
        const totalPurchase = customer.invoices.reduce((sum, invoice) => sum + invoice.total, 0n);
        const lastPurchase = customer.invoices[0]?.issuedAt ?? null;
        return {
          ...customer,
          debt: calculateCustomerDebt(customer.invoices).toString(),
          totalPurchase: totalPurchase.toString(),
          lastPurchase,
          invoiceCount: customer.invoices.length,
          invoices: undefined,
        };
      }),
    };
  }
  async get(id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, isActive: true },
      include: {
        invoices: {
          orderBy: { issuedAt: 'desc' },
          include: { items: true, returns: { select: { refundAmount: true } } },
        },
      },
    });
    if (!customer) throw new NotFoundException('مشتری پیدا نشد');
    const smsLogs = await this.prisma.smsLog.findMany({ where: { mobile: customer.mobile }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, message: true, status: true, createdAt: true } });
    return {
      ok: true,
      data: {
        ...customer,
        smsLogs,
        debt: calculateCustomerDebt(
          customer.invoices.filter((item) => item.status === 'issued'),
        ).toString(),
      },
    };
  }
  async create(
    input: { name?: string; mobile?: string; address?: string; notes?: string },
    actorId?: string,
    ip?: string,
  ) {
    const name = input.name?.trim();
    const mobile = input.mobile?.trim();
    if (!name || !mobile || !/^09\d{9}$/.test(mobile))
      throw new BadRequestException('نام و شماره موبایل معتبر الزامی است');
    const customer = await this.prisma.customer.create({
      data: {
        name,
        mobile,
        address: input.address?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
      },
    });
    if (actorId)
      await writeAudit(this.prisma, {
        userId: actorId,
        ip,
        action: 'create',
        entityType: 'customer',
        entityId: customer.id,
        after: { name, mobile },
      });
    return { ok: true, data: customer };
  }
  async update(
    id: string,
    input: { name?: string; mobile?: string; address?: string; notes?: string; isActive?: boolean },
    actorId?: string,
    ip?: string,
  ) {
    const before = await this.prisma.customer.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('مشتری پیدا نشد');
    const data: Prisma.CustomerUpdateInput = {};
    if (input.name?.trim()) data.name = input.name.trim();
    if (input.mobile !== undefined) {
      if (!/^09\d{9}$/.test(input.mobile)) throw new BadRequestException('شماره موبایل معتبر نیست');
      data.mobile = input.mobile;
    }
    if (input.address !== undefined) data.address = input.address.trim() || null;
    if (input.notes !== undefined) data.notes = input.notes.trim() || null;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    const customer = await this.prisma.customer.update({ where: { id }, data });
    if (actorId)
      await writeAudit(this.prisma, {
        userId: actorId,
        ip,
        action: input.isActive === false ? 'delete' : 'update',
        entityType: 'customer',
        entityId: id,
        before: { name: before.name, isActive: before.isActive },
        after: { name: customer.name, isActive: customer.isActive },
      });
    return { ok: true, data: customer };
  }
  async payment(
    id: string,
    input: { amount?: string | number; method?: string; invoiceId?: string; notes?: string },
    actorId: string,
    ip?: string,
  ) {
    // An empty actor id would blow up as an FK violation deep inside the
    // transaction and surface as an opaque 500 — fail with a clear 400 instead.
    if (!actorId) throw new BadRequestException('کاربر واردشده شناسایی نشد');
    let amount: bigint;
    try {
      amount = BigInt(input.amount ?? 0);
    } catch {
      throw new BadRequestException('مبلغ پرداخت معتبر نیست');
    }
    const methods = new Set(['cash', 'card', 'transfer', 'credit']);
    if (amount <= 0n || !input.method || !methods.has(input.method))
      throw new BadRequestException('مبلغ مثبت و روش پرداخت معتبر الزامی است');
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const customer = await tx.customer.findFirst({
        where: { id, isActive: true },
        include: {
          invoices: {
            where: { status: 'issued' },
            orderBy: { issuedAt: 'asc' },
            select: {
              id: true,
              total: true,
              paidAmount: true,
              paymentStatus: true,
              returns: { select: { refundAmount: true } },
            },
          },
        },
      });
      if (!customer) throw new NotFoundException('مشتری پیدا نشد');
      const debt = calculateCustomerDebt(customer.invoices);
      if (amount > debt) throw new BadRequestException('مبلغ پرداخت بیشتر از بدهی مشتری است');
      if (input.invoiceId && !customer.invoices.some((invoice) => invoice.id === input.invoiceId))
        throw new NotFoundException('فاکتور مشتری پیدا نشد');
      const allocation = input.invoiceId
        ? customer.invoices.filter((invoice) => invoice.id === input.invoiceId)
        : customer.invoices;
      let remaining = amount;
      const allocations: Array<{ invoiceId: string; amount: bigint }> = [];
      for (const invoice of allocation) {
        if (remaining <= 0n) break;
        // Returns shrink what this invoice can still absorb.
        const returned = (invoice.returns ?? []).reduce(
          (refunds, record) => refunds + record.refundAmount,
          0n,
        );
        const outstanding = invoice.total - returned - invoice.paidAmount;
        const applied = remaining < outstanding ? remaining : outstanding;
        if (applied > 0n) {
          allocations.push({ invoiceId: invoice.id, amount: applied });
          remaining -= applied;
        }
      }
      if (remaining !== 0n)
        throw new BadRequestException('مبلغ پرداخت به فاکتورهای مشتری تخصیص داده نشد');
      const receipt = await tx.customerPayment.create({
        data: {
          customerId: id,
          invoiceId: input.invoiceId || undefined,
          amount,
          method: input.method as never,
          notes: input.notes?.trim() || undefined,
          receivedById: actorId,
        },
      });
      for (const allocationItem of allocations) {
        const invoice = customer.invoices.find((item) => item.id === allocationItem.invoiceId)!;
        const paidAmount = invoice.paidAmount + allocationItem.amount;
        const returnedTotal = (invoice.returns ?? []).reduce(
          (refunds, record) => refunds + record.refundAmount,
          0n,
        );
        const netTotal = invoice.total - returnedTotal;
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount,
            paymentStatus: paidAmount >= netTotal ? 'paid' : 'partial',
            paidAt: paidAmount >= netTotal ? new Date() : undefined,
          },
        });
        await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            amount: allocationItem.amount,
            method: input.method as never,
            receivedById: actorId,
          },
        });
      }
      await writeAudit(tx, {
        userId: actorId,
        ip,
        action: 'pay',
        entityType: 'customer',
        entityId: id,
        before: { debt: debt.toString() },
        after: {
          amount: amount.toString(),
          remainingDebt: (debt - amount).toString(),
          receiptId: receipt.id,
          allocations: allocations.map((item) => ({
            invoiceId: item.invoiceId,
            amount: item.amount.toString(),
          })),
        },
      });
      // JSON-safe: BigInts are stringified here so the endpoint never depends
      // on the express `json replacer` to serialize the response.
      return {
        ok: true,
        data: {
          id: receipt.id,
          paidAt: receipt.paidAt,
          amount: amount.toString(),
          remainingDebt: (debt - amount).toString(),
        },
      };
    });
  }

  async debtors() {
    const customers = await this.prisma.customer.findMany({
      where: { isActive: true },
      include: {
        invoices: {
          where: { status: 'issued', paymentStatus: { in: ['unpaid', 'partial'] } },
          select: { total: true, paidAmount: true, returns: { select: { refundAmount: true } } },
        },
      },
    });
    return {
      ok: true,
      data: customers
        .map((customer) => {
          const debt = calculateCustomerDebt(customer.invoices);
          return {
            id: customer.id,
            name: customer.name,
            mobile: customer.mobile,
            debt: debt.toString(),
            invoiceCount: customer.invoices.length,
          };
        })
        .filter((customer) => BigInt(customer.debt) > 0n)
        .sort((a, b) => (BigInt(a.debt) > BigInt(b.debt) ? -1 : 1)),
    };
  }

  async vehicles(customerId: string) {
    const rows = await this.prisma.customerVehicle.findMany({
      where: { customerId },
      include: { trim: { include: { model: { include: { make: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return { ok: true, data: rows };
  }

  async addVehicle(
    customerId: string,
    input: { trimId?: string; plate?: string; chassis?: string; year?: number; notes?: string },
    actorId?: string,
  ) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('مشتری پیدا نشد');
    if (!input.trimId && !input.plate?.trim())
      throw new BadRequestException('نوع خودرو یا پلاک الزامی است');
    if (
      input.year !== undefined &&
      (!Number.isInteger(Number(input.year)) ||
        Number(input.year) < 1300 ||
        Number(input.year) > 1500)
    )
      throw new BadRequestException('سال مدل خودرو معتبر نیست');
    if (
      input.trimId &&
      !(await this.prisma.vehicleTrim.findUnique({ where: { id: input.trimId } }))
    )
      throw new NotFoundException('تیپ خودرو پیدا نشد');
    const vehicle = await this.prisma.customerVehicle.create({
      data: {
        customerId,
        trimId: input.trimId || undefined,
        plate: input.plate?.trim() || undefined,
        chassis: input.chassis?.trim() || undefined,
        year: input.year ? Number(input.year) : undefined,
        notes: input.notes?.trim() || undefined,
      },
      include: { trim: { include: { model: { include: { make: true } } } } },
    });
    if (actorId) {
      await writeAudit(this.prisma, {
        userId: actorId,
        action: 'create',
        entityType: 'customer_vehicle',
        entityId: vehicle.id,
        after: { plate: vehicle.plate, customerId },
      });
    }
    return { ok: true, data: vehicle };
  }

  async removeVehicle(customerId: string, vehicleId: string, actorId?: string) {
    const vehicle = await this.prisma.customerVehicle.findFirst({
      where: { id: vehicleId, customerId },
    });
    if (!vehicle) throw new NotFoundException('خودرو پیدا نشد');
    await this.prisma.customerVehicle.delete({ where: { id: vehicleId } });
    if (actorId) {
      await writeAudit(this.prisma, {
        userId: actorId,
        action: 'delete',
        entityType: 'customer_vehicle',
        entityId: vehicleId,
        before: { plate: vehicle.plate, customerId },
      });
    }
    return { ok: true, data: { id: vehicleId } };
  }
}
