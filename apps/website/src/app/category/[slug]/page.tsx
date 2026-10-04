import { ProductCard } from '../../ProductCard';
import { getStoreInfo, telHref } from '../../store-info';
import { PublicSubHeader, PublicFooter } from '../../PublicSubHeader';
import { CategorySidebar, type CategoryItem } from '../../CategorySidebar';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { formatPersianNumber } from '@salimvand/shared';
import { trackVisit } from '../../analytics';

const api = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';

type Category = CategoryItem;

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
): Promise<{ category: Category; categories: Category[]; products: Product[] } | null> {
  try {
    // Next may pass the param already percent-encoded for non-ASCII slugs.
    const decodedSlug = decodeURIComponent(slug);
    const filters = await fetch(`${api}/public/filters`, { next: { revalidate: 300 } });
    const data = ((await filters.json()) as { data: { categories: Category[] } }).data;
    const category = data.categories.find(
      (item) => item.slug === decodedSlug || item.slug === slug || item.id === decodedSlug,
    );
    if (!category) return null;
    const products = await fetch(`${api}/public/products?categoryId=${category.id}&pageSize=60`, {
      next: { revalidate: 300 },
    });
    return {
      category,
      categories: data.categories,
      products: ((await products.json()) as { data: Product[] }).data ?? [],
    };
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
  trackVisit(`/category/${encodeURIComponent(data.category.slug)}`);

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

      <section className="catalog category-catalog-page">
        <nav className="breadcrumb">
          <a href="/">خانه</a>
          <span>←</span>
          <a href="/#catalog">دسته‌بندی‌ها</a>
          <span>←</span>
          <span>{data.category.name}</span>
        </nav>

        <div className="category-page-header">
          <div className="category-page-header-info">
            <p className="eyebrow">دسته‌بندی قطعات خودرو</p>
            <h1>{data.category.name}</h1>
            <p className="category-meta-desc">
              نمایش قطعات موجود در دسته‌بندی {data.category.name} در فروشگاه آذین خودرو میاندوآب.
            </p>
          </div>
          <div className="category-page-stats">
            <span className="category-stat-badge">
              <strong>{formatPersianNumber(data.products.length)}</strong> قطعه موجود
            </span>
          </div>
        </div>

        <div className="category-layout">
          <CategorySidebar
            categories={data.categories}
            currentCategoryId={data.category.id}
            currentCategoryName={data.category.name}
            productCount={data.products.length}
          />

          <div className="category-main">
            {data.products.length ? (
              <div className="product-grid category-product-grid">
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
              <div className="category-empty-state">
                <div className="category-empty-icon">📦</div>
                <h3>محصولی در دسته‌بندی «{data.category.name}» ثبت نشده است</h3>
                <p>
                  برای استعلام موجودی انبار یا سفارش قطعه، می‌توانید با فروشگاه تماس بگیرید یا سایر
                  دسته‌بندی‌ها را بررسی کنید.
                </p>
                <div className="category-empty-actions">
                  <a href="/#catalog" className="button button-primary">
                    مشاهدهٔ سایر قطعات
                  </a>
                  <a href={telHref(info)} className="button button-outline">
                    تماس با فروشگاه
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
