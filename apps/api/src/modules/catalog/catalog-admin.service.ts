import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { buildProductSeo } from '@salimvand/shared';
import { PrismaService } from '../../prisma.service';
import { Prisma } from '@prisma/client';
import { writeAudit } from '../../common/audit/audit-log';

@Injectable()
export class CatalogAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { category: true, inventoryItems: { include: { brand: true, location: true } } },
    });
    return { ok: true, data: products };
  }

  async get(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        category: true,
        images: true,
        compatibilities: { include: { model: { include: { make: true } }, trim: true } },
        inventoryItems: { include: { brand: true, location: true } },
      },
    });
    if (!product) throw new NotFoundException('محصول پیدا نشد');
    return { ok: true, data: product };
  }

  async create(input: Record<string, unknown>, userId?: string, ip?: string) {
    const name = this.stringValue(input.name);
    const categoryId = this.stringValue(input.categoryId);
    if (!name || !categoryId) throw new BadRequestException('نام محصول و دسته‌بندی الزامی است');
    const code = await this.nextCode('product');
    const seo = buildProductSeo({ name, slug: this.optionalString(input.slug) ?? undefined });
    const createProduct = async (tx: Prisma.TransactionClient | typeof this.prisma) => {
      const created = await tx.product.create({
        data: {
          name,
          categoryId,
          code,
          ...seo,
          seoTitle: this.optionalString(input.seoTitle) ?? seo.seoTitle,
          seoDescription: this.optionalString(input.seoDescription) ?? seo.seoDescription,
          description: this.optionalString(input.description),
          partNumber: this.optionalString(input.partNumber),
          aparatVideoId: this.optionalString(input.aparatVideoId),
          status: input.status === 'hidden' ? 'hidden' : 'active',
          priceDisplay: this.priceDisplayValue(input.priceDisplay) ?? 'inherit',
          seoKeywords: this.stringArray(input.seoKeywords) ?? seo.seoKeywords,
        },
      });
      if (userId && 'auditLog' in tx)
        await writeAudit(tx as Prisma.TransactionClient, {
          userId,
          ip,
          action: 'create',
          entityType: 'product',
          entityId: created.id,
          after: { name: created.name, code: created.code },
        });
      return created;
    };
    const product = this.prisma.$transaction
      ? await this.prisma.$transaction(createProduct)
      : await createProduct(this.prisma);
    return { ok: true, data: product };
  }

  async update(id: string, input: Record<string, unknown>, userId?: string, ip?: string) {
    await this.ensureExists(id);
    const data: Record<string, unknown> = {};
    for (const key of [
      'name',
      'description',
      'partNumber',
      'categoryId',
      'slug',
      'seoTitle',
      'seoDescription',
      'aparatVideoId',
    ])
      if (input[key] !== undefined) data[key] = input[key];
    const keywords = this.stringArray(input.seoKeywords);
    if (keywords) data.seoKeywords = keywords;
    // Storefront price visibility: 'inherit' follows the site-wide switch,
    // 'show'/'hide' override it for this one product.
    if (input.priceDisplay !== undefined)
      data.priceDisplay = this.priceDisplayValue(input.priceDisplay) ?? 'inherit';
    // status is an enum column: anything but the two known values must be rejected, not stored.
    if (input.status !== undefined) {
      if (input.status !== 'active' && input.status !== 'hidden')
        throw new BadRequestException('وضعیت محصول باید active یا hidden باشد');
      data.status = input.status;
    }
    if (typeof input.name === 'string' && input.name.trim()) {
      const seo = buildProductSeo({
        name: input.name,
        slug: typeof input.slug === 'string' ? input.slug : undefined,
      });
      for (const key of ['slug', 'seoTitle', 'seoDescription', 'seoKeywords'])
        if (data[key] === undefined) data[key] = seo[key as keyof typeof seo];
    } else if (typeof input.slug === 'string' && input.slug.trim()) data.slug = input.slug.trim();
    const before = this.prisma.product.findUnique
      ? await this.prisma.product.findUnique({ where: { id } })
      : await this.prisma.product.findFirst({ where: { id } });
    const updateProduct = async (tx: Prisma.TransactionClient | typeof this.prisma) => {
      const updated = await tx.product.update({ where: { id }, data });
      if (userId && 'auditLog' in tx)
        await writeAudit(tx as Prisma.TransactionClient, {
          userId,
          ip,
          action: 'update',
          entityType: 'product',
          entityId: id,
          before: before ? { name: before.name, status: before.status } : undefined,
          after: { name: updated.name, status: updated.status },
        });
      return updated;
    };
    const product = this.prisma.$transaction
      ? await this.prisma.$transaction(updateProduct)
      : await updateProduct(this.prisma);
    return { ok: true, data: product };
  }

  async softDelete(id: string, userId?: string, ip?: string) {
    await this.ensureExists(id);
    const product = await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'hidden' },
    });
    if (userId)
      await this.prisma.auditLog.create({
        data: {
          userId,
          ip,
          action: 'delete',
          entityType: 'product',
          entityId: id,
          after: { status: 'hidden' },
        },
      });
    return { ok: true, data: { id, deletedAt: product.deletedAt } };
  }
  async restore(id: string, userId?: string, ip?: string) {
    await this.ensureExists(id, true);
    const product = await this.prisma.product.update({
      where: { id },
      data: { deletedAt: null, status: 'active' },
    });
    if (userId)
      await this.prisma.auditLog.create({
        data: {
          userId,
          ip,
          action: 'restore',
          entityType: 'product',
          entityId: id,
          after: { status: 'active' },
        },
      });
    return { ok: true, data: product };
  }

  private async ensureExists(id: string, deleted = false) {
    const product = await this.prisma.product.findFirst({
      where: { id, ...(deleted ? {} : { deletedAt: null }) },
    });
    if (!product) throw new NotFoundException('محصول پیدا نشد');
  }
  private async nextCode(prefix: string) {
    const counter = await this.prisma.counter.upsert({
      where: { key: prefix },
      update: { lastValue: { increment: 1 } },
      create: { key: prefix, lastValue: 1 },
    });
    return `${prefix.toUpperCase()}-${String(counter.lastValue).padStart(5, '0')}`;
  }
  private priceDisplayValue(value: unknown): 'inherit' | 'show' | 'hide' | null {
    if (value === undefined || value === null || value === '') return null;
    if (value === 'inherit' || value === 'show' || value === 'hide') return value;
    throw new BadRequestException('نمایش قیمت باید inherit، show یا hide باشد');
  }

  private stringValue(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }
  private optionalString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private stringArray(value: unknown) {
    if (!Array.isArray(value)) return null;
    const items = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return items.length ? items : null;
  }
}
