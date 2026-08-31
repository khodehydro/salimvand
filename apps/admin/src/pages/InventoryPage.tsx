import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { Sheet } from '@salimvand/ui';
import { StockStepper } from '../components/StockStepper';
import { ProductCreateModal } from '../components/ProductCreateModal';
import { BarcodeSvg } from '../components/BarcodeSvg';
import { formatRial } from '@salimvand/shared';

const BarcodeScanner = lazy(() =>
  import('../components/BarcodeScanner').then((module) => ({ default: module.BarcodeScanner })),
);

type Item = {
  id: string;
  barcode: string;
  quantity: number;
  salePrice: string;
  minStock?: number | null;
  product?: { id: string; name: string; images?: Array<{ path: string }> };
  brand?: { name: string };
  location?: { id: string; name: string; code: string };
};
type Option = { id: string; name: string };
type Location = { id: string; name: string; code: string; type: string };
type VehicleMake = {
  id: string;
  name: string;
  models: Array<{ id: string; name: string; trims: Array<{ id: string; name: string }> }>;
};
type Transaction = { id: string; type: string; quantityChange: number; quantityAfter: number };

const tabs = [
  { id: 'register', label: 'ثبت محصول', hint: 'انبار + کاتالوگ + سایت، همه در یک پنجره' },
  { id: 'stock', label: 'لیست انبار', hint: 'جست‌وجوی لحظه‌ای، بارکدخوان و اصلاح سریع موجودی' },
  { id: 'shelves', label: 'قفسه‌ها', hint: 'ایجاد و مشاهدهٔ محل‌های انبار' },
] as const;
type Tab = (typeof tabs)[number]['id'];

const locationTypeLabels: Record<string, string> = {
  warehouse: 'انبار',
  aisle: 'راهرو',
  shelf: 'قفسه',
  level: 'طبقه',
  box: 'باکس',
};

/** Stock rows grouped per product: «۲ قلم · ۷ قطعه» aggregates the item
 * count and the total piece count under one card. */
type ProductGroup = {
  productId: string;
  name: string;
  image?: string;
  items: Item[];
};

