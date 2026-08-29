import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AuthService } from '../auth/auth.service';
import { writeAudit } from '../../common/audit/audit-log';

const roles = new Set(Object.values(UserRole));
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}
  async list() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        mobile: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    return { ok: true, data: users };
  }
  async create(
    input: { name?: string; username?: string; password?: string; role?: string; mobile?: string },
    actorId: string,
    ip?: string,
  ) {
    const name = input.name?.trim();
    const username = input.username?.trim();
    if (
      !name ||
      !username ||
      !input.password ||
      input.password.length < 10 ||
      !input.role ||
      !roles.has(input.role as UserRole)
    )
      throw new BadRequestException(
        'نام، نام کاربری، رمز حداقل ۱۰ کاراکتری و نقش معتبر الزامی است',
      );
    const created = await this.prisma.user.create({
      data: {
        name,
        username,
        passwordHash: await this.auth.hashPassword(input.password),
        role: input.role as UserRole,
        mobile: input.mobile?.trim() || undefined,
      },
      select: { id: true, name: true, username: true, role: true, mobile: true, isActive: true },
    });
    await writeAudit(this.prisma, {
      userId: actorId,
      ip,
      action: 'create',
      entityType: 'user',
      entityId: created.id,
      after: { username: created.username, role: created.role },
    });
    return { ok: true, data: created };
  }
  async update(
    id: string,
    input: { name?: string; role?: string; mobile?: string; password?: string; isActive?: boolean },
    actorId: string,
    ip?: string,
  ) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('کاربر پیدا نشد');
    if (id === actorId && input.isActive === false)
      throw new BadRequestException('نمی‌توانید حساب خودتان را غیرفعال کنید');
    if (input.role !== undefined && !roles.has(input.role as UserRole))
      throw new BadRequestException('نقش کاربر معتبر نیست');
    if (input.password !== undefined && input.password.length < 10)
      throw new BadRequestException('رمز عبور باید حداقل ۱۰ کاراکتر باشد');
    const data = {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.mobile !== undefined ? { mobile: input.mobile.trim() || null } : {}),
      ...(input.role !== undefined ? { role: input.role as UserRole } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.password !== undefined
        ? { passwordHash: await this.auth.hashPassword(input.password) }
        : {}),
    };
    if (!Object.keys(data).length)
      throw new BadRequestException('تغییری برای ذخیره ارسال نشده است');
    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        mobile: true,
        isActive: true,
        lastLoginAt: true,
      },
    });
    await writeAudit(this.prisma, {
      userId: actorId,
      ip,
      action: 'update',
      entityType: 'user',
      entityId: id,
      before: { role: before.role, isActive: before.isActive },
      after: { role: updated.role, isActive: updated.isActive },
    });
    return { ok: true, data: updated };
  }

  async activity(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, username: true, role: true },
    });
    if (!user) throw new NotFoundException('کاربر پیدا نشد');
    const [auditLogs, transactions, invoices] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.inventoryTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { item: { include: { product: true } } },
      }),
      this.prisma.invoice.findMany({
        where: { issuedById: userId },
        orderBy: { issuedAt: 'desc' },
        take: 20,
        select: { id: true, number: true, total: true, status: true, issuedAt: true },
      }),
    ]);
    return { ok: true, data: { user, auditLogs, transactions, invoices } };
  }
}
