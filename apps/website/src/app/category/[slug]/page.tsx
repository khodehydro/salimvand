import { LoadMoreProducts } from '../../LoadMoreProducts';
import { getCatalogPage } from '../../catalog-data';
import {
  catalogCanonicalPath,
  catalogPageNumber,
  type CatalogPage,
} from '../../catalog-pagination';
import { getStoreInfo, telHref } from '../../store-info';
import { PublicSubHeader, PublicFooter } from '../../PublicSubHeader';
import { CategorySidebar, type CategoryItem } from '../../CategorySidebar';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { formatPersianNumber } from '@salimvand/shared';
import { trackVisit } from '../../analytics';

const api = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';

type Category = CategoryItem;

async function getCategory(
  slug: string,
  page = 1,
): Promise<{ category: Category; categories: Category[]; products: CatalogPage } | null> {
  try {
    // Next may pass the param already percent-encoded for non-ASCII slugs.
    const decodedSlug = decodeURIComponent(slug);
    const filters = await fetch(`${api}/public/filters`, { next: { revalidate: 300 } });
    const data = ((await filters.json()) as { data: { categories: Category[] } }).data;
    const category = data.categories.find(
      (item) => item.slug === decodedSlug || item.slug === slug || item.id === decodedSlug,
    );
    if (!category) return null;
    const products = await getCatalogPage(
      new URLSearchParams({ categoryId: category.id, page: String(page) }),
    );
    return { category, categories: data.categories, products };
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<Metadata> {
  const page = catalogPageNumber((await searchParams).page);
  const data = await getCategory((await params).slug, page);
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
      ? {
          canonical: `${siteUrl}${catalogCanonicalPath(`/category/${encodeURIComponent(data.category.slug)}`, `page=${page}`)}`,
        }
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

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const page = catalogPageNumber((await searchParams).page);
  const data = await getCategory((await params).slug, page);
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

      <section className="catalog category-catalog-page" id="catalog">
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
              <strong>{formatPersianNumber(data.products.total)}</strong> قطعه موجود
            </span>
          </div>
        </div>

        <div className="category-layout">
          <CategorySidebar
            categories={data.categories}
            currentCategoryId={data.category.id}
            currentCategoryName={data.category.name}
            productCount={data.products.total}
          />

          <div className="category-main">
            {data.products.items.length ? (
              <LoadMoreProducts
                key={`${data.category.id}:${page}`}
                initial={data.products}
                query={new URLSearchParams({
                  categoryId: data.category.id,
                  page: String(page),
                }).toString()}
                pagePath={`/category/${encodeURIComponent(data.category.slug)}`}
                heading="h2"
                gridClassName="category-product-grid"
                contact={{ tel: telHref(info), telegram: info.telegram, bale: info.bale }}
              />
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
