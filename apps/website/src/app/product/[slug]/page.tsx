import { AparatVideo } from '../../AparatVideo';
import { ProductGallery } from '../../ProductGallery';
import { PublicSubHeader } from '../../PublicSubHeader';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatPersianNumber } from '@salimvand/shared';
import { getStoreInfo, telHref } from '../../store-info';

const apiUrl = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';
type Spec = { key?: string; label?: string; value?: string };
type Product = {
  name: string;
  slug: string;
  code: string;
  description?: string;
  partNumber?: string | null;
  specs?: Spec[] | Record<string, unknown> | null;
  aparatVideoId?: string | null;
  seoTitle?: string;
  seoDescription?: string;
  availability: string;
  brands: Array<{ name: string; inStock: boolean }>;
  images?: Array<{ path: string; thumbnailPath?: string; alt?: string }>;
  compatibilities?: Array<{
    model: { name: string; make: { name: string } };
    trim?: { name: string } | null;
  }>;
  category?: { name: string; slug?: string };
};

// The product payload comes from operator-controlled DB JSON, so its nested arrays
// cannot be trusted. Normalize them so the render never throws a 500.
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** The specs column is a jsonb the operator fills from the panel; be liberal. */
function normalizeSpecs(specs: unknown): Array<{ label: string; value: string }> {
  if (Array.isArray(specs)) {
    return specs
      .map((entry) => {
        const row = entry as Spec;
        const label = String(row?.label ?? row?.key ?? '').trim();
        const value = String(row?.value ?? '').trim();
        return label && value ? { label, value } : null;
      })
      .filter((entry): entry is { label: string; value: string } => entry !== null);
  }
  if (specs && typeof specs === 'object') {
    return Object.entries(specs as Record<string, unknown>)
      .map(([label, value]) => ({ label, value: String(value ?? '').trim() }))
      .filter((entry) => entry.value);
  }
  return [];
}

const availabilityLabels: Record<string, string> = {
  in_stock: 'موجود در انبار',
  low_stock: 'موجود (کم)',
  coming_soon: 'به‌زودی تأمین می‌شود',
  discontinued: 'توقف تولید',
  out_of_stock: 'ناموجود',
};

