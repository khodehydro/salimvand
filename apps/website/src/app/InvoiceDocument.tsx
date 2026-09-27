import {
  baladDirectionsUrl,
  formatPersianNumber,
  formatRial,
  normalizeDigits,
} from '@salimvand/shared';
import QRCode from 'qrcode';
import { InvoiceActions } from './InvoiceActions';
import { getStoreInfo, primaryPhone } from './store-info';

export type PublicInvoice = {
  number: string;
  customerName?: string | null;
  customerMobile?: string | null;
  customerAddress?: string | null;
  storeAddress?: string | null;
  storePhone?: string | null;
  storeLogoUrl?: string | null;
  vehicle?: string | null;
  salesPerson?: string | null;
  subtotal: string | number;
  discount: string | number;
  discountPercent?: number | null;
  total: string | number;
  /** Sum of every partial return — what the invoice shrinks by. */
  returnedTotal?: string | number;
  /** total - returnedTotal: the effective amount. */
  netTotal?: string | number;
  paidAmount?: string | number;
  paymentStatus?: string;
  paymentMethod?: string | null;
  issuedAt: string;
  linkExpiresAt?: string | null;
  payments?: Array<{
    amount: string | number;
    method: string;
    paidAt?: string | null;
    reference?: string | null;
  }>;
  items: Array<{
    productName: string;
    brand?: string;
    quantity: number;
    returnedQuantity?: number;
    discount?: string | number;
    unitPrice: string | number;
    lineTotal: string | number;
  }>;
};

const statusLabels: Record<string, string> = {
  paid: 'تسویه شده',
  partial: 'پرداخت بخشی',
  unpaid: 'پرداخت نشده',
};
const methodLabels: Record<string, string> = {
  cash: 'نقدی',
  card: 'کارت‌خوان',
  transfer: 'واریز بانکی',
  credit: 'اعتباری',
};
const money = (value: string | number) => formatRial(Number(value));
const shamsi = (value: string) =>
  new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );

export function InvoiceUnavailable() {
  return (
    <main className="invoice-shell">
      <header className="inv-band">
        <span className="brand-mark">س</span>
        <b className="inv-band-title">فروشگاه سلیم وند</b>
      </header>
      <div className="inv-w">
        <article className="inv-card invoice-empty">
          <span className="invoice-icon">!</span>
          <h1>فاکتور در دسترس نیست</h1>
          <p>این لینک معتبر نیست، منقضی شده یا فاکتور ابطال شده است.</p>
          <a className="button button-primary" href="/">
            بازگشت به کاتالوگ
          </a>
        </article>
      </div>
    </main>
  );
}

