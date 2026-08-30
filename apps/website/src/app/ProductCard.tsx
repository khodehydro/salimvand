import type { ReactNode } from 'react';

/**
 * The single catalog card used by the homepage grid and every SEO landing
 * page (category, vehicle, location) so the storefront stays visually
 * consistent: image, category badge, availability state, brand chips with
 * per-brand stock, Latin product code and a play button that opens the
 * product's Aparat video. No price, ever.
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

// The public site only ever shows two states — «موجود» / «ناموجود». Low stock
// deliberately renders as plain «موجود»; scarcity stays an internal signal.
const availabilityLabels: Record<string, string> = {
  in_stock: 'موجود',
  low_stock: 'موجود',
  coming_soon: 'ناموجود',
  out_of_stock: 'ناموجود',
  discontinued: 'ناموجود',
};

/** Quick actions rendered under every catalog card: call / Telegram / Bale
 * without opening the product page. Passed down by each page from the store
 * settings so the numbers and links always match the panel. */
export type CardContact = {
  tel: string;
  telegram?: string;
  bale?: string;
};

export function ProductCard({
  product,
  heading = 'h3',
  contact,
}: {
  product: CardProduct;
  heading?: 'h2' | 'h3';
  contact?: CardContact;
}) {
  const image = product.images?.[0];
  const title: ReactNode = product.name;
  // low_stock shares the in_stock look so the badge reads simply «موجود».
  const displayAvailability =
    product.availability === 'low_stock' ? 'in_stock' : product.availability;
  // The badge no longer opens aparat.com in a new tab: it jumps to the
  // embedded player on the product page itself.
  const videoUrl = product.aparatVideoId
    ? `/product/${encodeURIComponent(product.slug)}#video`
    : '';
  return (
    <div className="product-card">
      <a className="card-link" href={`/product/${encodeURIComponent(product.slug)}`}>
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
          <span className={`status-badge ${displayAvailability}`}>
            {availabilityLabels[product.availability] ?? 'استعلام'}
          </span>
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
      {videoUrl && (
        <a
          className="video-play"
          href={videoUrl}
          aria-label={`پخش ویدئوی ${product.name}`}
          title="پخش ویدئوی این محصول"
        >
          ▶
        </a>
      )}
      {contact && (contact.tel.startsWith('tel:') || contact.telegram || contact.bale) && (
        <div className="card-quick-actions">
          {contact.tel.startsWith('tel:') && (
            <a className="quick-call" href={contact.tel} aria-label={`تماس برای ${product.name}`}>
              ☎ تماس
            </a>
          )}
          <div className="quick-row">
            {/^https?:\/\/.+/.test(contact.telegram ?? '') && (
              <a
                className="quick-telegram"
                href={contact.telegram}
                target="_blank"
                rel="noreferrer"
                aria-label={`تلگرام برای ${product.name}`}
              >
                تلگرام
              </a>
            )}
            {/^https?:\/\/.+/.test(contact.bale ?? '') && (
              <a
                className="quick-bale"
                href={contact.bale}
                target="_blank"
                rel="noreferrer"
                aria-label={`بله برای ${product.name}`}
              >
                بله
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
