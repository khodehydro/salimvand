import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class ReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async categories() {
    return {
      ok: true,
      data: await this.prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      }),
    };
  }
  async brands() {
    return {
      ok: true,
      data: await this.prisma.brand.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      }),
    };
  }
  async vehicles() {
    return {
      ok: true,
      data: await this.prisma.vehicleMake.findMany({
        include: { models: { include: { trims: true }, orderBy: { name: 'asc' } } },
        orderBy: { name: 'asc' },
      }),
    };
  }
  async adminList() {
    const [categories, brands, vehicles] = await Promise.all([
      this.prisma.category.findMany({
        orderBy: [{ sort: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { products: true } } },
      }),
      this.prisma.brand.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { inventoryItems: true } } },
      }),
      this.prisma.vehicleMake.findMany({
        include: { models: { include: { trims: true }, orderBy: { name: 'asc' } } },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { ok: true, data: { categories, brands, vehicles } };
  }

  async createCategory(input: Record<string, unknown>) {
    const name = this.text(input.name);
    const code = this.text(input.code).toUpperCase();
    if (!name || !code) throw new BadRequestException('نام و کد دسته‌بندی الزامی است');
    if (!/^[A-Z0-9_-]{2,10}$/.test(code))
      throw new BadRequestException('کد دسته باید ۲ تا ۱۰ نویسهٔ لاتین باشد');
    const slug = this.text(input.slug) || `${code.toLowerCase()}-${Date.now()}`;
    return this.unique(async () => ({
      ok: true,
      data: await this.prisma.category.create({
        data: {
          name,
          code,
          slug,
          parentId: this.optional(input.parentId),
          sort: this.integer(input.sort) ?? 0,
        },
      }),
    }));
  }

  async updateCategory(id: string, input: Record<string, unknown>) {
    await this.category(id);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = this.text(input.name);
      if (!name) throw new BadRequestException('نام دسته الزامی است');
      data.name = name;
    }
    if (input.code !== undefined) {
      const code = this.text(input.code).toUpperCase();
      if (!/^[A-Z0-9_-]{2,10}$/.test(code)) throw new BadRequestException('کد دسته معتبر نیست');
      data.code = code;
    }
    if (input.slug !== undefined) {
      const slug = this.text(input.slug);
      if (!slug) throw new BadRequestException('نشانی دسته معتبر نیست');
      data.slug = slug;
    }
    if (input.parentId !== undefined) {
      const parentId = this.optional(input.parentId);
      if (parentId === id) throw new BadRequestException('دسته نمی‌تواند والد خودش باشد');
      data.parentId = parentId;
    }
    if (input.sort !== undefined) data.sort = this.integer(input.sort) ?? 0;
    if (!Object.keys(data).length) throw new BadRequestException('تغییری ارسال نشده است');
    return this.unique(async () => ({
      ok: true,
      data: await this.prisma.category.update({ where: { id }, data }),
    }));
  }
  async setCategoryActive(id: string, isActive: boolean) {
    await this.category(id);
    return {
      ok: true,
      data: await this.prisma.category.update({ where: { id }, data: { isActive } }),
    };
  }

  async createBrand(input: Record<string, unknown>) {
    const name = this.text(input.name);
    if (!name) throw new BadRequestException('نام برند الزامی است');
    return this.unique(async () => ({
      ok: true,
      data: await this.prisma.brand.create({ data: { name } }),
    }));
  }
  async updateBrand(id: string, input: Record<string, unknown>) {
    const name = this.text(input.name);
    if (!name) throw new BadRequestException('نام برند الزامی است');
    await this.brand(id);
    return this.unique(async () => ({
      ok: true,
      data: await this.prisma.brand.update({ where: { id }, data: { name } }),
    }));
  }
  async setBrandActive(id: string, isActive: boolean) {
    await this.brand(id);
    return {
      ok: true,
      data: await this.prisma.brand.update({ where: { id }, data: { isActive } }),
    };
  }

  async createMake(input: Record<string, unknown>) {
    const name = this.text(input.name);
    if (!name) throw new BadRequestException('نام برند خودرو الزامی است');
    return this.unique(async () => ({
      ok: true,
      data: await this.prisma.vehicleMake.create({ data: { name } }),
    }));
  }
  async updateMake(id: string, input: Record<string, unknown>) {
    const name = this.text(input.name);
    if (!name) throw new BadRequestException('نام برند خودرو الزامی است');
    return this.unique(async () => ({
      ok: true,
      data: await this.prisma.vehicleMake.update({ where: { id }, data: { name } }),
    }));
  }

  async createModel(makeId: string, input: Record<string, unknown>) {
    const name = this.text(input.name);
    if (!name) throw new BadRequestException('نام مدل الزامی است');
    const make = await this.prisma.vehicleMake.findUnique({ where: { id: makeId } });
    if (!make) throw new NotFoundException('برند خودرو پیدا نشد');
    return this.unique(async () => ({
      ok: true,
      data: await this.prisma.vehicleModel.create({
        data: {
          makeId,
          name,
          productionFrom: this.integer(input.productionFrom),
          productionTo: this.integer(input.productionTo),
        },
      }),
    }));
  }
  async updateModel(id: string, input: Record<string, unknown>) {
    const name = this.text(input.name);
    if (!name) throw new BadRequestException('نام مدل الزامی است');
    return this.unique(async () => ({
      ok: true,
      data: await this.prisma.vehicleModel.update({
        where: { id },
        data: {
          name,
          productionFrom: this.integer(input.productionFrom),
          productionTo: this.integer(input.productionTo),
        },
      }),
    }));
  }

  async createTrim(modelId: string, input: Record<string, unknown>) {
    const name = this.text(input.name);
    if (!name) throw new BadRequestException('نام تیپ الزامی است');
    const model = await this.prisma.vehicleModel.findUnique({ where: { id: modelId } });
    if (!model) throw new NotFoundException('مدل خودرو پیدا نشد');
    return this.unique(async () => ({
      ok: true,
      data: await this.prisma.vehicleTrim.create({ data: { modelId, name } }),
    }));
  }
  async updateTrim(id: string, input: Record<string, unknown>) {
    const name = this.text(input.name);
    if (!name) throw new BadRequestException('نام تیپ الزامی است');
    return this.unique(async () => ({
      ok: true,
      data: await this.prisma.vehicleTrim.update({ where: { id }, data: { name } }),
    }));
  }

  private async category(id: string) {
    if (!(await this.prisma.category.findUnique({ where: { id } })))
      throw new NotFoundException('دسته‌بندی پیدا نشد');
  }
  private async brand(id: string) {
    if (!(await this.prisma.brand.findUnique({ where: { id } })))
      throw new NotFoundException('برند پیدا نشد');
  }
  private async unique<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002')
        throw new ConflictException('این نام، کد یا نشانی قبلاً ثبت شده است');
      throw error;
    }
  }
  private text(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }
  private optional(value: unknown) {
    const text = this.text(value);
    return text || null;
  }
  private integer(value: unknown) {
    const number = typeof value === 'string' && value.trim() ? Number(value) : value;
    return Number.isInteger(number) ? (number as number) : undefined;
  }
}
