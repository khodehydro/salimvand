import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

type PublicProduct = {
  slug: string;
  availabilityOverride: string | null;
  priceDisplay: string;
  inventoryItems: Array<{
    quantity: number;
    minStock: number | null;
    salePrice: bigint;
    brand: { name: string };
  }>;
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
              { seoKeywords: { has: query.q.trim() } },
              { inventoryItems: { some: { barcode: { contains: query.q, mode: 'insensitive' }, isActive: true } } },
              { inventoryItems: { some: { brand: { name: { contains: query.q, mode: 'insensitive' } }, isActive: true } } },
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
    // Site-wide master switch (settings › نمایش قیمت در سایت): when off, prices
    // stay internal unless a single product opts in with priceDisplay='show'.
    const showPrices = await this.showPrices();
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
          priceDisplay: true,
          category: { select: { name: true, slug: true } },
          images: { orderBy: { sort: 'asc' }, select: { path: true, alt: true, isPrimary: true } },
          inventoryItems: {
            where: { isActive: true },
            select: {
              quantity: true,
              minStock: true,
              salePrice: true,
              brand: { select: { name: true } },
            },
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
        price: this.publicPrice(product, showPrices),
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

  /** Cheapest active brand price, exposed only when this product's price is
   * visible under the current site-wide setting. `null` keeps the storefront
   * on its «استعلام قیمت» default. */
  private publicPrice(product: PublicProduct, showPrices: boolean): string | null {
    const visible = showPrices ? product.priceDisplay !== 'hide' : product.priceDisplay === 'show';
    if (!visible || product.inventoryItems.length === 0) return null;
    const min = product.inventoryItems.reduce(
      (lowest, item) => (item.salePrice < lowest ? item.salePrice : lowest),
      product.inventoryItems[0].salePrice,
    );
    return min.toString();
  }

  /** Reads the site-wide price display switch (store.pricing.showPrices). */
  private async showPrices(): Promise<boolean> {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: ['store.pricing'] } },
      select: { value: true },
    });
    const value = rows[0]?.value as { showPrices?: unknown } | undefined;
    return value?.showPrices === true;
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
          in: [
            'store.profile',
            'store.trust_video',
            'store.pricing',
            'integrations.telegram',
            'integrations.bale',
          ],
        },
      },
      select: { key: true, value: true },
    });
    const values = Object.fromEntries(
      rows.map((row: { key: string; value: unknown }) => [row.key, row.value]),
    );
    return {
      ok: true,
      data: {
        profile: values['store.profile'] ?? {},
        pricing: {
          showPrices:
            (values['store.pricing'] as { showPrices?: boolean } | undefined)?.showPrices === true,
        },
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