export async function InvoiceDocument({
  invoice,
  pdfHref,
  shareUrl,
}: {
  invoice: PublicInvoice;
  pdfHref: string;
  shareUrl: string;
}) {
  const paid = Number(invoice.paidAmount ?? 0);
  const returnedTotal = Number(invoice.returnedTotal ?? 0);
  const payable = Number(invoice.netTotal ?? invoice.total);
  const remaining = Math.max(0, payable - paid);
  const status = invoice.paymentStatus ?? 'unpaid';
  const qr = await QRCode.toDataURL(shareUrl, { errorCorrectionLevel: 'M', width: 260, margin: 1 });
  const expiry = invoice.linkExpiresAt ? shamsi(invoice.linkExpiresAt) : '۳۰ روز از تاریخ صدور';
  // Store contact for the bottom actions: the invoice's own store phone wins,
  // the site's primary phone is the fallback.
  const info = await getStoreInfo();
  const phone = invoice.storePhone || primaryPhone(info);
  const dialable = normalizeDigits(phone ?? '').replace(/[^0-9+]/g, '');
  const callHref = dialable ? `tel:${dialable}` : null;
  const navHref =
    info.nav.lat != null && info.nav.lng != null
      ? baladDirectionsUrl(info.nav.lat, info.nav.lng)
      : null;

  return (
    <main className="invoice-shell">
      {/* Dark brand band — header of the document */}
      <header className="inv-band">
        <a href="/" className="inv-brand">
          {invoice.storeLogoUrl ? <img className="invoice-brand-logo" src={invoice.storeLogoUrl} alt="" /> : <span className="brand-mark">س</span>}
          <span>
            <b>فروشگاه سلیم وند</b>
            <small>آذین خودرو · میاندوآب</small>
          </span>
        </a>
        <span className="inv-band-sub">فاکتور فروش آنلاین</span>
        <InvoiceActions variant="band" pdfHref={pdfHref} />
      </header>

      <div className="inv-w">
        {/* Meta card — overlaps the dark band */}
        <section className="inv-card inv-top">
          <div className="inv-top-head">
            <span className="inv-no">فاکتور شمارهٔ {formatPersianNumber(invoice.number)}</span>
            <span className={`invoice-status ${status}`}>{statusLabels[status] ?? status}</span>
          </div>
          <div className="inv-top-body">
            <div className="inv-meta">
              <div>
                <small>تاریخ صدور</small>
                <b>{shamsi(invoice.issuedAt)}</b>
              </div>
              <div>
                <small>مشتری</small>
                <b>{invoice.customerName ?? 'مشتری حضوری'}</b>
              </div>
              {invoice.customerMobile && (
                <div>
                  <small>شمارهٔ تماس</small>
                  <b dir="ltr">{formatPersianNumber(invoice.customerMobile)}</b>
                </div>
              )}
              {invoice.salesPerson && (
                <div>
                  <small>فروشنده</small>
                  <b>{invoice.salesPerson}</b>
                </div>
              )}
              {invoice.vehicle && (
                <div>
                  <small>خودرو</small>
                  <b>{invoice.vehicle}</b>
                </div>
              )}
              {invoice.storePhone && (
                <div>
                  <small>تماس فروشگاه</small>
                  <b dir="ltr">{formatPersianNumber(invoice.storePhone)}</b>
                </div>
              )}
              {invoice.storeAddress && (
                <div>
                  <small>آدرس فروشگاه</small>
                  <b>{invoice.storeAddress}</b>
                </div>
              )}
              {invoice.customerAddress && (
                <div>
                  <small>آدرس مشتری</small>
                  <b>{invoice.customerAddress}</b>
                </div>
              )}
              <div>
                <small>اعتبار لینک</small>
                <b>{expiry}</b>
              </div>
            </div>
            <div className="inv-side">
              <div className="qrbox">
                {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL, not a remote asset */}
                <img src={qr} alt="کیوآر کد فاکتور" width={96} height={96} />
              </div>
              <small>اسکن برای مشاهدهٔ فاکتور</small>
            </div>
          </div>
        </section>

        {/* Items list — its own card, fully separated from header and footer */}
        <section className="inv-card inv-items">
          <header className="inv-card-h">
            <h2>اقلام فاکتور</h2>
            <span className="inv-chip">{formatPersianNumber(invoice.items.length)} قلم</span>
          </header>
          <div className="inv-tbl">
            <div className="inv-tr inv-th">
              <span>#</span>
              <span>شرح کالا</span>
              <span>برند</span>
              <span>تعداد</span>
              <span>فی (ریال)</span>
              <span>جمع</span>
            </div>
            {invoice.items.map((item, index) => (
              <div className="inv-tr" key={`${item.productName}-${index}`}>
                <span className="inv-idx">{formatPersianNumber(index + 1)}</span>
                <strong>{item.productName}</strong>
                <span>{item.brand ? <i className="inv-brand-chip">{item.brand}</i> : '—'}</span>
                <span>
                  {formatPersianNumber(item.quantity)}
                  {item.returnedQuantity ? (
                    <small className="invoice-item-returned">
                      {' '}
                      ({formatPersianNumber(item.returnedQuantity)} برگشتی)
                    </small>
                  ) : null}
                </span>
                <span>{money(item.unitPrice)}</span>
                <b>{money(item.lineTotal)}</b>
              </div>
            ))}
          </div>
        </section>

        {/* Footer — payments + terms on the left, dark totals card on the right */}
        <div className="inv-foot">
          <div className="inv-foot-main">
            {invoice.payments?.length ? (
              <div className="pay-row">
                {invoice.payments.map((payment, index) => (
                  <div className="pay" key={`${payment.method}-${index}`}>
                    <b>{methodLabels[payment.method] ?? payment.method}</b>
                    <strong>{money(payment.amount)}</strong>
                    <small>
                      {payment.paidAt ? shamsi(payment.paidAt) : 'ثبت‌شده'}
                      {payment.reference ? ` · رسید ${formatPersianNumber(payment.reference)}` : ''}
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="pay-row">
                <div className="pay pay-none">
                  <b>پرداختی ثبت نشده است</b>
                  <small>برای تسویه با فروشگاه تماس بگیرید</small>
                </div>
              </div>
            )}
            {remaining > 0 && (
              <p className="debt-note">
                باقی‌ماندهٔ این فاکتور به‌عنوان بدهی در حساب شما ثبت شده و در فاکتور بعدی قابل تسویه
                است. برای پرداخت با فروشگاه تماس بگیرید.
              </p>
            )}
            <div className="inv-card inv-terms">
              <h3>شرایط تعویض کالا</h3>
              <p>
                کالا تا ۴۸ ساعت با ارائهٔ این فاکتور قابل تعویض است (به‌جز قطعات برقی و مصرفی). این
                صفحه فقط اطلاعات عمومی فاکتور را نشان می‌دهد و هیچ دادهٔ داخلی انبار، قیمت خرید یا
                قفسه در آن وجود ندارد.
              </p>
            </div>
          </div>
          <aside className="inv-tot">
            <div className="ln">
              <span>جمع اقلام</span>
              <b>{money(invoice.subtotal)}</b>
            </div>
            <div>
              <span>
                تخفیف فاکتور
                {Number(invoice.discountPercent ?? 0) > 0
                  ? ` (${formatPersianNumber(invoice.discountPercent ?? 0)}٪)`
                  : ''}
              </span>
              <b>− {money(invoice.discount)}</b>
            </div>
            {returnedTotal > 0 && (
              <div>
                <span>برگشتی</span>
                <b>− {money(returnedTotal)}</b>
              </div>
            )}
            <div className="ln big">
              <span>مبلغ قابل پرداخت</span>
              <b>{money(payable)}</b>
            </div>
            <div className="paid">
              <span>پرداخت‌شده</span>
              <b>{money(paid)}</b>
            </div>
            <div className="debt">
              <span>باقی‌مانده (بدهی)</span>
              <b>{money(remaining)}</b>
            </div>
          </aside>
        </div>

        <div className="inv-actions-row">
          <InvoiceActions variant="foot" pdfHref={pdfHref} copyUrl={shareUrl} />
          <small className="inv-token">
            این صفحه با توکن امن نمایش داده می‌شود و فاکتور با همین لینک قابل پیگیری است.
          </small>
        </div>

        {/* Bottom contact actions — part of the document flow: unlike the
            site's floating bars they do NOT follow the scroll, and unlike
            those they render on every screen size (mobile + desktop). */}
        {(callHref || navHref) && (
          <div className="inv-contact-actions">
            {callHref && (
              <a className="inv-contact-btn call" href={callHref}>
                <b>تماس با فروشگاه</b>
                <small dir="ltr">{formatPersianNumber(dialable)}</small>
              </a>
            )}
            {navHref && (
              <a
                className="inv-contact-btn nav"
                href={navHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                <b>مسیریابی سریع</b>
                <small>مسیر تا فروشگاه با بلد</small>
              </a>
            )}
          </div>
        )}
      </div>

      <footer className="invoice-footer">
        برای پیگیری یا پرداخت با فروشگاه سلیم وند تماس بگیرید · قیمت نهایی هنگام صدور فاکتور قطعی
        است.
      </footer>
    </main>
  );
}
