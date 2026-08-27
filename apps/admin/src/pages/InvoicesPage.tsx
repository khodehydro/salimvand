import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { discountedUnitPrice, invoiceTotals, isValidIranMobile, money, paymentTotal as sumPayments, persianNumber, remainingDebt as debtLeft, type PaymentRow } from '../lib/invoice-math';
import { api } from '../lib/api';

type Invoice = { id: string; number: string; customerName?: string | null; total: string; paidAmount: string; paymentStatus: string; status: string; issuedAt: string; items: Array<{ productName: string; quantity: number }> };
type StockOption = { id: string; barcode: string; quantity: number; salePrice: string; location?: string | null; product: { name: string; code: string }; brand: { name: string } };
type CustomerOption = { id: string; name: string; mobile: string; debt?: string | number };
type DraftLine = { item: StockOption; quantity: number; lineDiscount: number };
type CreatedInvoice = { id: string; number: string; publicToken: string; publicShortCode: string; total: number; paid: number; qrDataUrl?: string };

const methods = [ { value: 'cash', label: 'نقدی' }, { value: 'card', label: 'کارت' }, { value: 'transfer', label: 'واریز' }, { value: 'credit', label: 'اعتباری' } ];
const labels: Record<string, string> = { paid: 'پرداخت کامل', partial: 'پرداخت بخشی', unpaid: 'پرداخت‌نشده', issued: 'صادرشده', voided: 'باطل‌شده' };
const publicSiteUrl = import.meta.env.VITE_PUBLIC_SITE_URL ?? window.location.origin;
const shortLink = (code: string) => `${publicSiteUrl}/i/${code}`;