export function InventoryPage() {
  const [tab, setTab] = useState<Tab>('register');
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);
  const [vehicles, setVehicles] = useState<VehicleMake[]>([]);
  const [filter, setFilter] = useState('');
  const [scanCode, setScanCode] = useState('');
  const [message, setMessage] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  // Detail sheet for one inventory item: ledger, transfer and bulk receive.
  const [detail, setDetail] = useState<Item | null>(null);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [transferLocation, setTransferLocation] = useState('');
  const [receiveQty, setReceiveQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [locationForm, setLocationForm] = useState({ name: '', code: '', type: 'shelf' });
  const [locationError, setLocationError] = useState('');
  const skipFirstSearch = useRef(true);

  const load = (q = filter) =>
    api<{ data: Item[] }>(`/inventory/items${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
      .then((r) => setItems(r.data))
      .catch((e: Error) => setMessage(e.message));
  const loadLocations = () =>
    api<{ data: Location[] }>('/locations')
      .then((r) => setLocations(r.data))
      .catch(() => undefined);

  useEffect(() => {
    void load('');
    void loadLocations();
    void api<{ data: Option[] }>('/brands')
      .then((r) => setBrands(r.data))
      .catch(() => undefined);
    void api<{ data: Option[] }>('/categories')
      .then((r) => setCategories(r.data))
      .catch(() => undefined);
    void api<{ data: VehicleMake[] }>('/vehicles/tree')
      .then((r) => setVehicles(r.data))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live search: every keystroke refreshes the list after a short pause —
  // no search button to click.
  useEffect(() => {
    if (skipFirstSearch.current) {
      skipFirstSearch.current = false;
      return;
    }
    const timer = setTimeout(() => void load(filter), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const groups: ProductGroup[] = useMemo(() => {
    const map = new Map<string, ProductGroup>();
    for (const item of items) {
      const key = item.product?.id ?? item.barcode;
      const group = map.get(key) ?? {
        productId: key,
        name: item.product?.name ?? item.barcode,
        image: item.product?.images?.[0]?.path,
        items: [],
      };
      group.items.push(item);
      map.set(key, group);
    }
    return [...map.values()];
  }, [items]);

  const lookupBarcode = async (code: string) => {
    if (!code.trim()) return;
    try {
      const result = await api<{ data: Item }>(
        `/inventory/barcode/${encodeURIComponent(code.trim())}`,
      );
      setDetail(result.data);
      setMessage(`قلم ${result.data.product?.name ?? ''} پیدا شد`);
      setScanCode('');
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const openDetail = async (item: Item) => {
    setDetail(item);
    setTransferLocation(item.location?.id ?? '');
    setReceiveQty('');
    setHistory([]);
    try {
      const result = await api<{ data: Transaction[] }>(`/inventory/items/${item.id}/transactions`);
      setHistory(result.data);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const transfer = async () => {
    if (!detail || !transferLocation) return setMessage('محل مقصد را انتخاب کنید');
    setBusy(true);
    try {
      await api('/inventory/transfer', {
        method: 'POST',
        body: JSON.stringify({ itemId: detail.id, locationId: transferLocation }),
      });
      setMessage('انتقال قفسه ثبت شد');
      await openDetail({ ...detail, location: locations.find((l) => l.id === transferLocation) });
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const receive = async () => {
    const qty = Number(receiveQty);
    if (!detail || !Number.isInteger(qty) || qty <= 0)
      return setMessage('تعداد ورود باید عدد صحیح مثبت باشد');
    setBusy(true);
    try {
      await api('/inventory/receive', {
        method: 'POST',
        body: JSON.stringify({ itemId: detail.id, quantity: qty, userId: 'panel-user' }),
      });
      setMessage('ورود کالا ثبت شد');
      await load();
      await openDetail({ ...detail, quantity: detail.quantity + qty });
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const lowStock = async () => {
    try {
      const result = await api<{ data: Item[] }>('/inventory/low-stock');
      setItems(result.data);
      setFilter('');
      setMessage(`${result.data.length} قلم کم‌موجودی`);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const createLocation = async () => {
    if (!locationForm.name || !locationForm.code) {
      setLocationError('نام و کد محل الزامی است');
      return;
    }
    setLocationError('');
    setBusy(true);
    try {
      await api('/locations', { method: 'POST', body: JSON.stringify(locationForm) });
      setMessage('محل انبار ایجاد شد');
      setLocationForm({ name: '', code: '', type: 'shelf' });
      await loadLocations();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Label popup with a real scannable barcode: the SVG is rendered in-page
   * (jsbarcode), serialized and embedded into the print window. */
  const printLabel = (item: Item) => {
    const popup = window.open('', '_blank', 'width=420,height=340');
    if (!popup) return;
    const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // Render with the same library the panel uses, serialize into the popup.
    import('jsbarcode')
      .then(({ default: JsBarcode }) => {
        try {
          JsBarcode(host, item.barcode, {
            format: /^\d{13}$/.test(item.barcode) ? 'EAN13' : 'CODE128',
            height: 60,
            width: 2,
            fontSize: 16,
            margin: 4,
          });
        } catch {
          /* keep text-only fallback */
        }
        const barcodeSvg = new XMLSerializer().serializeToString(host);
        writeLabel(popup, item, barcodeSvg);
      })
      .catch(() => writeLabel(popup, item, ''));
  };
  const writeLabel = (popup: Window, item: Item, barcodeSvg: string) => {
    popup.document.write(
      `<html dir="rtl"><head><title>برچسب ${item.barcode}</title><style>body{font-family:Tahoma;text-align:center;padding:20px}h2{margin:8px 6px}code{font:20px monospace;letter-spacing:3px}.line{border:1px solid #222;padding:14px}svg{max-width:100%}</style></head><body><div class="line"><h2>${item.product?.name ?? ''}</h2><p>${item.brand?.name ?? ''}</p>${barcodeSvg}<p>${item.location?.code ?? ''}</p><code>${item.barcode}</code></div><script>window.print()<\/script></body></html>`,
    );
    popup.document.close();
  };

  const activeTab = tabs.find((entry) => entry.id === tab) ?? tabs[0];

  return (
    <section className="inventory-page">
      <div className="page-title">
        <div>
          <h1>انبار و موجودی</h1>
          <p className="muted">{activeTab.hint}</p>
        </div>
        <span className="count">{items.length} قلم</span>
      </div>

      <nav className="settings-tabs" aria-label="بخش‌های انبار">
        {tabs.map((entry) => (
          <button
            type="button"
            key={entry.id}
            className={tab === entry.id ? 'active' : ''}
            onClick={() => setTab(entry.id)}
            aria-current={tab === entry.id ? 'true' : undefined}
          >
            <b>{entry.label}</b>
            <small>{entry.hint}</small>
          </button>
        ))}
      </nav>

      {message && <div className="notice">{message}</div>}

      {tab === 'register' && (
        <div className="register-tab">
          <div className="register-card">
            <b>ثبت محصول جدید</b>
            <p className="muted">
              یک پنجره، همهٔ قابلیت‌ها: مشخصات و سئو، قلم انبار با برند و بارکد و قیمت، موجودی
              اولیه، قفسه و خودروهای سازگار. با یک بار ذخیره، محصول هم‌زمان در انبار، در کاتالوگ و
              روی سایت ثبت می‌شود — دیگر نیازی نیست اول در جایی ثبت کنید و بعد از لیست ادامه دهید.
            </p>
            <button className="button-primary" onClick={() => setCreateOpen(true)}>
              + ثبت محصول جدید
            </button>
          </div>
        </div>
      )}

      {tab === 'stock' && (
        <div className="stock-tab">
          <div className="search-field">
            <span className="search-icon">⌕</span>
            <input
              placeholder="جست‌وجوی لحظه‌ای کالا یا بارکد…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {filter && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setFilter('')}
                aria-label="پاک کردن جست‌وجو"
              >
                ✕
              </button>
            )}
          </div>
          <div className="list-toolbar stock-toolbar">
            <button className="row-action" onClick={() => void lowStock()}>
              فقط کم‌موجودی
            </button>
            <button
              className="row-action"
              onClick={() => {
                setFilter('');
                void load('');
              }}
            >
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
          <div className="barcode-bar">
            <input
              value={scanCode}
              onChange={(e) => setScanCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void lookupBarcode(scanCode);
              }}
              placeholder="بارکدخوان یا ورود دستی بارکد، سپس Enter"
              dir="ltr"
            />
            <button onClick={() => void lookupBarcode(scanCode)}>جستجو با بارکد</button>
            <Suspense fallback={<span className="muted">در حال آماده‌سازی اسکنر…</span>}>
              <BarcodeScanner
                onCode={(code) => {
                  setScanCode(code);
                  void lookupBarcode(code);
                }}
              />
            </Suspense>
          </div>

          <div className="inventory-list">
            {groups.map((group) => {
              const totalPieces = group.items.reduce((sum, item) => sum + item.quantity, 0);
              const prices = group.items.map((item) => Number(item.salePrice)).filter(Boolean);
              const cheapest = prices.length ? Math.min(...prices) : null;
              return (
                <div className="inventory-group" key={group.productId}>
                  <div className="ig-head">
                    <span className="product-thumb">
                      {group.image ? (
                        <img src={group.image} alt={group.name} loading="lazy" />
                      ) : (
                        <span>قطعه</span>
                      )}
                    </span>
                    <div className="ig-title">
                      <b>{group.name}</b>
                      <div className="plc-chips">
                        <span className="chip">
                          {group.items.length.toLocaleString('fa-IR')} قلم ·{' '}
                          {totalPieces.toLocaleString('fa-IR')} قطعه
                        </span>
                        {cheapest != null && (
                          <span className="chip price">از {formatRial(cheapest)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="ig-items">
                    {group.items.map((item) => (
                      <div className="inventory-row" key={item.id}>
                        <div className="inv-info">
                          <b>{item.brand?.name ?? '-'}</b>
                          <small>
                            <code dir="ltr">{item.barcode}</code>
                          </small>
                        </div>
                        <StockStepper
                          itemId={item.id}
                          quantity={item.quantity}
                          onMessage={setMessage}
                          onSaved={() => void load()}
                        />
                        <span className="inv-shelf">
                          {item.location
                            ? `${item.location.code} · ${item.location.name}`
                            : 'بدون قفسه'}
                        </span>
                        <div className="inv-actions">
                          <button className="row-action" onClick={() => void openDetail(item)}>
                            کارت قلم
                          </button>
                          <button className="row-action" onClick={() => printLabel(item)}>
                            چاپ لیبل
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {!groups.length && <p className="muted">قلمی یافت نشد.</p>}
          </div>
        </div>
      )}

      {tab === 'shelves' && (
        <div className="shelves-tab">
          <div className="adjust-box">
            <h2>ایجاد محل انبار</h2>
            <input
              value={locationForm.name}
              onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })}
              placeholder="نام محل"
            />
            <input
              value={locationForm.code}
              onChange={(e) => setLocationForm({ ...locationForm, code: e.target.value })}
              placeholder="کد مثل A-03"
              dir="ltr"
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
            {locationError && <small className="field-error">{locationError}</small>}
            <button
              className="button-primary"
              disabled={busy}
              onClick={() => void createLocation()}
            >
              {busy ? 'در حال ثبت…' : 'ایجاد محل'}
            </button>
          </div>
          <div className="inventory-list">
            {locations.map((location) => (
              <div className="inventory-row" key={location.id}>
                <div className="inv-info">
                  <b>{location.name}</b>
                  <small dir="ltr">{location.code}</small>
                </div>
                <span className="chip">{locationTypeLabels[location.type] ?? location.type}</span>
              </div>
            ))}
            {!locations.length && <p className="muted">هنوز محلی ثبت نشده است.</p>}
          </div>
        </div>
      )}

      <ProductCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(msg) => {
          setMessage(msg);
          void load();
        }}
        categories={categories}
        brands={brands}
        locations={locations}
        vehicles={vehicles}
      />

      <Sheet
        open={Boolean(detail)}
        title={detail ? `کارت قلم — ${detail.product?.name ?? ''}` : ''}
        onClose={() => setDetail(null)}
        footer={
          <div className="sheet-footer-actions">
            <button disabled={busy} onClick={() => void receive()}>
              {busy ? 'در حال ثبت…' : 'ثبت ورود کالا'}
            </button>
            <button className="outline" disabled={busy} onClick={() => void transfer()}>
              انتقال به قفسهٔ انتخابی
            </button>
          </div>
        }
      >
        {detail && (
          <div className="sheet-body">
            <dl className="sheet-meta">
              <div>
                <dt>برند</dt>
                <dd>{detail.brand?.name ?? '—'}</dd>
              </div>
              <div>
                <dt>موجودی فعلی</dt>
                <dd>{detail.quantity}</dd>
              </div>
              <div>
                <dt>قیمت فروش</dt>
                <dd>{formatRial(Number(detail.salePrice))}</dd>
              </div>
              <div>
                <dt>آستانهٔ هشدار</dt>
                <dd>{detail.minStock ?? '—'}</dd>
              </div>
            </dl>
            <div className="sheet-barcode">
              <BarcodeSvg value={detail.barcode} />
              <code dir="ltr">{detail.barcode}</code>
            </div>
            <div className="two-fields">
              <label>
                ورود کالا (تعداد)
                <input
                  type="number"
                  min="1"
                  value={receiveQty}
                  onChange={(e) => setReceiveQty(e.target.value)}
                  placeholder="مثلاً ۱۰"
                />
              </label>
              <label>
                انتقال به قفسه
                <select
                  value={transferLocation}
                  onChange={(e) => setTransferLocation(e.target.value)}
                >
                  <option value="">بدون قفسه</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} · {location.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted">
              برای کم و زیاد کردن سریع موجودی، از دکمه‌های − و + کنار خودِ عدد در لیست استفاده کنید؛
              ورود عمده و انتقال قفسه از همین کارت انجام می‌شود. بارکد بالا قابل خواندن با بارکدخوان
              است.
            </p>
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
    </section>
  );
}
