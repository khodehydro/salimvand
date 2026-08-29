import type { ReactNode } from 'react';

/**
 * The single catalog card used by the homepage grid and every SEO landing
 * page (category, vehicle, location) so the storefront stays visually
 * consistent: image, category badge, availability state, brand chips with
 * per-brand stock, Latin product code and a video badge when an Aparat
 * video exists. No price, ever.
 */
export type CardProduct = {
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
  images?: Array<{ path: string; thumbnailPath?: string; alt?: string }>;
  category?: { name: string };
};

const availabilityLabels: Record<string, string> = {
  in_stock: 'موجود',
  low_stock: 'موجود (کم)',
  coming_soon: 'به‌زودی',
  out_of_stock: 'ناموجود',
};

export function ProductCard({
  product,
  heading = 'h3',
}: {
  product: CardProduct;
  heading?: 'h2' | 'h3';
}) {
  const image = product.images?.[0];
  const title: ReactNode = product.name;
  return (
    <a className="product-card" href={`/product/${encodeURIComponent(product.slug)}`}>
      <div className="product-image">
        {image ? (
          <img
            src={image.thumbnailPath ?? image.path}
            srcSet={
              image.thumbnailPath ? `${image.thumbnailPath} 400w, ${image.path} 900w` : undefined
            }
            sizes="(max-width: 620px) 50vw, (max-width: 900px) 33vw, 25vw"
            alt={image.alt ?? product.name}
            loading="lazy"
          />
        ) : (
          <span>قطعه خودرو</span>
        )}
        <span className={`status-badge ${product.availability}`}>
          {availabilityLabels[product.availability] ?? 'استعلام'}
        </span>
        {product.aparatVideoId && (
          <span className="video-badge" title="ویدئوی محصول">
            ▶ ویدئو
          </span>
        )}
      </div>
      {product.category?.name && <span className="category-label">{product.category.name}</span>}
      {heading === 'h2' ? <h2>{title}</h2> : <h3>{title}</h3>}
      <p className="compatibility">
        {product.compatibilities
          ?.slice(0, 2)
          .map((item) => `${item.model.make.name} ${item.model.name}`)
          .join(' · ') || 'مناسب خودروهای داخلی'}
      </p>
      {product.brands && product.brands.length > 0 && (
        <div className="brand-list">
          {product.brands.slice(0, 4).map((brand) => (
            <span className={brand.inStock ? 'brand-in' : 'brand-out'} key={brand.name}>
              {brand.inStock ? '✓' : '×'} {brand.name}
            </span>
          ))}
        </div>
      )}
      <div className="card-footer">
        <code>{product.code}</code>
        <span>
          استعلام قیمت <b>←</b>
        </span>
      </div>
    </a>
  );
}
