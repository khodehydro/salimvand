import { APP_NAME, STORE_BRAND, formatPersianNumber } from '@salimvand/shared';
import { ThemeToggle } from './ThemeToggle';
import { getStoreInfo, telHref, fullMapUrl, type StoreInfo } from './store-info';

/**
 * A shared header + contact + footer block for every public landing page
 * (product, category, vehicle, location). It reads the same store meta as the
 * homepage, so the phone numbers, social IDs and map set in the admin panel
 * are applied consistently across the whole storefront.
 */
export async function PublicSubHeader({ context }: { context: string }) {
  const info = await getStoreInfo();
  return (
    <>
      <header className="sub-header">
        <a className="brand-lockup" href="/">
          <span className="brand-mark">س</span>
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

      <StoreContact info={info} />

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
  );
}

export async function StoreContact({ info }: { info?: StoreInfo }) {
  const resolved = info ?? (await getStoreInfo());
  return (
    <section className="sub-contact" id="contact">
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
          <a className="button button-outline-light" href={resolved.telegram} rel="noreferrer">
            تلگرام
          </a>
          <a className="button button-bale" href={resolved.bale} rel="noreferrer">
            بله
          </a>
        </div>
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
