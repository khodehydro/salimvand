import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  extractAparatVideoId,
  formatRial,
  isMiniAppPlatform,
  miniAppPath,
} from '@salimvand/shared';
import { getMiniProduct } from '../../../mini-data';
import { ProductGallery } from '../../../../ProductGallery';
import { getStoreInfo, telHref } from '../../../../store-info';
import { PUBLIC_SITE_URL } from '../../../../config';
import { SmsInquiryLink } from '../../../../SmsInquiryLink';
import { MiniLink } from '../../../MiniLink';
import { MiniExternalLink } from '../../../MiniExternalLink';
import { MiniCopyButton } from '../../../MiniCopyButton';

type Props = { params: Promise<{ platform: string; slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await getMiniProduct(slug);
  return {
    title: product?.name || 'محصول پیدا نشد',
    alternates: { canonical: product ? `/product/${encodeURIComponent(product.slug)}` : '/' },
  };
}
export default async function MiniProductPage({ params }: Props) {
  const { platform, slug } = await params;
  if (!isMiniAppPlatform(platform)) notFound();
  const [product, info] = await Promise.all([getMiniProduct(slug), getStoreInfo()]);
  if (!product) notFound();
  const available = ['in_stock', 'low_stock'].includes(product.availability);
  const phone = telHref(info);
  const url = `${PUBLIC_SITE_URL}/product/${encodeURIComponent(product.slug)}`;
  const message = `سلام\n\n${product.name} (کد ${product.code}) موجود هست؟\nقیمت چنده؟\n\n${url}`;
  const videoId = extractAparatVideoId(product.aparatVideoId || '');
  return (
    <article className="mini-detail">
      <MiniLink href={miniAppPath(platform)} className="mini-breadcrumb">
        همهٔ محصولات ←
      </MiniLink>
      {product.images?.length ? (
        <ProductGallery images={product.images} productName={product.name} />
      ) : (
        <div className="mini-detail-no-image">تصویری برای این قطعه ثبت نشده است</div>
      )}
      <div className="mini-detail-title">
        <span className={`mini-stock ${available ? 'available' : ''}`}>
          {available ? 'موجود' : 'ناموجود'}
        </span>
        <small>{product.category?.name || 'قطعات یدکی خودرو'}</small>
        <h1>{product.name}</h1>
        <code dir="ltr">{product.code}</code>
      </div>
      <div className="mini-price-panel">
        <span>{product.price != null ? 'قیمت اعلام‌شده' : 'قیمت روز این قطعه'}</span>
        <b>
          {product.price != null ? formatRial(Number(product.price)) : 'برای قیمت، استعلام بگیر'}
        </b>
        {product.priceUpdatedAtJalali && <small>به‌روزرسانی: {product.priceUpdatedAtJalali}</small>}
      </div>
      <section className="mini-panel mini-inquiry" aria-label="استعلام محصول">
        <h2>همین قطعه رو می‌خوای؟</h2>
        <p>کد قطعه را به فروشگاه بگو؛ قیمت و موجودی را تأیید می‌کنیم.</p>
        <div className="mini-action-row">
          {phone.startsWith('tel:') && (
            <>
              <a className="mini-primary" href={phone}>
                تماس برای استعلام
              </a>
              <SmsInquiryLink className="mini-secondary" phone={phone} productName={product.name} />
            </>
          )}
        </div>
        <details className="mini-inquiry-message">
          <summary>متن آمادهٔ استعلام و کد قطعه</summary>
          <p>{message}</p>
          <MiniCopyButton value={message} label="کپی متن استعلام" />
        </details>
        <MiniLink href={`${miniAppPath(platform)}/contact`} className="mini-text-link">
          راه‌های ارتباط با فروشگاه ←
        </MiniLink>
        <small className="mini-muted">
          ارسال پیامک با تأیید خودت است. اگر برنامه باز نشد، از شمارهٔ صفحهٔ ارتباط با ما یا متن
          آماده استفاده کن.
        </small>
      </section>
      {product.compatibilities && product.compatibilities.length > 0 && (
        <section className="mini-panel">
          <h2>مناسب چه خودروهایی است؟</h2>
          <div className="mini-model-chips">
            {product.compatibilities.map((item, i) => (
              <span key={i}>
                {item.model.make.name} {item.model.name}
                {item.trim?.name ? ` ${item.trim.name}` : ''}
              </span>
            ))}
          </div>
        </section>
      )}
      {product.brands && product.brands.length > 0 && (
        <section className="mini-panel">
          <h2>برندهای این قطعه</h2>
          <ul className="mini-brands">
            {product.brands.map((brand, i) => (
              <li key={`${brand.name}-${i}`}>
                <b>{brand.name}</b>
                <span className={brand.inStock ? 'is-available' : ''}>
                  {brand.inStock ? 'موجود' : 'ناموجود'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(product.description || product.specs.length > 0 || product.partNumber) && (
        <section className="mini-panel">
          <h2>دربارهٔ قطعه</h2>
          {product.description && <p className="mini-description">{product.description}</p>}
          <dl className="mini-specs">
            {product.partNumber && (
              <div>
                <dt>شمارهٔ فنی</dt>
                <dd dir="ltr">{product.partNumber}</dd>
              </div>
            )}
            {product.specs.map((spec, i) => (
              <div key={i}>
                <dt>{spec.label}</dt>
                <dd>{spec.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {videoId && (
        <MiniExternalLink
          href={`https://www.aparat.com/v/${encodeURIComponent(videoId)}`}
          platform={platform}
          className="mini-secondary"
        >
          مشاهدهٔ ویدئوی بررسی محصول
        </MiniExternalLink>
      )}
      <MiniExternalLink href={url} platform={platform} className="mini-text-link">
        مشاهده در نسخهٔ وب ↗
      </MiniExternalLink>
      <p className="mini-end-note">قیمت و موجودی نهایی هنگام تأیید فروشگاه مشخص می‌شود.</p>
    </article>
  );
}
