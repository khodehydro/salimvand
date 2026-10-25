import { formatRial } from '@salimvand/shared';
import type { CardProduct } from '../ProductCard';
import { MiniLink } from './MiniLink';
import { MiniIcon } from './MiniIcon';

export function MiniProductCard({
  product,
  productPath,
}: {
  product: CardProduct;
  productPath: string;
}) {
  const image = product.images?.[0];
  const available = ['in_stock', 'low_stock'].includes(product.availability);
  return (
    <article className="mini-product-card">
      <MiniLink
        href={`${productPath}/${encodeURIComponent(product.slug)}`}
        label={`مشاهدهٔ ${product.name}`}
      >
        <div className="mini-card-image">
          {image ? (
            <img
              src={image.thumbnailPath ?? image.path}
              alt={image.alt || product.name}
              loading="lazy"
              decoding="async"
              width={400}
              height={400}
            />
          ) : (
            <div className="mini-no-image">
              <MiniIcon name="box" />
              <span>تصویر ثبت نشده</span>
            </div>
          )}
          <span className={`mini-stock ${available ? 'available' : ''}`}>
            {available ? 'موجود' : 'ناموجود'}
          </span>
        </div>
        <div className="mini-card-copy">
          <small>{product.category?.name || 'قطعات یدکی خودرو'}</small>
          <h2>{product.name}</h2>
          <code dir="ltr">{product.code}</code>
          <p className="mini-card-model">
            {product.compatibilities
              ?.slice(0, 1)
              .map(
                (item) =>
                  `${item.model.make.name} ${item.model.name}${item.trim?.name ? ` ${item.trim.name}` : ''}`,
              )
              .join('') || 'مشاهدهٔ مشخصات قطعه'}
          </p>
          <div className="mini-card-price">
            {product.price != null ? (
              <b>
                {(product.brands?.length ?? 0) > 1 ? 'از ' : ''}
                {formatRial(Number(product.price))}
              </b>
            ) : (
              <b>استعلام قیمت</b>
            )}
            <span aria-hidden="true">←</span>
          </div>
        </div>
      </MiniLink>
    </article>
  );
}
