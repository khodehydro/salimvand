import type { Metadata } from 'next';
import { InvoiceDocument, InvoiceUnavailable, type PublicInvoice } from '../../InvoiceDocument';

type Props = { params: Promise<{ code: string }> };

export const metadata: Metadata = { title: 'فاکتور آنلاین | فروشگاه سلیم وند', robots: { index: false, follow: false } };

/** Short public link (`/i/<code>`) — same document, short-code endpoint. */
export default async function ShortInvoicePage({ params }: Props) {
  const { code } = await params;
  const api = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';
  const siteUrl = (process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir').replace(/\/$/, '');
  let invoice: PublicInvoice | null = null;
  try {
    const response = await fetch(`${api}/public/invoices/short/${encodeURIComponent(code)}`, { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json() as { data?: PublicInvoice }).data;
      if (data) invoice = { ...data, items: Array.isArray(data.items) ? data.items : [] };
    }
  } catch {
    invoice = null;
  }
  if (!invoice) return <InvoiceUnavailable />;
  return (
    <InvoiceDocument
      invoice={invoice}
      pdfHref={`${api}/public/invoices/short/${encodeURIComponent(code)}/pdf`}
      shareUrl={`${siteUrl}/i/${encodeURIComponent(code)}`}
    />
  );
}