export function InvoicesPage() {
  const [rows, setRows] = useState<Invoice[]>([]);
  const [options, setOptions] = useState<StockOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [quantity, setQuantity] = useState('1');
  const [search, setSearch] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [mobile, setMobile] = useState('');
  const [discount, setDiscount] = useState('');
  const [payments, setPayments] = useState<PaymentRow[]>([{ method: 'cash', amount: '' }]);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [created, setCreated] = useState<CreatedInvoice | null>(null);
  const [message, setMessage] = useState('');
  const [scanning, setScanning] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const load = () => api<{ data: Invoice[] }>('/invoices').then((result) => setRows(result.data)).catch((error: Error) => setMessage(error.message));
  useEffect(() => {
    void load();
    void api<{ data: StockOption[] }>('/invoices/options').then((result) => setOptions(result.data)).catch((error: Error) => setMessage(error.message));
  }, []);

  // Customer lookup is debounced: typing a mobile must not fire a request per key.
  useEffect(() => {
    const query = customerQuery.trim();
    if (!query) { setCustomers([]); return; }
    const handle = window.setTimeout(() => {
      void api<{ data: CustomerOption[] }>(`/customers?search=${encodeURIComponent(query)}`).then((result) => setCustomers(result.data)).catch(() => setCustomers([]));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [customerQuery]);

  const candidates = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return options.filter((item) => item.quantity > 0 && !lines.some((line) => line.item.id === item.id) && (!query || `${item.product.name} ${item.product.code} ${item.barcode} ${item.brand.name}`.toLocaleLowerCase().includes(query))).slice(0, 12);
  }, [options, search, lines]);

  const lineTotal = (line: DraftLine) => invoiceTotals([{ salePrice: Number(line.item.salePrice), quantity: line.quantity, lineDiscount: line.lineDiscount }], 0).total;
  const { subtotal, discount: discountValue, total } = invoiceTotals(lines.map((line) => ({ salePrice: Number(line.item.salePrice), quantity: line.quantity, lineDiscount: line.lineDiscount })), Number(discount) || 0);
  const paymentTotal = sumPayments(payments);
  const remainingDebt = debtLeft(total, payments);

  const addLine = (item: StockOption, qty = Number(quantity) || 1) => {
    if (!Number.isInteger(qty) || qty <= 0) return setMessage('تعداد باید عدد صحیح مثبت باشد');
    const existing = lines.find((line) => line.item.id === item.id);
    const nextQty = (existing?.quantity ?? 0) + qty;
    if (nextQty > item.quantity) return setMessage(`موجودی ${item.product.name} فقط ${item.quantity} عدد است`);
    setLines((current) => existing
      ? current.map((line) => line.item.id === item.id ? { ...line, quantity: nextQty } : line)
      : [...current, { item, quantity: qty, lineDiscount: 0 }]);
    setQuantity('1'); setSearch(''); setMessage('');
  };

  // A barcode gun types the code and then sends Enter: resolve it without a click.
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const exact = options.find((item) => item.barcode === search.trim());
    if (exact) return addLine(exact, 1);
    if (candidates.length === 1) return addLine(candidates[0], 1);
    setMessage(candidates.length ? 'چند قلم پیدا شد؛ یکی را انتخاب کنید.' : 'قلمی با این نام یا بارکد پیدا نشد.');
  };

  const onScanned = async (code: string) => {
    setScanning(false);
    const exact = options.find((item) => item.barcode === code.trim());
    if (!exact) return setMessage(`بارکد ${code} در موجودی ثبت نشده است`);
    addLine(exact, 1);
  };

  const create = async () => {
    if (!lines.length) return setMessage('حداقل یک قلم برای فاکتور انتخاب کنید');
    if (discountValue > subtotal) return setMessage('تخفیف نمی‌تواند از جمع اقلام بیشتر باشد');
    if (paymentTotal > total) return setMessage('مجموع دریافتی از مبلغ فاکتور بیشتر است');
    if (mobile && !isValidIranMobile(mobile)) return setMessage('شماره موبایل باید با ۰۹ شروع شود و ۱۱ رقم باشد');
    try {
      const response = await api<{ data: { id: string; number: string; publicToken: string; publicShortCode: string } }>('/invoices', {
        method: 'POST',
        body: JSON.stringify({
          customerName: customerName || undefined,
          customerMobile: mobile || undefined,
          discount: discountValue,
          items: lines.map((line) => ({
            inventoryItemId: line.item.id,
            quantity: line.quantity,
            // Per-line discount is folded into the unit price, the only money field the API accepts.
            unitPrice: discountedUnitPrice(Number(line.item.salePrice), line.quantity, line.lineDiscount),
          })),
        }),
      });
      for (const row of payments) {
        const amount = Math.round(Number(row.amount) || 0);
        if (amount <= 0) continue;
        await api(`/invoices/${response.data.id}/pay`, { method: 'POST', body: JSON.stringify({ amount: String(amount), method: row.method }) });
      }
      const qr = await api<{ data: { dataUrl: string } }>(`/public/invoices/qr/${response.data.publicShortCode}`).catch(() => ({ data: { dataUrl: '' } }));
      setCreated({ id: response.data.id, number: response.data.number, publicToken: response.data.publicToken, publicShortCode: response.data.publicShortCode, total, paid: paymentTotal, qrDataUrl: qr.data.dataUrl });
      setMessage('فاکتور صادر شد و موجودی به‌صورت اتمیک در Ledger ثبت شد.');
      setLines([]); setCustomerName(''); setMobile(''); setCustomerQuery(''); setDiscount(''); setPayments([{ method: 'cash', amount: '' }]);
      await load();
    } catch (error) { setMessage((error as Error).message); }
  };

  const pay = async () => {
    if (!paying || !payAmountValid()) return;
    try {
      for (const row of payments) {
        const amount = Math.round(Number(row.amount) || 0);
        if (amount <= 0) continue;
        await api(`/invoices/${paying.id}/pay`, { method: 'POST', body: JSON.stringify({ amount: String(amount), method: row.method }) });
      }
      setMessage('پرداخت ثبت و در Audit Log نوشته شد.');
      setPaying(null); setPayments([{ method: 'cash', amount: '' }]);
      await load();
    } catch (error) { setMessage((error as Error).message); }
  };
  const payAmountValid = () => payments.some((row) => Number(row.amount) > 0);

  return <section>
    <div className="page-title">
      <div><h1>فروش و فاکتورها</h1><p className="muted">صدور فاکتور چندقلمی با اسکنر، مصرف اتمیک موجودی و پرداخت چندروشه</p></div>
      <span className="count">{persianNumber(rows.length)} فاکتور</span>
    </div>
    {message && <div className="notice">{message}</div>}

    {created && <div className="invoice-success" role="dialog" aria-modal="true" aria-label="فاکتور صادر شد">
      <div className="invoice-success-card">
        <span className="success-mark">✓</span>
        <h2>فاکتور {created.number} صادر شد</h2>
        <p>لینک کوتاه و QR فاکتور برای مشتری آماده است و ۳۰ روز اعتبار دارد. {created.paid > 0 ? `دریافتی ${money(created.paid)} ثبت شد.` : ''} {created.total - created.paid > 0 ? `مانده بدهی ${money(created.total - created.paid)}.` : ''}</p>
        {created.qrDataUrl ? <img className="invoice-qr" src={created.qrDataUrl} alt="QR فاکتور" /> : <span className="muted">QR در دسترس نیست</span>}
        <input readOnly value={shortLink(created.publicShortCode)} onFocus={(event) => event.currentTarget.select()} />
        <div>
          <button onClick={() => void navigator.clipboard?.writeText(shortLink(created.publicShortCode))}>کپی لینک</button>
          <a className="button-primary" target="_blank" rel="noreferrer" href={`/invoice/${created.publicToken}`}>مشاهده فاکتور</a>
          <button className="outline" onClick={() => { setCreated(null); searchRef.current?.focus(); }}>فاکتور بعدی</button>
        </div>
      </div>
    </div>}

    <div className="cards invoice-form">
      <div>
        <h2>صدور فاکتور جدید</h2>
        <div className="invoice-product-picker">
          <input ref={searchRef} aria-label="جست‌وجو یا اسکن قلم" placeholder="نام، کد یا بارکد را تایپ کنید (اسکنر + Enter)" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={onSearchKeyDown} />
          <input aria-label="تعداد قلم" type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          <button type="button" className="row-action" onClick={() => setScanning((current) => !current)}>📷 اسکن دوربین</button>
          {scanning && <BarcodeHost onCode={(code) => void onScanned(code)} />}
          {search && !scanning && <div className="invoice-candidates">
            {candidates.length ? candidates.map((item) => <button type="button" key={item.id} onClick={() => addLine(item)}>
              <b>{item.product.name}</b>
              <span>{item.brand.name} · <span dir="ltr">{item.product.code}</span> · بارکد <span dir="ltr">{item.barcode}</span> · قفسه {item.location ?? '—'}</span>
              <strong>{persianNumber(item.quantity)} عدد</strong>
            </button>) : <small>قلم موجودی پیدا نشد.</small>}
          </div>}
        </div>

        <div className="invoice-lines">
          {lines.length ? lines.map((line) => <div className="invoice-line" key={line.item.id}>
            <span><b>{line.item.product.name}</b><small>{line.item.brand.name} · {money(line.item.salePrice)} · قفسه {line.item.location ?? '—'}</small></span>
            <input aria-label={`تعداد ${line.item.product.name}`} type="number" min="1" max={line.item.quantity} value={line.quantity} onChange={(event) => setLines((current) => current.map((entry) => entry.item.id === line.item.id ? { ...entry, quantity: Math.min(line.item.quantity, Math.max(1, Number(event.target.value) || 1)) } : entry))} />
            <input aria-label={`تخفیف ${line.item.product.name}`} type="number" min="0" placeholder="تخفیف قلم" value={line.lineDiscount || ''} onChange={(event) => setLines((current) => current.map((entry) => entry.item.id === line.item.id ? { ...entry, lineDiscount: Math.max(0, Number(event.target.value) || 0) } : entry))} />
            <strong>{money(lineTotal(line))}</strong>
            <button type="button" aria-label={`حذف ${line.item.product.name}`} onClick={() => setLines((current) => current.filter((entry) => entry.item.id !== line.item.id))}>×</button>
          </div>) : <p className="muted">برای شروع، بارکد را اسکن کنید یا نام قلم را جست‌وجو کنید.</p>}
        </div>

        <div className="form-grid">
          <div className="invoice-product-picker">
            <input aria-label="جست‌وجوی مشتری" placeholder="جست‌وجوی مشتری با نام یا موبایل..." value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} />
            {customerQuery && <div className="invoice-candidates">
              {customers.length ? customers.map((customer) => <button type="button" key={customer.id} onClick={() => { setCustomerName(customer.name); setMobile(customer.mobile); setCustomerQuery(''); setCustomers([]); }}>
                <b>{customer.name}</b><span><span dir="ltr">{customer.mobile}</span> · بدهی {money(customer.debt ?? 0)}</span>
              </button>) : <small>مشتری پیدا نشد؛ نام و موبایل را دستی وارد کنید.</small>}
            </div>}
          </div>
          <input aria-label="نام مشتری" placeholder="نام مشتری (اختیاری)" value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
          <input aria-label="موبایل مشتری" dir="ltr" placeholder="09xxxxxxxxx" value={mobile} onChange={(event) => setMobile(event.target.value)} />
          <input aria-label="تخفیف کل" type="number" min="0" placeholder="تخفیف کل (ریال)" value={discount} onChange={(event) => setDiscount(event.target.value)} />
        </div>

        <h3 className="muted">دریافت‌ها</h3>
        {payments.map((row, index) => <div className="payment-row" key={index}>
          <select aria-label="روش پرداخت" value={row.method} onChange={(event) => setPayments((current) => current.map((entry, i) => i === index ? { ...entry, method: event.target.value } : entry))}>
            {methods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
          </select>
          <input aria-label="مبلغ پرداخت" type="number" min="0" placeholder="مبلغ (ریال)" value={row.amount} onChange={(event) => setPayments((current) => current.map((entry, i) => i === index ? { ...entry, amount: event.target.value } : entry))} />
          <button type="button" className="row-action" onClick={() => setPayments((current) => current.map((entry, i) => i === index ? { ...entry, amount: String(Math.max(0, total - paymentTotal + (Number(entry.amount) || 0))) } : entry))}>مانده</button>
          {payments.length > 1 && <button type="button" aria-label="حذف ردیف پرداخت" onClick={() => setPayments((current) => current.filter((_, i) => i !== index))}>×</button>}
        </div>)}
        <button type="button" className="row-action" onClick={() => setPayments((current) => [...current, { method: 'card', amount: '' }])}>+ افزودن روش پرداخت</button>

        <div className="invoice-totals">
          <span>جمع اقلام: <b>{money(subtotal)}</b></span>
          <span>تخفیف: <b>{money(discountValue)}</b></span>
          <span>دریافتی: <b>{money(paymentTotal)}</b></span>
          <strong>قابل پرداخت: {money(total)}</strong>
          {remainingDebt > 0 && <span className="low-stock">بدهی مشتری: {money(remainingDebt)}</span>}
        </div>
        <button disabled={!lines.length} onClick={() => void create()}>صدور فاکتور</button>
      </div>
    </div>

    {paying && <div className="notice">
      <strong>ثبت پرداخت {paying.number}</strong>
      <span className="muted">مبلغ فاکتور {money(paying.total)} · دریافت‌شده {money(paying.paidAmount)}</span>
      {payments.map((row, index) => <div className="payment-row" key={index}>
        <select aria-label="روش پرداخت" value={row.method} onChange={(event) => setPayments((current) => current.map((entry, i) => i === index ? { ...entry, method: event.target.value } : entry))}>
          {methods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
        </select>
        <input aria-label="مبلغ پرداخت" type="number" min="0" value={row.amount} onChange={(event) => setPayments((current) => current.map((entry, i) => i === index ? { ...entry, amount: event.target.value } : entry))} />
      </div>)}
      <button disabled={!payAmountValid()} onClick={() => void pay()}>ثبت</button>
      <button className="outline" onClick={() => { setPaying(null); setPayments([{ method: 'cash', amount: '' }]); }}>انصراف</button>
    </div>}

    <div className="product-table">
      <div className="table-head invoice-head"><span>شماره</span><span>مشتری</span><span>اقلام</span><span>مبلغ</span><span>پرداخت</span><span>عملیات</span></div>
      {rows.map((invoice) => <div className="table-row invoice-row" key={invoice.id}>
        <code>{invoice.number}</code>
        <span>{invoice.customerName ?? 'مشتری حضوری'}</span>
        <span>{persianNumber(invoice.items.length)}</span>
        <strong>{money(invoice.total)}</strong>
        <span className={invoice.paymentStatus === 'paid' ? 'status-chip' : 'low-stock'}>{labels[invoice.paymentStatus] ?? invoice.paymentStatus}<small> · {money(invoice.paidAmount)}</small></span>
        <span>{invoice.status === 'voided' ? labels.voided : <>
          <button className="row-action" onClick={() => { setPaying(invoice); setPayments([{ method: 'cash', amount: String(Math.max(0, Number(invoice.total) - Number(invoice.paidAmount))) }]); }}>پرداخت</button>
          {' '}
          <button className="row-action" onClick={async () => {
            if (!window.confirm('فاکتور باطل شود؟')) return;
            try { await api(`/invoices/${invoice.id}/void`, { method: 'POST' }); setMessage('فاکتور باطل و موجودی برگشت داده شد.'); await load(); } catch (error) { setMessage((error as Error).message); }
          }}>ابطال</button>
        </>}</span>
      </div>)}
    </div>
  </section>;
}

// Lazy camera scanner: html5-qrcode only loads when the operator asks for it.
function BarcodeHost({ onCode }: { onCode: (code: string) => void }) {
  const [Scanner, setScanner] = useState<null | typeof import('../components/BarcodeScanner').BarcodeScanner>(null);
  useEffect(() => { import('../components/BarcodeScanner').then((module) => setScanner(() => module.BarcodeScanner)); }, []);
  if (!Scanner) return <p className="muted">در حال آماده‌سازی دوربین…</p>;
  return <Scanner onCode={onCode} />;
}
