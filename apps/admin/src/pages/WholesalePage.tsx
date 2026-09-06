import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatRial } from '@salimvand/shared';

type Row = { id: string; name: string; partNumber?: string | null; image?: { path: string } | null; items: Array<{ brand: string; salePrice: string; quantity: number }> };
export function WholesalePage() {
  const [rows, setRows] = useState<Row[]>([]); const [q, setQ] = useState('');
  useEffect(() => { void api<{ data: Row[] }>('/products/wholesale').then((r) => setRows(r.data)); }, []);
  const visible = rows.filter((row) => `${row.name} ${row.partNumber ?? ''} ${row.items.map((i) => i.brand).join(' ')}`.includes(q.trim()));
  return <section className="wholesale-page"><div className="page-title"><div><span className="eyebrow">ویژهٔ خریداران عمده</span><h1>لیست محصولات (عمده)</h1><p className="muted">قیمت و موجودی لحظه‌ای محصولات فروشگاه</p></div></div><input className="wholesale-search" placeholder="جست‌وجوی قطعه یا برند" value={q} onChange={(e) => setQ(e.target.value)} /><div className="wholesale-grid">{visible.map((row) => <article className="wholesale-card" key={row.id}>{row.image ? <img src={row.image.path} alt={row.name} /> : <div className="wholesale-image">قطعه</div>}<div><h3>{row.name}</h3>{row.partNumber && <small>شماره فنی: {row.partNumber}</small>}{row.items.map((item) => <div className="wholesale-item" key={item.brand}><span>{item.brand}</span><b>{formatRial(Number(item.salePrice))}</b><em className={item.quantity > 0 ? 'in-stock' : 'out-stock'}>{item.quantity > 0 ? 'موجود' : 'ناموجود'}</em></div>)}</div></article>)}</div></section>;
}
