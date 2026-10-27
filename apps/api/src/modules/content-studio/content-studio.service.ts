import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { STUDIO_MAX_PRODUCTS, STORE_BRAND, type StudioSnapshot } from '@salimvand/shared';
import { PrismaService } from '../../prisma.service';
import { StudioSnapshotDto } from './content-studio.dto';
const text = (v: unknown, max = 160) =>
  typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
export function studioMedia(v: unknown): string {
  const path = text(v, 500);
  return /^\/uploads\/[A-Za-z0-9_./-]+$/.test(path) && !path.includes('..') ? path : '';
}
function social(v: unknown) {
  const link = text(object(v).link);
  return /^https?:\/\//i.test(link) ? link : '';
}
export function studioDescendants(
  id: string,
  categories: { id: string; parentId: string | null }[],
) {
  const found = new Set([id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const category of categories)
      if (category.parentId && found.has(category.parentId) && !found.has(category.id)) {
        found.add(category.id);
        changed = true;
      }
  }
  return [...found];
}
@Injectable()
export class ContentStudioService {
  constructor(private readonly prisma: PrismaService) {}
  async options() {
    const [categories, vehicles, brands] = await Promise.all([
      this.prisma.category.findMany({
        where: { isActive: true },
        select: { id: true, name: true, parentId: true },
        orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.vehicleModel.findMany({
        select: { id: true, name: true, make: { select: { id: true, name: true } } },
        orderBy: [{ make: { name: 'asc' } }, { name: 'asc' }],
      }),
      this.prisma.brand.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { categories, vehicles, brands };
  }
  async snapshot(input: StudioSnapshotDto): Promise<StudioSnapshot> {
    const where: Prisma.ProductWhereInput = {
      status: 'active',
      deletedAt: null,
      category: { isActive: true },
    };
    if (input.categoryId) {
      const categories = await this.prisma.category.findMany({
        where: { isActive: true },
        select: { id: true, parentId: true },
      });
      if (!categories.some((c) => c.id === input.categoryId))
        throw new BadRequestException('دسته‌بندی انتخاب‌شده موجود نیست');
      where.categoryId = { in: studioDescendants(input.categoryId, categories) };
    }
    if (input.vehicleModelId || input.vehicleMakeId)
      where.compatibilities = {
        some: {
          ...(input.vehicleModelId ? { modelId: input.vehicleModelId } : {}),
          ...(input.vehicleMakeId ? { model: { makeId: input.vehicleMakeId } } : {}),
        },
      };
    if (input.productIds) {
      if (!input.productIds.length) throw new BadRequestException('حداقل یک محصول انتخاب کنید');
      where.id = { in: input.productIds };
    }
    if (input.q?.trim())
      where.OR = ['name', 'code', 'partNumber'].map((key) => ({
        [key]: { contains: input.q!.trim(), mode: 'insensitive' },
      }));
    const itemsWhere: Prisma.InventoryItemWhereInput = {
      isActive: true,
      ...(input.brandId
        ? { brandId: input.brandId, brand: { isActive: true } }
        : { OR: [{ brandId: null }, { brand: { isActive: true } }] }),
    };
    if (input.inStock) where.availabilityOverride = null;
    if (input.brandId || input.inStock)
      where.inventoryItems = {
        some: { ...itemsWhere, ...(input.inStock ? { quantity: { gt: 0 } } : {}) },
      };
    const products = await this.prisma.product.findMany({
      where,
      take: STUDIO_MAX_PRODUCTS + 1,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        code: true,
        availabilityOverride: true,
        category: { select: { name: true } },
        images: {
          take: 1,
          orderBy: [{ isPrimary: 'desc' }, { sort: 'asc' }],
          select: { path: true },
        },
        compatibilities: {
          take: 12,
          select: {
            model: { select: { name: true, make: { select: { name: true } } } },
            trim: { select: { name: true } },
          },
        },
        inventoryItems: {
          where: itemsWhere,
          select: {
            id: true,
            quantity: true,
            ...(input.showPrices === true ? { salePrice: true } : {}),
            brand: { select: { name: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (products.length > STUDIO_MAX_PRODUCTS)
      throw new BadRequestException(
        'بیش از ۳۰۰ محصول پیدا شد؛ دسته‌بندی، خودرو یا عبارت جست‌وجو را محدودتر کنید',
      );
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: ['store.profile', 'integrations.telegram', 'integrations.bale'] } },
      select: { key: true, value: true },
    });
    const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const profile = object(settings['store.profile']);
    return {
      capturedAt: new Date().toISOString(),
      branding: {
        name: text(profile.name) || STORE_BRAND,
        logo: studioMedia(profile.logoUrl) || studioMedia(profile.faviconUrl),
        phones: text(profile.phones),
        address: text(profile.address),
        website: text(process.env.PUBLIC_SITE_URL) || 'https://salimvand.ir',
        telegram: social(settings['integrations.telegram']),
        bale: social(settings['integrations.bale']),
      },
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        image: studioMedia(p.images[0]?.path),
        category: p.category.name,
        vehicles: [
          ...new Set(
            p.compatibilities.map(
              (c) => `${c.model.make.name} ${c.model.name}${c.trim ? ` ${c.trim.name}` : ''}`,
            ),
          ),
        ],
        available: !p.availabilityOverride && p.inventoryItems.some((i) => i.quantity > 0),
        variants: p.inventoryItems.map((i) => ({
          id: i.id,
          name: i.brand?.name || 'بدون برند',
          available: !p.availabilityOverride && i.quantity > 0,
          price:
            input.showPrices === true && i.salePrice != null && BigInt(i.salePrice) > 0n
              ? String(i.salePrice)
              : null,
        })),
      })),
    };
  }
}
