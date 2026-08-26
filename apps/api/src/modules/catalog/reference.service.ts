import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class ReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async categories() { return { ok: true, data: await this.prisma.category.findMany({ where: { isActive: true }, orderBy: { sort: 'asc' } }) }; }
  async brands() { return { ok: true, data: await this.prisma.brand.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }) }; }
  async vehicles() { return { ok: true, data: await this.prisma.vehicleMake.findMany({ include: { models: { include: { trims: true } } }, orderBy: { name: 'asc' } }) }; }

  async createCategory(input: Record<string, unknown>) {
    const name = this.text(input.name); const code = this.text(input.code).toUpperCase();
    if (!name || !code) throw new BadRequestException('نام و کد دسته‌بندی الزامی است');
    const slug = this.text(input.slug) || `${code.toLowerCase()}-${Date.now()}`;
    return { ok: true, data: await this.prisma.category.create({ data: { name, code, slug, parentId: this.optional(input.parentId), sort: Number(input.sort ?? 0) } }) };
  }

  async createBrand(input: Record<string, unknown>) {
    const name = this.text(input.name); if (!name) throw new BadRequestException('نام برند الزامی است');
    return { ok: true, data: await this.prisma.brand.create({ data: { name } }) };
  }

  async createMake(input: Record<string, unknown>) {
    const name = this.text(input.name); if (!name) throw new BadRequestException('نام برند خودرو الزامی است');
    return { ok: true, data: await this.prisma.vehicleMake.create({ data: { name } }) };
  }

  async createModel(makeId: string, input: Record<string, unknown>) {
    const name = this.text(input.name); if (!name) throw new BadRequestException('نام مدل الزامی است');
    const make = await this.prisma.vehicleMake.findUnique({ where: { id: makeId } }); if (!make) throw new NotFoundException('برند خودرو پیدا نشد');
    return { ok: true, data: await this.prisma.vehicleModel.create({ data: { makeId, name, productionFrom: this.integer(input.productionFrom), productionTo: this.integer(input.productionTo) } }) };
  }

  async createTrim(modelId: string, input: Record<string, unknown>) {
    const name = this.text(input.name); if (!name) throw new BadRequestException('نام تیپ الزامی است');
    return { ok: true, data: await this.prisma.vehicleTrim.create({ data: { modelId, name } }) };
  }

  private text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
  private optional(value: unknown) { const text = this.text(value); return text || null; }
  private integer(value: unknown) { return Number.isInteger(value) ? value as number : undefined; }
}
