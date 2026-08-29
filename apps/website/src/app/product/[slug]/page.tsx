import { PublicSubHeader } from '../../PublicSubHeader';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getStoreInfo, telHref } from '../../store-info';

const apiUrl = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';
const contactPhone = process.env.PUBLIC_CONTACT_PHONE ?? '';
type Product = {
  name: string;
  slug: string;
  code: string;
  description?: string;
  seoTitle?: string;
  seoDescription?: string;
  availability: string;
  brands: Array<{ name: string; inStock: boolean }>;
  images?: Array<{ path: string; thumbnailPath?: string; alt?: string }>;
  compatibilities?: Array<{
    model: { name: string; make: { name: string } };
    trim?: { name: string } | null;
  }>;
};

// The product payload comes from operator-controlled DB JSON, so its nested arrays
// cannot be trusted. Normalize them so the render never throws a 500.
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

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
  const isAvailable = product.availability === 'in_stock';
  const compatibleModels = product.compatibilities?.slice(0, 2) ?? [];
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
        <nav className="breadcrumb">
          <a href="/">خانه</a>
          <span>←</span>
          <a href="/#catalog">کاتالوگ</a>
          <span>←</span>
          <span>{product.name}</span>
        </nav>
        <div className="product-layout">
          <div className="product-gallery">
            {product.images?.length ? (
              product.images.map((image) => (
                <img
                  key={image.path}
                  src={image.path}
                  srcSet={
                    image.thumbnailPath
                      ? `${image.thumbnailPath} 400w, ${image.path} 900w`
                      : undefined
                  }
                  sizes="(max-width: 700px) 100vw, 720px"
                  alt={image.alt ?? product.name}
                />
              ))
            ) : (
              <div className="image-placeholder">تصویر محصول</div>
            )}
          </div>
          <div className="product-main">
            <p className="eyebrow">کاتالوگ قطعات خودرو</p>
            <h1>{product.name}</h1>
            <p className="code">کد محصول: {product.code}</p>
            <p>
              {product.description ??
                `برای استعلام ${product.name} با فروشگاه آذین خودرو سلیم وند تماس بگیرید.`}
            </p>
            <div className={`status ${isAvailable ? 'in_stock' : 'out_of_stock'}`}>
              <span className="status-dot" />
              {isAvailable ? 'موجود در فروشگاه' : 'استعلام موجودی'}
            </div>
            {compatibleModels.length > 0 && (
              <p className="compatibility">
                مناسب{' '}
                {compatibleModels.map((m) => `${m.model.make.name} ${m.model.name}`).join(' · ')}
              </p>
            )}
            <div className="brands-list">
              {product.brands.map((brand) => (
                <span key={brand.name} className={brand.inStock ? 'brand-in' : 'brand-out'}>
                  {brand.inStock ? '✓' : '×'} {brand.name}
                </span>
              ))}
            </div>
            <div className="product-cta">
              <a className="button button-primary button-lg" href={telHref(info)}>
                تماس برای استعلام قیمت
              </a>
              <a className="button button-outline" href={info.telegram} rel="noreferrer">
                تلگرام
              </a>
              <a className="button button-bale" href={info.bale} rel="noreferrer">
                بله
              </a>
            </div>
            <p className="price-note-inline">
              قیمت‌ها روزانه تغییر می‌کنند؛ مبلغ نهایی هنگام صدور فاکتور قطعی می‌شود.
            </p>
          </div>
        </div>
      </article>
      <a className="mobile-contact-bar" href={telHref(info)}>
        تماس سریع <span>برای استعلام قطعه</span> ←
      </a>
    </main>
  );
}
