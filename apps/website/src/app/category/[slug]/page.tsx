import { ProductCard } from '../../ProductCard';
import { getStoreInfo, telHref } from '../../store-info';
import { PublicSubHeader } from '../../PublicSubHeader';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
const api = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';
type Category = { id: string; name: string; slug: string };
type Product = {
  slug: string;
  name: string;
  code: string;
  availability: string;
  aparatVideoId?: string | null;
  brands?: Array<{ name: string; inStock: boolean }>;
  compatibilities?: Array<{
    model: { name: string; make: { name: string } };
    trim?: { name: string } | null;
  }>;
  images: Array<{ path: string; thumbnailPath?: string; alt?: string }>;
  category: { name: string };
};
async function getCategory(
  slug: string,
): Promise<{ category: Category; products: Product[] } | null> {
  try {
    // Next may pass the param already percent-encoded for non-ASCII slugs.
    const decodedSlug = decodeURIComponent(slug);
    const filters = await fetch(`${api}/public/filters`, { next: { revalidate: 300 } });
    const data = ((await filters.json()) as { data: { categories: Category[] } }).data;
    const category = data.categories.find((item) => item.slug === decodedSlug);
    if (!category) return null;
    const products = await fetch(`${api}/public/products?categoryId=${category.id}`, {
      next: { revalidate: 300 },
    });
    return { category, products: ((await products.json()) as { data: Product[] }).data };
  } catch {
    return null;
  }
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const data = await getCategory((await params).slug);
  const siteUrl = (process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir').replace(/\/$/, '');
  return {
    title: data ? data.category.name : 'دسته‌بندی پیدا نشد',
    description: data
      ? `خرید و استعلام قیمت ${data.category.name} و قطعات خودرو از فروشگاه سلیم وند در میاندوآب.`
      : undefined,
    keywords: data
      ? [data.category.name, `لوازم یدکی ${data.category.name}`, 'قطعات خودرو میاندوآب']
      : undefined,
    alternates: data
      ? { canonical: `${siteUrl}/category/${encodeURIComponent(data.category.slug)}` }
      : undefined,
    openGraph: data
      ? {
          type: 'website',
          title: data.category.name,
          description: `کاتالوگ ${data.category.name} و قطعات خودرو`,
          url: `${siteUrl}/category/${encodeURIComponent(data.category.slug)}`,
        }
      : undefined,
  };
}
export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const data = await getCategory((await params).slug);
  const info = await getStoreInfo();
  if (!data) notFound();
  const siteUrl = (process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir').replace(/\/$/, '');
  const canonicalUrl = `${siteUrl}/category/${encodeURIComponent(data.category.slug)}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: data.category.name,
    url: canonicalUrl,
    isPartOf: { '@type': 'WebSite', name: 'فروشگاه سلیم وند', url: siteUrl },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'خانه', item: siteUrl },
      {
        '@type': 'ListItem',
        position: 2,
        name: data.category.name,
        item: canonicalUrl,
      },
    ],
  };
  return (
    <main className="shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      <PublicSubHeader context="کاتالوگ قطعات خودرو" />
      <section className="catalog">
        <nav className="breadcrumb">
          <a href="/">خانه</a>
          <span>←</span>
          <span>{data.category.name}</span>
        </nav>
        <p className="eyebrow">دسته‌بندی محصولات</p>
        <h1>{data.category.name}</h1>
        {data.products.length ? (
          <div className="product-grid">
            {data.products.map((product) => (
              <ProductCard
                key={product.slug}
                product={product}
                heading="h2"
                contact={{ tel: telHref(info), telegram: info.telegram, bale: info.bale }}
              />
            ))}
          </div>
        ) : (
          <div className="placeholder">محصولی در این دسته‌بندی ثبت نشده است.</div>
        )}
      </section>
    </main>
  );
}