async function getProduct(slug: string): Promise<Product | null> {
  try {
    // Next may pass the param already percent-encoded for non-ASCII slugs.
    const decodedSlug = decodeURIComponent(slug);
    const response = await fetch(`${apiUrl}/public/products/${encodeURIComponent(decodedSlug)}`, {
      next: { revalidate: 300 },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: Product | null };
    const product = body.data;
    if (!product) return null;
    return {
      ...product,
      brands: asArray(product.brands),
      images: asArray(product.images),
      compatibilities: asArray(product.compatibilities),
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
  const product = await getProduct((await params).slug);
  if (!product) return { title: 'محصول پیدا نشد | فروشگاه سلیم وند' };
  return {
    title: product.seoTitle ?? `${product.name} | فروشگاه سلیم وند`,
    description:
      product.seoDescription ??
      product.description ??
      `استعلام ${product.name} از فروشگاه سلیم وند میاندوآب`,
    alternates: { canonical: `/product/${product.slug}` },
    openGraph: {
      title: product.seoTitle ?? product.name,
      description: product.seoDescription ?? product.description ?? '',
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const [product, info] = await Promise.all([getProduct((await params).slug), getStoreInfo()]);
  if (!product) notFound();
  const specs = normalizeSpecs(product.specs);
  const compatibilities = product.compatibilities ?? [];
  const inStockBrands = product.brands.filter((brand) => brand.inStock);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    sku: product.code,
    description: product.description,
    image: product.images?.map((image) => image.path),
    brand: product.brands?.length ? { '@type': 'Brand', name: product.brands[0].name } : undefined,
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'خانه', item: 'https://salimvand.ir' },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'کاتالوگ محصولات',
        item: 'https://salimvand.ir/#catalog',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: product.name,
        item: `https://salimvand.ir/product/${product.slug}`,
      },
    ],
  };
  const statusLabel = availabilityLabels[product.availability] ?? 'استعلام موجودی';
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
      <PublicSubHeader context="آذین خودرو · میاندوآب" />
      <article className="product-page">
        <nav className="breadcrumb" aria-label="مسیر صفحه">
          <a href="/">خانه</a>
          <span>←</span>
          <a href="/#catalog">کاتالوگ</a>
          {product.category?.slug && (
            <>
              <span>←</span>
              <a href={`/category/${product.category.slug}`}>{product.category.name}</a>
            </>
          )}
          <span>←</span>
          <span>{product.name}</span>
        </nav>
        <div className="product-layout">
          <div>
            {product.images && product.images.length > 0 ? (
              <ProductGallery images={product.images} productName={product.name} />
            ) : (
              <div className="image-placeholder">تصویر محصول</div>
            )}
          </div>
          <div className="product-main">
            <p className="eyebrow">{product.category?.name ?? 'کاتالوگ قطعات خودرو'}</p>
            <h1>{product.name}</h1>
            <p className="code">
              کد محصول: {product.code}
              {product.partNumber ? ` · شماره فنی: ${product.partNumber}` : ''}
            </p>
            <p className="product-description">
              {product.description ??
                `برای استعلام ${product.name} با فروشگاه آذین خودرو سلیم وند تماس بگیرید.`}
            </p>
            <div className={`status ${product.availability}`}>
              <span className="status-dot" />
              {statusLabel}
              {product.availability === 'low_stock' && inStockBrands.length > 0 && (
                <small> · {formatPersianNumber(inStockBrands.length)} برند محدود</small>
              )}
            </div>
            {compatibilities.length > 0 && (
              <div className="compat-block">
                <small>خودروهای سازگار</small>
                <div className="compat-chips">
                  {compatibilities.map((entry, index) => (
                    <span key={`${entry.model.make.name}-${entry.model.name}-${index}`}>
                      {entry.model.make.name} {entry.model.name}
                      {entry.trim ? ` · ${entry.trim.name}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {product.brands.length > 0 && (
              <div className="brands-block">
                <small>برندهای این قطعه ({formatPersianNumber(product.brands.length)} برند)</small>
                <div className="brands-list">
                  {product.brands.map((brand) => (
                    <span key={brand.name} className={brand.inStock ? 'brand-in' : 'brand-out'}>
                      {brand.inStock ? '✓' : '×'} {brand.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {specs.length > 0 && (
              <div className="specs-block">
                <small>مشخصات فنی</small>
                <dl>
                  {specs.map((spec) => (
                    <div key={spec.label}>
                      <dt>{spec.label}</dt>
                      <dd>{spec.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            <div className="product-cta">
              <a className="button button-primary button-lg" href={telHref(info)}>
                تماس برای استعلام قیمت
              </a>
              {/^https?:\/\/.+/.test(info.telegram) && (
                <a className="button button-outline" href={info.telegram} rel="noreferrer">
                  تلگرام
                </a>
              )}
              {/^https?:\/\/.+/.test(info.bale) && (
                <a className="button button-bale" href={info.bale} rel="noreferrer">
                  بله
                </a>
              )}
            </div>
            <p className="price-note-inline">
              قیمت‌ها روزانه تغییر می‌کنند؛ مبلغ نهایی هنگام صدور فاکتور قطعی می‌شود.
            </p>
          </div>
        </div>
        {product.aparatVideoId && (
          <AparatVideo videoId={product.aparatVideoId} title={`ویدئو: ${product.name}`} />
        )}
      </article>
      <a className="mobile-contact-bar" href={telHref(info)}>
        تماس سریع <span>برای استعلام قطعه</span> ←
      </a>
    </main>
  );
}
