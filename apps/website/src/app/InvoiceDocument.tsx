import { formatPersianNumber, formatRial } from '@salimvand/shared';
import QRCode from 'qrcode';

export type PublicInvoice = {
  number: string;
  customerName?: string | null;
  customerMobile?: string | null;
  vehicle?: string | null;
  salesPerson?: string | null;
  subtotal: string | number;
  discount: string | number;
  total: string | number;
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

function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== 'undefined') window.print();
      }}
    >
      چاپ
    </button>
  );
}

export function InvoiceUnavailable() {
  return (
    <main className="invoice-shell">
      <header className="invoice-header">
        <span className="brand-mark">س</span>
        <b>فروشگاه سلیم وند</b>
      </header>
      <article className="invoice-card invoice-empty">
        <span className="invoice-icon">!</span>
        <h1>فاکتور در دسترس نیست</h1>
        <p>این لینک معتبر نیست، منقضی شده یا فاکتور ابطال شده است.</p>
        <a className="button button-primary" href="/">
          بازگشت به کاتالوگ
        </a>
      </article>
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
  const remaining = Math.max(0, Number(invoice.total) - paid);
  const status = invoice.paymentStatus ?? 'unpaid';
  const qr = await QRCode.toDataURL(shareUrl, { errorCorrectionLevel: 'M', width: 260, margin: 1 });
  const expiry = invoice.linkExpiresAt ? shamsi(invoice.linkExpiresAt) : '۳۰ روز از تاریخ صدور';

  return (
    <main className="invoice-shell">
      <header className="invoice-header">
        <a href="/" className="invoice-brand">
          <span className="brand-mark">س</span>
          <span>
            <b>فروشگاه سلیم وند</b>
            <small>آذین خودرو · میاندوآب</small>
          </span>
        </a>
        <div className="invoice-actions">
          <PrintButton />
          <a href={pdfHref} target="_blank" rel="noreferrer">
            دانلود PDF
          </a>
        </div>
      </header>

      <article className="invoice-card">
        <div className="invoice-title">
          <div>
            <span className="eyebrow">سند فروش آنلاین</span>
            <h1>فاکتور {invoice.number}</h1>
            <p>تاریخ صدور: {shamsi(invoice.issuedAt)}</p>
          </div>
          <span className={`invoice-status ${status}`}>{statusLabels[status] ?? status}</span>
        </div>

        <div className="invoice-meta">
          <div>
            <small>مشتری</small>
            <b>{invoice.customerName ?? 'مشتری حضوری'}</b>
          </div>
          {invoice.customerMobile && (
            <div>
              <small>شماره تماس</small>
              <b dir="ltr">{invoice.customerMobile}</b>
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
          <div>
            <small>اعتبار لینک</small>
            <b>{expiry}</b>
          </div>
          <div className="invoice-qr">
            <small>اسکن برای مشاهدهٔ فاکتور</small>
            {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL, not a remote asset */}
            <img src={qr} alt="کیوآر کد فاکتور" width={96} height={96} />
          </div>
        </div>

        <h2 className="invoice-section-title">
          اقلام فاکتور <small>{formatPersianNumber(invoice.items.length)} قلم</small>
        </h2>
        <div className="invoice-items">
          <div className="invoice-item-head">
            <span>شرح کالا</span>
            <span>برند</span>
            <span>تعداد</span>
            <span>فی (ریال)</span>
            <span>جمع</span>
          </div>
          {invoice.items.map((item, index) => (
            <div className="invoice-item" key={`${item.productName}-${index}`}>
              <strong>{item.productName}</strong>
              <span>{item.brand ?? '—'}</span>
              <span>{formatPersianNumber(item.quantity)}</span>
              <span>{money(item.unitPrice)}</span>
              <b>{money(item.lineTotal)}</b>
            </div>
          ))}
        </div>

        {invoice.payments?.length ? (
          <div className="invoice-payments">
            {invoice.payments.map((payment, index) => (
              <div className="invoice-payment" key={`${payment.method}-${index}`}>
                <b>{methodLabels[payment.method] ?? payment.method}</b>
                <strong>{money(payment.amount)}</strong>
                <small>
                  {payment.paidAt ? shamsi(payment.paidAt) : ''}
                  {payment.reference ? ` · رسید ${payment.reference}` : ''}
                </small>
              </div>
            ))}
          </div>
        ) : null}

        <div className="invoice-summary">
          <div>
            <span>جمع اقلام</span>
            <b>{money(invoice.subtotal)}</b>
          </div>
          <div>
            <span>تخفیف</span>
            <b>− {money(invoice.discount)}</b>
          </div>
          <div className="invoice-total">
            <span>مبلغ قابل پرداخت</span>
            <strong>{money(invoice.total)}</strong>
          </div>
          <div className="invoice-paid">
            <span>پرداخت‌شده</span>
            <b>{money(paid)}</b>
          </div>
          <div className="invoice-remaining">
            <span>باقی‌مانده (بدهی)</span>
            <b>{money(remaining)}</b>
          </div>
        </div>

        {remaining > 0 && (
          <p className="invoice-debt-note">
            باقی‌ماندهٔ این فاکتور به‌عنوان بدهی در حساب شما ثبت شده و در فاکتور بعدی قابل تسویه
            است. برای پرداخت با فروشگاه تماس بگیرید.
          </p>
        )}

        <p className="invoice-note">
          شرایط: کالا تا ۴۸ ساعت با ارائهٔ این فاکتور قابل تعویض است (به‌جز قطعات برقی و مصرفی). این
          صفحه فقط اطلاعات عمومی فاکتور را نشان می‌دهد و هیچ دادهٔ داخلی انبار، قیمت خرید یا قفسه در
          آن وجود ندارد.
        </p>

        <div className="invoice-actions invoice-actions-inline">
          <PrintButton />
          <a href={pdfHref} target="_blank" rel="noreferrer">
            دانلود PDF
          </a>
        </div>
      </article>

      <footer className="invoice-footer">
        برای پیگیری یا پرداخت با فروشگاه سلیم وند تماس بگیرید · قیمت نهایی هنگام صدور فاکتور قطعی
        است.
      </footer>
    </main>
  );
}
