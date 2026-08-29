import { FormEvent, lazy, Suspense, useEffect, useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { Sheet, StockBar } from '@salimvand/ui';

const BarcodeScanner = lazy(() =>
  import('../components/BarcodeScanner').then((module) => ({ default: module.BarcodeScanner })),
);

type Item = {
  id: string;
  barcode: string;
  quantity: number;
  minStock?: number | null;
  product?: { name: string };
  brand?: { name: string };
  location?: { name: string; code: string };
};
type Option = { id: string; name: string };
type Location = { id: string; name: string; code: string };
export function InventoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState('');
  const [scanCode, setScanCode] = useState('');
  const [scanResult, setScanResult] = useState<Item | null>(null);
  const [locationForm, setLocationForm] = useState({ name: '', code: '', type: 'shelf' });
  const [selectedId, setSelectedId] = useState('');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<
    Array<{ id: string; type: string; quantityChange: number; quantityAfter: number }>
  >([]);
  const [products, setProducts] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);
  const [form, setForm] = useState({
    productId: '',
    brandId: '',
    purchasePrice: '',
    salePrice: '',
    minStock: '',
  });
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [locations, setLocations] = useState<Location[]>([]);
  const [receiveQty, setReceiveQty] = useState('');
  const [transferLocation, setTransferLocation] = useState('');
  const [busy, setBusy] = useState<
    'adjust' | 'receive' | 'transfer' | 'location' | 'create' | null
  >(null);
  const [adjustItem, setAdjustItem] = useState<Item | null>(null);
  const load = () =>
    api<{ data: Item[] }>(
      `/inventory/items${filter.trim() ? `?q=${encodeURIComponent(filter.trim())}` : ''}`,
    )
      .then((r) => setItems(r.data))
      .catch((e: Error) => setMessage(e.message));
  useEffect(() => {
    void load();
    void api<{ data: Option[] }>('/brands')
      .then((r) => setBrands(r.data))
      .catch(() => undefined);
    void api<{ data: Option[] }>('/products')
      .then((r) => setProducts(r.data))
      .catch(() => undefined);
    void api<{ data: Location[] }>('/locations')
      .then((r) => setLocations(r.data))
      .catch(() => undefined);
  }, []);
  const adjust = async () => {
    if (
      !selectedId ||
      !delta ||
      !reason ||
      !Number.isInteger(Number(delta)) ||
      Number(delta) === 0
    ) {
      setFieldErrors({ adjust: 'قلم، تعداد صحیح غیرصفر و دلیل اصلاح الزامی است' });
      return;
    }
    setFieldErrors({});
    setBusy('adjust');
    try {
      await api(`/inventory/items/${selectedId}/adjust`, {
        method: 'POST',
        body: JSON.stringify({ quantity: Number(delta), reason, userId: 'panel-user' }),
      });
      setMessage('موجودی اصلاح شد و در Ledger ثبت شد');
      setDelta('');
      setReason('');
      setAdjustItem(null);
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const lookupBarcode = async (code: string) => {
    if (!code.trim()) return;
    try {
      const result = await api<{ data: Item }>(
        `/inventory/barcode/${encodeURIComponent(code.trim())}`,
      );
      setScanResult(result.data);
      setSelectedId(result.data.id);
      setMessage(`قلم ${result.data.product?.name ?? ''} پیدا شد`);
    } catch (e) {
      setScanResult(null);
      setMessage((e as Error).message);
    }
  };
  const receive = async () => {
    if (
      !selectedId ||
      !receiveQty ||
      !Number.isInteger(Number(receiveQty)) ||
      Number(receiveQty) <= 0
    ) {
      setFieldErrors({ receive: 'قلم و تعداد صحیح مثبت برای ورود الزامی است' });
      return;
    }
    setFieldErrors({});
    setBusy('receive');
    try {
      await api('/inventory/receive', {
        method: 'POST',
        body: JSON.stringify({
          itemId: selectedId,
          quantity: Number(receiveQty),
          userId: 'panel-user',
        }),
      });
      setMessage('ورود کالا ثبت شد و در Ledger ثبت گردید');
      setReceiveQty('');
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const lowStock = async () => {
    try {
      const result = await api<{ data: Item[] }>('/inventory/low-stock');
      setItems(result.data);
      setMessage(`${result.data.length} قلم کم‌موجودی`);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const createLocation = async () => {
    if (!locationForm.name || !locationForm.code) {
      setFieldErrors({ location: 'نام و کد محل الزامی است' });
      return;
    }
    setFieldErrors({});
    setBusy('location');
    try {
      await api('/locations', { method: 'POST', body: JSON.stringify(locationForm) });
      setMessage('محل انبار ایجاد شد');
      setLocationForm({ name: '', code: '', type: 'shelf' });
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const printLabel = (item: Item) => {
    const popup = window.open('', '_blank', 'width=420,height=300');
    if (!popup) return;
    popup.document.write(
      `<html dir="rtl"><head><title>برچسب ${item.barcode}</title><style>body{font-family:Tahoma;text-align:center;padding:24px}h2{margin:8px}code{font:28px monospace;letter-spacing:4px}.line{border:1px solid #222;padding:18px}</style></head><body><div class="line"><h2>${item.product?.name ?? ''}</h2><p>${item.brand?.name ?? ''}</p><code>${item.barcode}</code><p>${item.location?.code ?? ''}</p></div><script>window.print()<\/script></body></html>`,
    );
    popup.document.close();
  };
  const transfer = async () => {
    if (!selectedId || !transferLocation) {
      setFieldErrors({ transfer: 'قلم و محل مقصد را انتخاب کنید' });
      return;
    }
    setFieldErrors({});
    setBusy('transfer');
    try {
      await api('/inventory/transfer', {
        method: 'POST',
        body: JSON.stringify({ itemId: selectedId, locationId: transferLocation }),
      });
      setMessage('انتقال قفسه ثبت شد و در Ledger ثبت گردید');
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const showHistory = async (id: string) => {
    setSelectedId(id);
    try {
      const result = await api<{
        data: Array<{ id: string; type: string; quantityChange: number; quantityAfter: number }>;
      }>(`/inventory/items/${id}/transactions`);
      setHistory(result.data);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await api<{ data: Item }>('/inventory/items', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          purchasePrice: Number(form.purchasePrice),
          salePrice: Number(form.salePrice),
          minStock: Number(form.minStock || 0),
        }),
      });
      setMessage(`قلم ${result.data.barcode} ثبت شد`);
      setForm({ productId: '', brandId: '', purchasePrice: '', salePrice: '', minStock: '' });
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  return (
    <section className="products-page">
      <div className="page-title">
        <div>
          <h1>انبار</h1>
          <p className="muted">مدیریت قلم موجودی برای هر محصول و برند</p>
        </div>
        <span className="count">{items.length} قلم</span>
        <input
          className="table-filter"
          placeholder="جست‌وجوی کالا یا بارکد"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load();
          }}
        />
        <button className="row-action" onClick={() => void lowStock()}>
          فقط کم‌موجودی
        </button>
        <button className="row-action" onClick={() => void load()}>
          همه اقلام
        </button>
        <button
          className="row-action"
          onClick={() =>
            void downloadFile('/reports/inventory/export', 'salimvand-inventory.csv').catch(
              (e: Error) => setMessage(e.message),
            )
          }
        >
          خروجی CSV
        </button>
      </div>
      <form className="product-form" onSubmit={submit}>
        <h2>افزودن قلم موجودی</h2>
        <label>
          محصول
          <select
            required
            value={form.productId}
            onChange={(e) => setForm({ ...form, productId: e.target.value })}
          >
            <option value="">انتخاب محصول</option>
            {products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          برند قطعه
          <select
            required
            value={form.brandId}
            onChange={(e) => setForm({ ...form, brandId: e.target.value })}
          >
            <option value="">انتخاب برند</option>
            {brands.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          قیمت خرید
          <input
            required
            type="number"
            min="0"
            value={form.purchasePrice}
            onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })}
          />
        </label>
        <label>
          قیمت فروش
          <input
            required
            type="number"
            min="0"
            value={form.salePrice}
            onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
          />
        </label>
        <label>
          حداقل موجودی
          <input
            type="number"
            min="0"
            value={form.minStock}
            onChange={(e) => setForm({ ...form, minStock: e.target.value })}
          />
        </label>
        <button>ثبت قلم و تولید بارکد</button>
      </form>
      <div className="adjust-box">
        <h2>اصلاح موجودی</h2>
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          <option value="">انتخاب قلم</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.product?.name} · {item.brand?.name} · {item.barcode}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          placeholder="تغییر تعداد، مثبت یا منفی"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="دلیل اصلاح الزامی است"
        />
        {fieldErrors.adjust && <small className="field-error">{fieldErrors.adjust}</small>}
        <button disabled={busy !== null} onClick={() => void adjust()}>
          {busy === 'adjust' ? 'در حال ثبت...' : 'ثبت اصلاح و Ledger'}
        </button>
        {selectedId && (
          <button className="outline" onClick={() => void showHistory(selectedId)}>
            نمایش تاریخچه
          </button>
        )}
      </div>
      <div className="adjust-box scan-box">
        <h2>جستجو و اسکن بارکد</h2>
        <input
          value={scanCode}
          onChange={(e) => setScanCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void lookupBarcode(scanCode);
          }}
          placeholder="بارکدخوان یا ورود دستی، سپس Enter"
          dir="ltr"
        />
        <button onClick={() => void lookupBarcode(scanCode)}>جستجو</button>
        <Suspense fallback={<span className="muted">در حال آماده‌سازی اسکنر…</span>}>
          <BarcodeScanner
            onCode={(code) => {
              setScanCode(code);
              void lookupBarcode(code);
            }}
          />
        </Suspense>
        {scanResult && (
          <span className="scan-result">
            {scanResult.product?.name} · {scanResult.brand?.name} · موجودی {scanResult.quantity}
          </span>
        )}
      </div>
      <div className="adjust-box">
        <h2>مدیریت محل انبار</h2>
        <input
          value={locationForm.name}
          onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })}
          placeholder="نام محل"
        />
        <input
          value={locationForm.code}
          onChange={(e) => setLocationForm({ ...locationForm, code: e.target.value })}
          placeholder="کد مثل A-03"
        />
        <select
          value={locationForm.type}
          onChange={(e) => setLocationForm({ ...locationForm, type: e.target.value })}
        >
          <option value="warehouse">انبار</option>
          <option value="aisle">راهرو</option>
          <option value="shelf">قفسه</option>
          <option value="level">طبقه</option>
          <option value="box">باکس</option>
        </select>
        {fieldErrors.location && <small className="field-error">{fieldErrors.location}</small>}
        <button disabled={busy !== null} onClick={() => void createLocation()}>
          {busy === 'location' ? 'در حال ثبت...' : 'ایجاد محل'}
        </button>
      </div>
      <div className="adjust-box">
        <h2>ورود و انتقال کالا</h2>
        <input
          type="number"
          min="1"
          value={receiveQty}
          onChange={(e) => setReceiveQty(e.target.value)}
          placeholder="تعداد ورود"
        />
        {fieldErrors.receive && <small className="field-error">{fieldErrors.receive}</small>}
        <button disabled={busy !== null} onClick={() => void receive()}>
          {busy === 'receive' ? 'در حال ثبت...' : 'ثبت ورود کالا'}
        </button>
        <select value={transferLocation} onChange={(e) => setTransferLocation(e.target.value)}>
          <option value="">محل مقصد</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.code} · {location.name}
            </option>
          ))}
        </select>
        {fieldErrors.transfer && <small className="field-error">{fieldErrors.transfer}</small>}
        <button disabled={busy !== null} className="outline" onClick={() => void transfer()}>
          {busy === 'transfer' ? 'در حال ثبت...' : 'انتقال به قفسه'}
        </button>
      </div>
      {message && <div className="notice">{message}</div>}
      <div className="product-table">
        <div className="table-head inventory-head">
          <span>محصول</span>
          <span>برند</span>
          <span>بارکد</span>
          <span>موجودی</span>
          <span>قفسه</span>
        </div>
        {items.map((item) => (
          <div className="table-row inventory-head" key={item.id}>
            <strong>{item.product?.name ?? '-'}</strong>
            <span>{item.brand?.name ?? '-'}</span>
            <code>{item.barcode}</code>
            <StockBar value={item.quantity} min={item.minStock ?? 0} />
            <span>
              {item.location ? `${item.location.code} · ${item.location.name}` : 'بدون قفسه'}
            </span>
            <button
              className="row-action"
              onClick={() => {
                setAdjustItem(item);
                setSelectedId(item.id);
                setDelta('');
                setReason('');
                setHistory([]);
                void showHistory(item.id);
              }}
            >
              اصلاح
            </button>
            <button className="row-action" onClick={() => void showHistory(item.id)}>
              Ledger
            </button>
            <button className="row-action" onClick={() => printLabel(item)}>
              چاپ لیبل
            </button>
          </div>
        ))}
      </div>
      <Sheet
        open={Boolean(adjustItem)}
        title={adjustItem ? `اصلاح موجودی — ${adjustItem.product?.name ?? ''}` : ''}
        onClose={() => setAdjustItem(null)}
        footer={
          <button disabled={busy !== null} onClick={() => void adjust()}>
            {busy === 'adjust' ? 'در حال ثبت…' : 'ثبت اصلاح و Ledger'}
          </button>
        }
      >
        {adjustItem && (
          <div className="sheet-body">
            <dl className="sheet-meta">
              <div>
                <dt>برند</dt>
                <dd>{adjustItem.brand?.name ?? '—'}</dd>
              </div>
              <div>
                <dt>بارکد</dt>
                <dd dir="ltr">{adjustItem.barcode}</dd>
              </div>
              <div>
                <dt>مسیر قفسه</dt>
                <dd>
                  {adjustItem.location
                    ? `${adjustItem.location.code} · ${adjustItem.location.name}`
                    : 'بدون قفسه'}
                </dd>
              </div>
              <div>
                <dt>موجودی فعلی</dt>
                <dd>{adjustItem.quantity}</dd>
              </div>
              <div>
                <dt>آستانهٔ هشدار</dt>
                <dd>{adjustItem.minStock ?? '—'}</dd>
              </div>
            </dl>
            <label>
              تغییر تعداد (مثبت یا منفی)
              <input
                type="number"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                placeholder="مثلاً ۵ یا ۲-"
              />
            </label>
            <label>
              دلیل اصلاح
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="دلیل الزامی است و در Audit ثبت می‌شود"
              />
            </label>
            {fieldErrors.adjust && <small className="field-error">{fieldErrors.adjust}</small>}
            {history.length > 0 && (
              <div className="history">
                <h3>تاریخچهٔ این قلم</h3>
                {history.map((row) => (
                  <div key={row.id}>
                    <span>{row.type}</span>
                    <b>
                      {row.quantityChange > 0 ? '+' : ''}
                      {row.quantityChange}
                    </b>
                    <small>پس از تراکنش: {row.quantityAfter}</small>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Sheet>
      {history.length > 0 && !adjustItem && (
        <div className="history">
          <h2>تاریخچه تراکنش‌ها</h2>
          {history.map((row) => (
            <div key={row.id}>
              <span>{row.type}</span>
              <b>
                {row.quantityChange > 0 ? '+' : ''}
                {row.quantityChange}
              </b>
              <small>موجودی پس از تراکنش: {row.quantityAfter}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
