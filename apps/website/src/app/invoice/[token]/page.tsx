import type { Metadata } from 'next';

type Props = { params: Promise<{ token: string }> };
export const metadata: Metadata = { title: 'فاکتور | فروشگاه سلیم وند', robots: { index: false, follow: false } };

export default async function InvoicePage({ params }: Props) {
  const { token } = await params;
  const api = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';
  let available = false;
  try { const response = await fetch(`${api}/public/invoices/${encodeURIComponent(token)}`, { next: { revalidate: 0 } }); available = response.ok; } catch { available = false; }
  return <main className="shell"><header><strong>فروشگاه سلیم وند</strong><span>آذین خودرو · میاندوآب</span></header><article className="product-page invoice-page"><p className="eyebrow">سند فروش</p><h1>{available ? 'فاکتور شما' : 'فاکتور در دسترس نیست'}</h1><p>{available ? 'جزئیات فاکتور در ادامه نمایش داده می‌شود.' : 'این لینک فاکتور معتبر نیست، منقضی شده یا هنوز صادر نشده است.'}</p><a className="contact" href="/">بازگشت به کاتالوگ</a></article></main>;
}
