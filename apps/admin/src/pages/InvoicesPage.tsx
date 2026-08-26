import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type Invoice = { id: string; number: string; customerName?: string | null; total: string; paymentStatus: string; status: string; issuedAt: string; items: Array<{ productName: string; quantity: number }> };
const money = (value: string) => `${new Intl.NumberFormat('fa-IR').format(Number(value))} ریال`;
const labels: Record<string, string> = { paid: 'پرداخت کامل', partial: 'پرداخت ناقص', unpaid: 'پرداخت‌نشده', issued: 'صادرشده', voided: 'باطل‌شده' };

export function InvoicesPage() {
  const [rows, setRows] = useState<Invoice[]>([]); const [message, setMessage] = useState('');
  const load = () => api<{ data: Invoice[] }>('/invoices').then((result) => setRows(result.data)).catch((error: Error) => setMessage(error.message));
  useEffect(() => { void load(); }, []);
  return <section><div className="page-title"><div><h1>فاکتورها</h1><p className="muted">مدیریت فاکتورهای صادرشده و وضعیت پرداخت</p></div><span className="count">{rows.length} فاکتور</span></div>{message && <div className="notice">{message}</div>}<div className="product-table"><div className="table-head invoice-head"><span>شماره</span><span>مشتری</span><span>اقلام</span><span>مبلغ</span><span>پرداخت</span><span>عملیات</span></div>{rows.map((invoice) => <div className="table-row invoice-row" key={invoice.id}><code>{invoice.number}</code><span>{invoice.customerName ?? 'مشتری حضوری'}</span><span>{invoice.items.length}</span><strong>{money(invoice.total)}</strong><span className={invoice.paymentStatus === 'paid' ? 'status-chip' : 'low-stock'}>{labels[invoice.paymentStatus] ?? invoice.paymentStatus}</span><span>{invoice.status === 'voided' ? labels.voided : <button className="row-action" onClick={async () => { if (!window.confirm('فاکتور باطل شود؟')) return; await api(`/invoices/${invoice.id}/void`, { method: 'POST' }); await load(); }}>ابطال</button>}</span></div>)}</div></section>;
}
