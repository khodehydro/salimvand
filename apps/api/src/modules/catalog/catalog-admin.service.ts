import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { buildProductSeo } from '@salimvand/shared';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class CatalogAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const products = await this.prisma.product.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, include: { category: true, inventoryItems: { include: { brand: true, location: true } } } });
    return { ok: true, data: products };
  }

  async get(id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null }, include: { category: true, images: true, compatibilities: { include: { model: { include: { make: true } }, trim: true } }, inventoryItems: { include: { brand: true, location: true } } } });
    if (!product) throw new NotFoundException('محصول پیدا نشد');
    return { ok: true, data: product };
  }

  async create(input: Record<string, unknown>) {
    const name = this.stringValue(input.name);
    const categoryId = this.stringValue(input.categoryId);
    if (!name || !categoryId) throw new BadRequestException('نام محصول و دسته‌بندی الزامی است');
    const code = await this.nextCode('product');
    const seo = buildProductSeo({ name, slug: this.optionalString(input.slug) ?? undefined });
    const product = await this.prisma.product.create({ data: { name, categoryId, code, ...seo, seoTitle: this.optionalString(input.seoTitle) ?? seo.seoTitle, seoDescription: this.optionalString(input.seoDescription) ?? seo.seoDescription, description: this.optionalString(input.description), partNumber: this.optionalString(input.partNumber) } });
    return { ok: true, data: product };
  }

  async update(id: string, input: Record<string, unknown>) {
    await this.ensureExists(id);
    const data: Record<string, unknown> = {};
    for (const key of ['name', 'description', 'partNumber', 'categoryId', 'slug', 'seoTitle', 'seoDescription', 'seoKeywords']) if (input[key] !== undefined) data[key] = input[key];
    if (typeof input.name === 'string' && input.name.trim()) {
      const seo = buildProductSeo({ name: input.name, slug: typeof input.slug === 'string' ? input.slug : undefined });
      for (const key of ['slug', 'seoTitle', 'seoDescription', 'seoKeywords']) if (data[key] === undefined) data[key] = seo[key as keyof typeof seo];
    } else if (typeof input.slug === 'string' && input.slug.trim()) data.slug = input.slug.trim();
    const product = await this.prisma.product.update({ where: { id }, data });
    return { ok: true, data: product };
  }

  async softDelete(id: string) { await this.ensureExists(id); await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date(), status: 'hidden' } }); return { ok: true, data: { id } }; }
  async restore(id: string) { await this.ensureExists(id, true); const product = await this.prisma.product.update({ where: { id }, data: { deletedAt: null, status: 'active' } }); return { ok: true, data: product }; }

  private async ensureExists(id: string, deleted = false) {
    const product = await this.prisma.product.findFirst({ where: { id, ...(deleted ? {} : { deletedAt: null }) } });
    if (!product) throw new NotFoundException('محصول پیدا نشد');
  }
  private async nextCode(prefix: string) { const counter = await this.prisma.counter.upsert({ where: { key: prefix }, update: { lastValue: { increment: 1 } }, create: { key: prefix, lastValue: 1 } }); return `${prefix.toUpperCase()}-${String(counter.lastValue).padStart(5, '0')}`; }
  private stringValue(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
  private optionalString(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
}
