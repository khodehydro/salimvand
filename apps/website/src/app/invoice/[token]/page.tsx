import type { Metadata } from 'next';
import { InvoiceDocument, InvoiceUnavailable, type PublicInvoice } from '../../InvoiceDocument';

type Props = { params: Promise<{ token: string }> };

export const metadata: Metadata = { title: 'فاکتور آنلاین | فروشگاه سلیم وند', robots: { index: false, follow: false } };

export default async function InvoicePage({ params }: Props) {
  const { token } = await params;
  const api = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';
  const siteUrl = (process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir').replace(/\/$/, '');
  let invoice: PublicInvoice | null = null;
  try {
    const response = await fetch(`${api}/public/invoices/${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (response.ok) invoice = (await response.json() as { data: PublicInvoice }).data;
  } catch {
    invoice = null;
  }
  if (!invoice) return <InvoiceUnavailable />;
  return (
    <InvoiceDocument
      invoice={invoice}
      pdfHref={`${api}/public/invoices/${encodeURIComponent(token)}/pdf`}
      shareUrl={`${siteUrl}/invoice/${encodeURIComponent(token)}`}
    />
  );
}
