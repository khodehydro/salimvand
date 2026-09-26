import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { writeAudit } from '../../common/audit/audit-log';
import { buildLocationSyncPayload } from '../../common/sync/sync-payloads';

const LOCATION_TYPES = ['warehouse', 'aisle', 'shelf', 'level', 'box', 'basket'] as const;

type LocationInput = {
  name?: string;
  code?: string;
  type?: string;
  parentId?: string | null;
};

/**
 * Warehouses, shelves and baskets. The locations table is a THREE-level tree:
 *  - an «انبار» (warehouse) is a top-level location and acts as the GROUP
 *    (انبار اصلی، فروشگاه، انبار دوم، … — created freely by the operator);
 *  - a «قفسه» (shelf) is a location placed inside one warehouse via parentId;
 *  - a «سبد» (basket) is a bin placed inside one shelf via parentId.
 * Inventory items point at a shelf AND, optionally, at one basket of that
 * shelf, so every part has its own «قفسه · سبد» address. Legacy flat
 * locations (created before the grouping) keep working: they simply appear
 * as shelves without a warehouse until an operator assigns them to one.
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
          // children = baskets for a shelf, shelves for a warehouse. Both
          // levels carry their own stock counts so the panel can show
          // «N قلم» next to a shelf and next to each basket.
          children: {
            orderBy: { code: 'asc' },
            include: {
              children: {
                orderBy: { code: 'asc' },
                include: { _count: { select: { items: true, basketItems: true } } },
              },
              _count: { select: { items: true, basketItems: true, children: true } },
            },
          },
          _count: { select: { items: true, basketItems: true, children: true } },
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
    const parentId = await this.resolveParent(input.parentId, undefined, type);
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
    // parentId: undefined keeps the current parent, null detaches
    // («بدون انبار» / «بدون قفسه»), a string must reference a valid parent
    // for this node's type (warehouse for a shelf, shelf for a basket).
    const parentId =
      input.parentId !== undefined
        ? await this.resolveParent(input.parentId, id, type)
        : existing.parentId;
    // The children must still make sense for the (possibly changed) type: a
    // basket can never hold anything, and a shelf may only hold baskets.
    await this.assertChildren(
      id,
      type,
      existing.type,
      parentId !== existing.parentId,
    );
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
      include: { _count: { select: { items: true, basketItems: true, children: true } } },
    });
    if (!existing) throw new NotFoundException('محل انبار پیدا نشد');
    if (existing._count.children > 0)
      throw new BadRequestException(
        existing.type === 'basket'
          ? 'ابتدا زیرمجموعه‌های این سبد را حذف کنید'
          : 'ابتدا سبدها و قفسه‌های این محل را حذف یا به محل دیگری منتقل کنید',
      );
    // The FKs are ON DELETE SET NULL: items keep their stock, they just lose
    // their basket (and their shelf, when a shelf is deleted) — the panel
    // reports how many lines were detached.
    const detachedItems = existing._count.items + existing._count.basketItems;
    await this.prisma.location.delete({ where: { id } });
    await writeAudit(this.prisma, {
      userId,
      action: 'delete',
      entityType: 'location',
      entityId: id,
      before: { name: existing.name, code: existing.code, parentId: existing.parentId },
      after: { detachedItems, detachedBasketItems: existing._count.basketItems },
      ip,
      // Deletions publish action=deleted with a minimal payload; the before
      // snapshot above stays audit-only.
      syncPayload: { id },
    });
    return { ok: true, data: { id, detachedItems } };
  }

  /** A parent must exist and be the right kind of node for the child's type
   * (the tree is exactly three levels deep): a shelf hangs under a warehouse,
   * a basket sits inside a shelf, and nothing can be its own parent. */
  private async resolveParent(
    parentId: string | null | undefined,
    selfId?: string,
    type = 'shelf',
  ): Promise<string | null> {
    if (!parentId) {
      // Warehouses and shelves may stand alone («بدون انبار»); a basket with
      // no shelf would be an address nobody can walk to.
      if (type === 'basket')
        throw new BadRequestException('سبد باید داخل یک قفسه تعریف شود — قفسه را انتخاب کنید');
      return null;
    }
    if (parentId === selfId) throw new BadRequestException('محل نمی‌تواند والد خودش باشد');
    const parent = await this.prisma.location.findUnique({ where: { id: parentId } });
    if (!parent) throw new BadRequestException('محل والد انتخاب‌شده پیدا نشد');
    if (type === 'warehouse')
      throw new BadRequestException('انبار نمی‌تواند زیرمجموعهٔ محل دیگری باشد');
    if (type === 'basket') {
      if (parent.type === 'basket')
        throw new BadRequestException('سبد نمی‌تواند داخل سبد دیگری باشد');
      if (parent.type === 'warehouse')
        throw new BadRequestException('سبد باید داخل یک قفسه تعریف شود، نه مستقیماً داخل انبار');
      return parentId;
    }
    if (parent.type === 'basket') throw new BadRequestException('قفسه نمی‌تواند داخل سبد باشد');
    if (parent.parentId) throw new BadRequestException('والد باید یک انبار (سطح اول) باشد');
    return parentId;
  }

  /** A basket is a leaf; a shelf may only carry baskets beneath it. Moving a
   * shelf (with its baskets) between warehouses is always allowed. Structural
   * checks only run when the move could break the tree (type or parent
   * changed) — renaming a legacy row must never start failing. */
  private async assertChildren(
    id: string,
    type: string,
    previousType: string,
    parentChanged: boolean,
  ) {
    if (type === previousType && !parentChanged) return;
    const children = await this.prisma.location.findMany({
      where: { parentId: id },
      select: { type: true },
    });
    if (!children.length) return;
    if (type !== 'warehouse' && children.some((child) => child.type !== 'basket'))
      throw new BadRequestException(
        'این محل قفسه دارد و نمی‌تواند سبد شود؛ ابتدا قفسه‌های آن را منتقل یا حذف کنید',
      );
    if (type === 'basket')
      throw new BadRequestException(
        'سبد نمی‌تواند زیرمجموعه داشته باشد؛ ابتدا زیرمجموعه‌های آن را منتقل یا حذف کنید',
      );
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
