import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { formatRial } from '@salimvand/shared';

type Row = { id: string; name: string; image?: { path: string } | null; category: { id: string; name: string }; vehicles: string[]; price: string };
export function WholesalePage() {
  const [rows, setRows] = useState<Row[]>([]); const [q, setQ] = useState(''); const [category, setCategory] = useState(''); const [vehicle, setVehicle] = useState('');
  useEffect(() => { void api<{ data: Row[] }>('/products/wholesale').then((r) => setRows(r.data)); }, []);
  const categories = useMemo(() => [...new Map(rows.map((row) => [row.category.id, row.category])).values()], [rows]);
  const vehicles = useMemo(() => [...new Set(rows.flatMap((row) => row.vehicles))].sort(), [rows]);
  const visible = rows.filter((row) => (!q.trim() || row.name.includes(q.trim())) && (!category || row.category.id === category) && (!vehicle || row.vehicles.includes(vehicle)));
  return <section className="wholesale-page"><div className="page-title"><div><span className="eyebrow">ویژهٔ خریداران عمده</span><h1>لیست محصولات (عمده)</h1><p className="muted">نام، تصویر و قیمت محصولات</p></div></div><div className="wholesale-filters"><input placeholder="جست‌وجوی نام قطعه" value={q} onChange={(e) => setQ(e.target.value)} /><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">همه دسته‌ها</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={vehicle} onChange={(e) => setVehicle(e.target.value)}><option value="">همه خودروها</option>{vehicles.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div className="wholesale-grid">{visible.map((row) => <article className="wholesale-card" key={row.id}>{row.image ? <img src={row.image.path} alt={row.name} /> : <div className="wholesale-image">قطعه</div>}<div><h3>{row.name}</h3><b className="wholesale-price">{Number(row.price) > 0 ? formatRial(Number(row.price)) : 'استعلام قیمت'}</b></div></article>)}</div></section>;
}
