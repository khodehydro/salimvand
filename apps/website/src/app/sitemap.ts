import type { MetadataRoute } from 'next';

type ProductSitemapRow = { slug: string; updatedAt: string };
type SitemapData = {
  products: ProductSitemapRow[];
  categories: ProductSitemapRow[];
  vehicles: ProductSitemapRow[];
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.PUBLIC_SITE_URL ?? process.env.APP_URL ?? 'https://salimvand.ir').replace(/\/$/, '');
  const entries: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/location/miandoab`, changeFrequency: 'weekly', priority: 0.8 },
  ];
  try {
    const api = (process.env.API_URL ?? 'https://api.salimvand.ir/api/v1').replace(/\/$/, '');
    // Revalidate hourly so Google always sees fresh product slugs;
    // if the API is down we still return the 2 static pages instead of 500.
    const response = await fetch(`${api}/public/sitemap`, {
      next: { revalidate: 3600 },
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      const body = (await response.json()) as { data: SitemapData };
      // Only include entries with a non-empty slug and avoid redirect URLs (/p/).
      // Canonical product URLs are /product/{slug}, never /p/{slug}.
      const validProducts = body.data.products.filter((p) => p.slug && p.slug.trim());
      const validCategories = body.data.categories.filter((c) => c.slug && c.slug.trim());
      const validVehicles = body.data.vehicles.filter((v) => (v as { slug?: string }).slug);

      entries.push(
        ...validProducts.map((product) => ({
          url: `${base}/product/${encodeURIComponent(product.slug)}`,
          lastModified: product.updatedAt ? new Date(product.updatedAt) : undefined,
          changeFrequency: 'weekly' as const,
          priority: 0.7,
        })),
      );
      entries.push(
        ...validCategories.map((category) => ({
          url: `${base}/category/${encodeURIComponent(category.slug)}`,
          lastModified: category.updatedAt ? new Date(category.updatedAt) : undefined,
          changeFrequency: 'weekly' as const,
          priority: 0.6,
        })),
      );
      entries.push(
        ...validVehicles.map((vehicle) => ({
          url: `${base}/vehicle/${encodeURIComponent(vehicle.slug)}`,
          changeFrequency: 'weekly' as const,
          priority: 0.6,
        })),
      );
    }
  } catch {
    // The core sitemap remains available if the API is temporarily unavailable.
  }
  // Deduplicate by URL to prevent Google from seeing the same page twice
  // (e.g. if a product and category accidentally share a slug).
  const seen = new Set<string>();
  return entries.filter((e) => {
    if (seen.has(e.url)) return false;
    seen.add(e.url);
    return true;
  });
}
