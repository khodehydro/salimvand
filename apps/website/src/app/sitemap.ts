import type { MetadataRoute } from 'next';

type ProductSitemapRow = { slug: string; updatedAt: string };
type SitemapData = {
  products: ProductSitemapRow[];
  categories: ProductSitemapRow[];
  vehicles: ProductSitemapRow[];
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL ?? 'https://salimvand.ir';
  const entries: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/location/miandoab`, changeFrequency: 'weekly', priority: 0.8 },
  ];
  try {
    const api = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';
    const response = await fetch(`${api}/public/sitemap`, { next: { revalidate: 3600 } });
    if (response.ok) {
      const body = (await response.json()) as { data: SitemapData };
      entries.push(
        ...body.data.products.map((product) => ({
          url: `${base}/product/${product.slug}`,
          lastModified: new Date(product.updatedAt),
          changeFrequency: 'weekly' as const,
          priority: 0.7,
        })),
      );
      entries.push(
        ...body.data.categories.map((category) => ({
          url: `${base}/category/${category.slug}`,
          lastModified: new Date(category.updatedAt),
          changeFrequency: 'weekly' as const,
          priority: 0.6,
        })),
      );
      entries.push(
        ...body.data.vehicles.map((vehicle) => ({
          url: `${base}/vehicle/${vehicle.slug}`,
          changeFrequency: 'weekly' as const,
          priority: 0.6,
        })),
      );
    }
  } catch {
    // The core sitemap remains available if the API is temporarily unavailable.
  }
  return entries;
}
