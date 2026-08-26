import type { Metadata } from 'next';

type Props = { params: Promise<{ token: string }> };
type Invoice = { number: string; customerName?: string | null; total: string | number; subtotal: string | number; discount: string | number; issuedAt: string; items: Array<{ productName: string; quantity: number; unitPrice: string | number; lineTotal: string | number }> };
export const metadata: Metadata = { title: 'فاکتور | فروشگاه سلیم وند', robots: { index: false, follow: false } };
const money = (value: string | number) => `${new Intl.NumberFormat('fa-IR').format(Number(value))} ریال`;

export default async function InvoicePage({ params }: Props) {
  const { token } = await params;
  const api = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';
  let invoice: Invoice | null = null;
  try { const response = await fetch(`${api}/public/invoices/${encodeURIComponent(token)}`, { cache: 'no-store' }); if (response.ok) invoice = (await response.json() as { data: Invoice }).data; } catch { invoice = null; }
  return <main className="shell"><header><strong>فروشگاه سلیم وند</strong><span>آذین خودرو · میاندوآب</span></header>{invoice ? <article className="product-page invoice-page"><p className="eyebrow">سند فروش</p><h1>فاکتور {invoice.number}</h1><p>{invoice.customerName ? `مشتری: ${invoice.customerName}` : 'فاکتور فروش فروشگاه آذین خودرو سلیم وند'}</p><div className="product-table">{invoice.items.map((item) => <div className="table-row" key={`${item.productName}-${item.lineTotal}`}><strong>{item.productName}</strong><span>{new Intl.NumberFormat('fa-IR').format(item.quantity)} عدد</span><span>{money(item.unitPrice)}</span><b>{money(item.lineTotal)}</b></div>)}</div><p>جمع جزء: {money(invoice.subtotal)}</p><p>تخفیف: {money(invoice.discount)}</p><h2>مبلغ نهایی: {money(invoice.total)}</h2><small>تاریخ صدور: {new Intl.DateTimeFormat('fa-IR').format(new Date(invoice.issuedAt))}</small></article> : <article className="product-page invoice-page"><p className="eyebrow">سند فروش</p><h1>فاکتور در دسترس نیست</h1><p>این لینک فاکتور معتبر نیست، منقضی شده یا هنوز صادر نشده است.</p></article>}<a className="contact" href="/">بازگشت به کاتالوگ</a></main>;
}
