import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

type PublicProduct = {
  slug: string;
  availabilityOverride: string | null;
  inventoryItems: Array<{ quantity: number; minStock: number | null; brand: { name: string } }>;
  images: Array<{ path: string; alt: string | null; isPrimary: boolean }>;
  [key: string]: unknown;
};

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublicProducts(query: {
    q?: string;
    categoryId?: string;
    vehicleModelId?: string;
    vehicleTrimId?: string;
    brandId?: string;
    slug?: string;
    inStock?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const where = {
      status: 'active',
      deletedAt: null,
      ...(query.slug ? { slug: query.slug } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.vehicleModelId || query.vehicleTrimId
        ? {
            compatibilities: {
              some: {
                ...(query.vehicleModelId ? { modelId: query.vehicleModelId } : {}),
                ...(query.vehicleTrimId ? { trimId: query.vehicleTrimId } : {}),
              },
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { partNumber: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.inStock || query.brandId
        ? {
            inventoryItems: {
              some: {
                ...(query.inStock ? { quantity: { gt: 0 } } : {}),
                ...(query.brandId ? { brandId: query.brandId } : {}),
                isActive: true,
              },
            },
          }
        : {}),
    };
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 24));
    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where: where as never,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          code: true,
          slug: true,
          name: true,
          description: true,
          specs: true,
          partNumber: true,
          aparatVideoId: true,
          seoTitle: true,
          seoDescription: true,
          status: true,
          availabilityOverride: true,
          category: { select: { name: true, slug: true } },
          images: { orderBy: { sort: 'asc' }, select: { path: true, alt: true, isPrimary: true } },
          inventoryItems: {
            where: { isActive: true },
            select: { quantity: true, minStock: true, brand: { select: { name: true } } },
          },
          compatibilities: {
            select: {
              model: { select: { name: true, make: { select: { name: true } } } },
              trim: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.product.count({ where: where as never }),
    ]);
    const publicProducts = products as unknown as PublicProduct[];
    return {
      ok: true,
      data: publicProducts.map((product) => ({
        ...product,
        images: product.images.map((image) => ({
          ...image,
          thumbnailPath: image.path.endsWith('/large.webp')
            ? image.path.replace(/\/large\.webp$/, '/small.webp')
            : image.path,
        })),
        availability: this.availability(product.inventoryItems, product.availabilityOverride),
        brands: product.inventoryItems.map((item) => ({
          name: item.brand.name,
          inStock: item.quantity > 0,
        })),
        inventoryItems: undefined,
      })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async getPublicProduct(slug: string) {
    const result = await this.listPublicProducts({ slug, page: 1, pageSize: 1 });
    const product = result.data[0];
    if (!product) throw new NotFoundException('محصول پیدا نشد');
    return { ok: true, data: product };
  }

  private availability(
    items: Array<{ quantity: number; minStock?: number | null }>,
    override: string | null,
  ) {
    if (override === 'coming_soon' || override === 'discontinued') return override;
    if (
      items.some(
        (item) => item.quantity > 0 && item.minStock != null && item.quantity <= item.minStock,
      )
    )
      return 'low_stock';
    return items.some((item) => item.quantity > 0) ? 'in_stock' : 'out_of_stock';
  }

  async sitemap() {
    const [products, categories] = await Promise.all([
      this.prisma.product.findMany({
        where: { status: 'active', deletedAt: null },
        select: { slug: true, updatedAt: true },
      }),
      this.prisma.category.findMany({
        where: { isActive: true },
        select: { slug: true, updatedAt: true },
      }),
    ]);
    const vehicles = await this.prisma.vehicleMake.findMany({ include: { models: true } });
    return {
      ok: true,
      data: {
        products,
        categories,
        vehicles: vehicles.flatMap(
          (make: { name: string; models: Array<{ name: string; id: string }> }) =>
            make.models.map((model) => ({
              id: model.id,
              slug: `${make.name}-${model.name}`.toLowerCase().replace(/\s+/g, '-'),
              name: `${make.name} ${model.name}`,
            })),
        ),
      },
    };
  }

  async meta() {
    const rows = await this.prisma.setting.findMany({
      where: {
        key: {
          in: ['store.profile', 'store.trust_video', 'integrations.telegram', 'integrations.bale'],
        },
      },
      select: { key: true, value: true },
    });
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return {
      ok: true,
      data: {
        profile: values['store.profile'] ?? {},
        trustVideo: values['store.trust_video'] ?? null,
        telegram: values['integrations.telegram'] ?? {},
        bale: values['integrations.bale'] ?? {},
      },
    };
  }

  async listFilters() {
    const [categories, vehicles, brands] = await Promise.all([
      this.prisma.category.findMany({
        where: { isActive: true },
        orderBy: { sort: 'asc' },
        select: { id: true, name: true, slug: true, parentId: true },
      }),
      this.prisma.vehicleMake.findMany({
        orderBy: { name: 'asc' },
        include: {
          models: { orderBy: { name: 'asc' }, include: { trims: { orderBy: { name: 'asc' } } } },
        },
      }),
      this.prisma.brand.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    ]);
    return { ok: true, data: { categories, vehicles, brands } };
  }
}
