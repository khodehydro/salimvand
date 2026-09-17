import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { writeAudit } from '../../common/audit/audit-log';
import { buildLocationSyncPayload } from '../../common/sync/sync-payloads';

const LOCATION_TYPES = ['warehouse', 'aisle', 'shelf', 'level', 'box'] as const;

type LocationInput = {
  name?: string;
  code?: string;
  type?: string;
  parentId?: string | null;
};

/**
 * Shelves and warehouses. The locations table is a two-level tree:
 *  - an «انبار» (warehouse) is a top-level location and acts as the GROUP
 *    (انبار اصلی، فروشگاه، انبار دوم، … — created freely by the operator);
 *  - a «قفسه» is a location placed inside one warehouse via parentId.
 * Inventory items point at a shelf; their placement is always shown as
 * «انبار · قفسه» in the panel. Legacy flat locations (created before the
 * grouping) keep working: they simply appear as shelves without a warehouse
 * until an operator assigns them to one.
 */
@Injectable()
export class LocationService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return {
      ok: true,
      data: await this.prisma.location.findMany({
        orderBy: { code: 'asc' },
        include: {
          parent: true,
          children: { orderBy: { code: 'asc' }, include: { _count: { select: { items: true } } } },
          _count: { select: { items: true } },
        },
      }),
    };
  }

  async create(input: LocationInput & { userId?: string; ip?: string }) {
    const name = input.name?.trim();
    const code = input.code?.trim();
    const type = input.type ?? 'shelf';
    if (!name || !code) throw new BadRequestException('نام و کد محل الزامی است');
    if (!LOCATION_TYPES.includes(type as (typeof LOCATION_TYPES)[number]))
      throw new BadRequestException('نوع محل معتبر نیست');
    const parentId = await this.resolveParent(input.parentId);
    await this.ensureCodeFree(code, parentId);
    const data = await this.prisma.location.create({
      data: { name, code, type: type as never, parentId },
    });
    await writeAudit(this.prisma, {
      userId: input.userId,
      action: 'create',
      entityType: 'location',
      entityId: data.id,
      after: { name, code, type, parentId },
      ip: input.ip,
      syncPayload: buildLocationSyncPayload(data),
    });
    return { ok: true, data };
  }

  async update(id: string, input: LocationInput & { userId?: string; ip?: string }) {
    const existing = await this.prisma.location.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('محل انبار پیدا نشد');
    const name = input.name !== undefined ? input.name.trim() : existing.name;
    const code = input.code !== undefined ? input.code.trim() : existing.code;
    const type = input.type !== undefined ? input.type : existing.type;
    if (!name || !code) throw new BadRequestException('نام و کد محل الزامی است');
    if (!LOCATION_TYPES.includes(type as (typeof LOCATION_TYPES)[number]))
      throw new BadRequestException('نوع محل معتبر نیست');
    // parentId: undefined keeps the current warehouse, null detaches
    // («بدون انبار»), a string must reference an existing top-level warehouse.
    const parentId =
      input.parentId !== undefined
        ? await this.resolveParent(input.parentId, id)
        : existing.parentId;
    if (parentId !== existing.parentId) {
      const childCount = await this.prisma.location.count({ where: { parentId: id } });
      if (childCount > 0)
        throw new BadRequestException(
          'این انبار قفسه دارد و نمی‌تواند زیرمجموعهٔ انبار دیگری شود؛ ابتدا قفسه‌های آن را منتقل یا حذف کنید',
        );
    }
    await this.ensureCodeFree(code, parentId, id);
    const data = await this.prisma.location.update({
      where: { id },
      data: { name, code, type: type as never, parentId },
    });
    await writeAudit(this.prisma, {
      userId: input.userId,
      action: 'update',
      entityType: 'location',
      entityId: id,
      before: { name: existing.name, code: existing.code, parentId: existing.parentId },
      after: { name, code, parentId },
      ip: input.ip,
      syncPayload: buildLocationSyncPayload(data),
    });
    return { ok: true, data };
  }

  async remove(id: string, userId?: string, ip?: string) {
    const existing = await this.prisma.location.findUnique({
      where: { id },
      include: { _count: { select: { items: true, children: true } } },
    });
    if (!existing) throw new NotFoundException('محل انبار پیدا نشد');
    if (existing._count.children > 0)
      throw new BadRequestException('ابتدا قفسه‌های این انبار را حذف یا به انبار دیگری منتقل کنید');
    // The FK is ON DELETE SET NULL: items keep their stock, they just lose
    // their shelf placement (and the panel reports how many were detached).
    await this.prisma.location.delete({ where: { id } });
    await writeAudit(this.prisma, {
      userId,
      action: 'delete',
      entityType: 'location',
      entityId: id,
      before: { name: existing.name, code: existing.code, parentId: existing.parentId },
      after: { detachedItems: existing._count.items },
      ip,
      // Deletions publish action=deleted with a minimal payload; the before
      // snapshot above stays audit-only.
      syncPayload: { id },
    });
    return { ok: true, data: { id, detachedItems: existing._count.items } };
  }

  /** A parent must exist and be a top-level warehouse (the tree is exactly
   * two levels deep) — and a location can never be its own parent. */
  private async resolveParent(
    parentId: string | null | undefined,
    selfId?: string,
  ): Promise<string | null> {
    if (!parentId) return null;
    if (parentId === selfId) throw new BadRequestException('محل نمی‌تواند والد خودش باشد');
    const parent = await this.prisma.location.findUnique({ where: { id: parentId } });
    if (!parent) throw new BadRequestException('انبار انتخاب‌شده پیدا نشد');
    if (parent.parentId) throw new BadRequestException('والد باید یک انبار (سطح اول) باشد');
    return parentId;
  }

  /** Codes are unique among siblings (the DB unique index treats NULL parent
   * rows as distinct, so this app-level check gives the operator a real
   * Persian message instead of a raw P2002). */
  private async ensureCodeFree(code: string, parentId: string | null, ignoreId?: string) {
    const clash = await this.prisma.location.findFirst({
      where: { code, parentId, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
    });
    if (clash) throw new BadRequestException('این کد قبلاً در همین انبار ثبت شده است');
  }
}
