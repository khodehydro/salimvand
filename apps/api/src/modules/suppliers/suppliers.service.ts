import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { writeAudit } from '../../common/audit/audit-log';

type SupplierInput = {
  name?: string;
  mobile?: string;
  phone?: string;
  address?: string;
  taxId?: string;
  notes?: string;
};

export function calculateSupplierDebt(
  invoices: ReadonlyArray<{ total: bigint; paidAmount: bigint }>,
): bigint {
  return invoices.reduce((sum, invoice) => sum + invoice.total - invoice.paidAmount, 0n);
}

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(search?: string) {
    const term = search?.trim();
    const suppliers = await this.prisma.supplier.findMany({
      where: {
        deletedAt: null,
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { mobile: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return { ok: true, data: suppliers };
  }

  async debtors() {
    const suppliers = await this.prisma.supplier.findMany({
      where: { isActive: true, deletedAt: null },
      include: {
        purchases: { where: { status: 'issued' }, select: { total: true, paidAmount: true } },
      },
    });
    return {
      ok: true,
      data: suppliers
        .map((supplier) => ({
          id: supplier.id,
          name: supplier.name,
          mobile: supplier.mobile,
          debt: calculateSupplierDebt(supplier.purchases),
          invoiceCount: supplier.purchases.length,
        }))
        .filter((supplier) => supplier.debt > 0n)
        .sort((a, b) => (a.debt > b.debt ? -1 : 1)),
    };
  }

  async get(id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, deletedAt: null },
      include: {
        purchases: {
          orderBy: { issuedAt: 'desc' },
          include: { items: true, payments: { orderBy: { paidAt: 'desc' } } },
        },
        supplierPayments: { orderBy: { paidAt: 'desc' }, take: 50 },
      },
    });
    if (!supplier) throw new NotFoundException('تأمین‌کننده پیدا نشد');
    const issued = supplier.purchases.filter((invoice) => invoice.status === 'issued');
    return {
      ok: true,
      data: { ...supplier, debt: calculateSupplierDebt(issued), invoiceCount: issued.length },
    };
  }

  async create(input: SupplierInput, actorId: string, ip?: string) {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('نام تأمین‌کننده الزامی است');
    const supplier = await this.prisma.supplier.create({
      data: {
        name,
        mobile: input.mobile?.trim() || null,
        phone: input.phone?.trim() || null,
        address: input.address?.trim() || null,
        taxId: input.taxId?.trim() || null,
        notes: input.notes?.trim() || null,
      },
    });
    await writeAudit(this.prisma, {
      userId: actorId,
      ip,
      action: 'create',
      entityType: 'supplier',
      entityId: supplier.id,
      after: { name: supplier.name },
    });
    return { ok: true, data: supplier };
  }

  async remove(id: string, actorId: string, ip?: string) {
    const supplier = await this.prisma.supplier.findFirst({ where: { id, deletedAt: null } });
    if (!supplier) throw new NotFoundException('تأمین‌کننده پیدا نشد');
    await this.prisma.supplier.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });
    await writeAudit(this.prisma, {
      userId: actorId,
      ip,
      action: 'delete',
      entityType: 'supplier',
      entityId: id,
      before: { name: supplier.name, isActive: supplier.isActive },
      after: { isActive: false },
    });
    return { ok: true, data: { id, deleted: true } };
  }

  async update(
    id: string,
    input: SupplierInput & { isActive?: boolean },
    actorId: string,
    ip?: string,
  ) {
    const before = await this.prisma.supplier.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('تأمین‌کننده پیدا نشد');
    const data = {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.mobile !== undefined ? { mobile: input.mobile.trim() || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone.trim() || null } : {}),
      ...(input.address !== undefined ? { address: input.address.trim() || null } : {}),
      ...(input.taxId !== undefined ? { taxId: input.taxId.trim() || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };
    if (data.name === '') throw new BadRequestException('نام تأمین‌کننده الزامی است');
    if (!Object.keys(data).length)
      throw new BadRequestException('تغییری برای ذخیره ارسال نشده است');
    const supplier = await this.prisma.supplier.update({ where: { id }, data });
    await writeAudit(this.prisma, {
      userId: actorId,
      ip,
      action: 'update',
      entityType: 'supplier',
      entityId: id,
      before: { name: before.name, isActive: before.isActive },
      after: { name: supplier.name, isActive: supplier.isActive },
    });
    return { ok: true, data: supplier };
  }
}
