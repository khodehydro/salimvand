import { APP_NAME, STORE_BRAND, formatPersianNumber } from '@salimvand/shared';
import { ThemeToggle } from './ThemeToggle';
import { getStoreInfo, telHref, fullMapUrl, type StoreInfo } from './store-info';

/**
 * A shared header + contact + footer block for every public landing page
 * (product, category, vehicle, location). It reads the same store meta as the
 * homepage, so the phone numbers, social IDs and map set in the admin panel
 * are applied consistently across the whole storefront.
 *
 * `showContact={false}` renders only the slim header — used on the product
 * page, where the big contact/footer block must not sit above the product.
 */
export async function PublicSubHeader({
  context,
  showContact = true,
}: {
  context: string;
  showContact?: boolean;
}) {
  const info = await getStoreInfo();
  return (
    <>
      <header className="sub-header">
        <a className="brand-lockup" href="/">
          {info.logoUrl ? (
            <img className="brand-logo" src={info.logoUrl} alt={info.name} />
          ) : (
            <span className="brand-mark">س</span>
          )}
          <span>
            <strong>{APP_NAME}</strong>
            <small>{context}</small>
          </span>
        </a>
        <nav>
          <a href="/#catalog">کاتالوگ</a>
          <a href="/#contact">تماس</a>
          <ThemeToggle />
        </nav>
      </header>

      {showContact && (
        <>
          <StoreContact info={info} variant="sub" />

          <footer className="sub-footer">
            <span>
              © {formatPersianNumber(new Date().getFullYear())} {STORE_BRAND}
            </span>
            <nav aria-label="پیوندهای تکراری">
              <a href="/#catalog">کاتالوگ</a>
              <a href="/#video">ویدئوی فروشگاه</a>
              <a href="/#contact">تماس و آدرس</a>
            </nav>
          </footer>
        </>
      )}
    </>
  );
}

/**
 * Store contact + map block shared by the homepage (navy `contact-section`
 * variant with the price-fluctuation note) and the landing pages (compact
 * `sub-contact` variant). Every field comes from the admin settings through
 * /public/meta, so the operator-controlled phones, social IDs, working hours
 * and Google map embed code are applied on every page.
 */
export async function StoreContact({
  info,
  variant = 'sub',
}: {
  info?: StoreInfo;
  variant?: 'home' | 'sub';
}) {
  const resolved = info ?? (await getStoreInfo());
  const hasTelegram = /^https?:\/\//i.test(resolved.telegram);
  const hasBale = /^https?:\/\//i.test(resolved.bale);
  return (
    <section className={variant === 'home' ? 'contact-section' : 'sub-contact'} id="contact">
      <div className="sub-contact-copy">
        <span className="eyebrow">آذین خودرو · میاندوآب</span>
        <h2>استعلام قیمت و موجودی</h2>
        <p>
          برای اطلاع از قیمت روز و موجودی قطعات با فروشگاه تماس بگیرید یا از پیام‌رسان‌ها سؤال کنید.
        </p>
        <div className="contact-actions">
          <a className="button button-light" href={telHref(resolved)}>
            تماس با فروشگاه
          </a>
          {hasTelegram && (
            <a className="button button-telegram" href={resolved.telegram} rel="noreferrer">
              تلگرام
            </a>
          )}
          {hasBale && (
            <a className="button button-bale" href={resolved.bale} rel="noreferrer">
              بله
            </a>
          )}
        </div>
        {variant === 'home' && (
          <p className="contact-price-note">
            قیمت‌ها به‌دلیل نوسان روزانهٔ بازار فقط تلفنی اعلام می‌شود؛ مبلغ نهایی هنگام صدور فاکتور
            قطعی است.
          </p>
        )}
      </div>
      <div className="contact-details">
        <div className="contact-list">
          {resolved.address && (
            <div>
              <small>آدرس فروشگاه</small>
              <b>{resolved.address}</b>
            </div>
          )}
          <div>
            <small>ساعات کاری</small>
            <b>{resolved.workingHours}</b>
          </div>
          {resolved.phones.length > 0 && (
            <div>
              <small>تلفن تماس</small>
              <b dir="ltr">{resolved.phones.join('، ')}</b>
            </div>
          )}
          <div>
            <small>ارسال شهرستان</small>
            <b>باربری و پست پیشتاز</b>
          </div>
        </div>
        <div className="map-embed">
          <iframe
            title="نقشهٔ موقعیت فروشگاه"
            src={fullMapUrl(resolved.mapUrl, resolved.mapCode)}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </div>
    </section>
  );
}
