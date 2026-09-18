import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { hashForPage } from '../lib/admin-route';
import { api, downloadFile, fetchAllPages } from '../lib/api';
import { Modal } from '@salimvand/ui';
import { StockStepper } from '../components/StockStepper';
import { ProductCreateModal } from '../components/ProductCreateModal';
import { BarcodeSvg } from '../components/BarcodeSvg';
import { formatJalaliDate, formatPersianNumber, formatRial } from '@salimvand/shared';
import { FaNumberInput } from '../components/FaNumberInput';
import { locationLabel } from '../lib/location-label';

const BarcodeScanner = lazy(() =>
  import('../components/BarcodeScanner').then((module) => ({ default: module.BarcodeScanner })),
);

type Item = {
  id: string;
  barcode: string;
  quantity: number;
  salePrice: string;
  purchasePrice?: string;
  /** When the current sale price took effect (ISO) — the Shamsi price badge. */
  priceUpdatedAt?: string | null;
  minStock?: number | null;
  product?: {
    id: string;
    name: string;
    code?: string | null;
    images?: Array<{ path: string }>;
    category?: { name: string } | null;
    compatibilities?: Array<{ model: { name: string; make: { name: string } } }>;
  };
  brand?: { name: string };
  location?: { id: string; name: string; code: string; parent?: { name: string } | null };
};
type Option = { id: string; name: string };
type Location = {
  id: string;
  name: string;
  code: string;
  type: string;
  parentId?: string | null;
  parent?: { id: string; name: string } | null;
  children?: Array<Location & { _count?: { items: number } }>;
  _count?: { items: number };
};
type VehicleMake = {
  id: string;
  name: string;
  models: Array<{ id: string; name: string; trims: Array<{ id: string; name: string }> }>;
};
type Transaction = { id: string; type: string; quantityChange: number; quantityAfter: number };
/** Sale-price timeline row of one stock line (GET /inventory/items/:id/price-history). */
type PriceHistoryRow = {
  id: string;
  oldSalePrice: string | null;
  newSalePrice: string;
  source: string;
  userName: string | null;
  changedAt: string;
  changedAtJalali: string;
};
const priceSourceLabels: Record<string, string> = {
  panel: 'پنل',
  android: 'اندروید',
  bulk: 'تغییر گروهی',
};

const tabs = [
  { id: 'stock', label: 'لیست انبار', hint: 'جست‌وجوی لحظه‌ای، بارکدخوان و اصلاح سریع موجودی' },
  { id: 'register', label: 'ثبت محصول', hint: 'انبار + کاتالوگ + سایت، همه در یک پنجره' },
  { id: 'shelves', label: 'قفسه‌ها', hint: 'انبارها و گروه‌بندی قفسه‌ها — ایجاد، ویرایش و حذف' },
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
 * count and the total piece count under one card. Code, category and
 * compatible vehicles complete the product picture right inside the list. */
type ProductGroup = {
  productId: string;
  name: string;
  code?: string | null;
  image?: string;
  category?: string;
  vehicles: string[];
  items: Item[];
};

/** Semantic stock status — same colours everywhere: در دسترس = سبز،
 * کم‌موجود = کهربایی، ناموجود = قرمز (طبق سند طراحی). */
function stockStatus(item: Item): { label: string; badge: string; bar: string } {
  const min = item.minStock ?? 0;
  if (item.quantity <= 0) return { label: 'ناموجود', badge: 'b-danger', bar: '' };
  if (min > 0 && item.quantity <= min) return { label: 'کم‌موجود', badge: 'b-warn', bar: 'mid' };
  return { label: 'در دسترس', badge: 'b-ok', bar: 'ok' };
}

/** Fill ratio of the stockbar relative to the warning threshold. */
function stockRatio(item: Item): number {
  const min = item.minStock ?? 0;
  if (item.quantity <= 0) return 0;
  if (min <= 0) return 1;
  return Math.min(1, item.quantity / min);
}

export function InventoryPage() {
  const [tab, setTab] = useState<Tab>('stock');
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);
  const [vehicles, setVehicles] = useState<VehicleMake[]>([]);
  const [filter, setFilter] = useState('');
  const [bulkBrand, setBulkBrand] = useState('');
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkSalePercent, setBulkSalePercent] = useState('');
  const [bulkPurchasePercent, setBulkPurchasePercent] = useState('');
  const [bulkRoundTo, setBulkRoundTo] = useState('1000');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [message, setMessage] = useState('');
  // Detail sheet for one inventory item: ledger, transfer and bulk receive.
  const [detail, setDetail] = useState<Item | null>(null);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryRow[]>([]);
  const [transferLocation, setTransferLocation] = useState('');
  const [receiveQty, setReceiveQty] = useState('');
  const [busy, setBusy] = useState(false);
  // Shelves tab: warehouses (groups) and shelves are managed separately —
  // a location with no parent and type warehouse is a group; anything else
  // is a shelf placed inside one (or «بدون انبار» until it is assigned).
  const [warehouseForm, setWarehouseForm] = useState({ name: '', code: '' });
  const [editingWarehouse, setEditingWarehouse] = useState<Location | null>(null);
  const [shelfForm, setShelfForm] = useState({ name: '', code: '', parentId: '' });
  const [editingShelf, setEditingShelf] = useState<Location | null>(null);
  const [locationError, setLocationError] = useState('');
  const skipFirstSearch = useRef(true);

  const load = (q = filter) =>
    // Cursor-paginated endpoint: drain the pages so the grouped view keeps
    // showing the whole (filtered) stock list.
    fetchAllPages<Item>(`/inventory/items${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`, {
      limit: 500,
    })
      .then((data) => setItems(data))
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
      const group =
        map.get(key) ??
        ({
          productId: key,
          name: item.product?.name ?? item.barcode,
          code: item.product?.code,
          image: item.product?.images?.[0]?.path,
          category: item.product?.category?.name,
          vehicles: [],
          items: [],
        } satisfies ProductGroup);
      // Deduplicated vehicle list («پژو ۲۰۶», …) from all compatibilities.
      for (const entry of item.product?.compatibilities ?? []) {
        const vehicle = `${entry.model.make.name} ${entry.model.name}`;
        if (!group.vehicles.includes(vehicle)) group.vehicles.push(vehicle);
      }
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
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const openDetail = async (item: Item) => {
    setDetail(item);
    setTransferLocation(item.location?.id ?? '');
    setReceiveQty('');
    setHistory([]);
    setPriceHistory([]);
    try {
      const [transactions, prices] = await Promise.all([
        api<{ data: Transaction[] }>(`/inventory/items/${item.id}/transactions`),
        api<{ data: PriceHistoryRow[] }>(`/inventory/items/${item.id}/price-history`),
      ]);
      setHistory(transactions.data);
      setPriceHistory(prices.data);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const removeItem = async () => {
    if (!detail || !window.confirm(`قلم «${detail.product?.name ?? ''}» حذف شود؟`)) return;
    setBusy(true);
    try {
      await api(`/inventory/items/${detail.id}`, { method: 'DELETE' });
      setMessage('قلم از لیست انبار حذف شد');
      setDetail(null);
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
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
        body: JSON.stringify({ itemId: detail.id, quantity: qty, reason: 'ورود از کارت قلم' }),
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

  const warehouses = locations.filter(
    (location) => !location.parentId && location.type === 'warehouse',
  );
  const shelves = locations.filter(
    (location) => location.parentId || location.type !== 'warehouse',
  );
  const shelvesOf = (parentId: string | null) =>
    shelves.filter((location) => (location.parentId ?? null) === parentId);
  const startWarehouseEdit = (warehouse: Location) => {
    setEditingWarehouse(warehouse);
    setLocationError('');
    setWarehouseForm({ name: warehouse.name, code: warehouse.code });
  };
  const saveWarehouse = async () => {
    if (!warehouseForm.name.trim() || !warehouseForm.code.trim())
      return setLocationError('نام و کد انبار الزامی است');
    setLocationError('');
    setBusy(true);
    try {
      if (editingWarehouse) {
        await api(`/locations/${editingWarehouse.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: warehouseForm.name, code: warehouseForm.code }),
        });
        setMessage('انبار ویرایش شد');
      } else {
        await api('/locations', {
          method: 'POST',
          body: JSON.stringify({ ...warehouseForm, type: 'warehouse' }),
        });
        setMessage('انبار ایجاد شد');
      }
      setWarehouseForm({ name: '', code: '' });
      setEditingWarehouse(null);
      await loadLocations();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const startShelfEdit = (shelf: Location) => {
    setEditingShelf(shelf);
    setLocationError('');
    setShelfForm({ name: shelf.name, code: shelf.code, parentId: shelf.parentId ?? '' });
  };
  const saveShelf = async () => {
    if (!shelfForm.name.trim() || !shelfForm.code.trim())
      return setLocationError('نام و کد قفسه الزامی است');
    setLocationError('');
    setBusy(true);
    try {
      if (editingShelf) {
        await api(`/locations/${editingShelf.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: shelfForm.name,
            code: shelfForm.code,
            parentId: shelfForm.parentId || null,
          }),
        });
        setMessage('قفسه ویرایش شد');
      } else {
        await api('/locations', {
          method: 'POST',
          body: JSON.stringify({ ...shelfForm, type: 'shelf' }),
        });
        setMessage('قفسه ایجاد شد');
      }
      setShelfForm({ name: '', code: '', parentId: '' });
      setEditingShelf(null);
      await loadLocations();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const removeLocation = async (location: Location) => {
    const items = location._count?.items ?? 0;
    const isWarehouse = !location.parentId && location.type === 'warehouse';
    const question = isWarehouse
      ? `انبار «${location.name}» حذف شود؟`
      : items > 0
        ? `قفسهٔ «${location.name}» حذف شود؟ ${formatPersianNumber(items)} قلم کالا بدون قفسه می‌شوند — موجودی آن‌ها حذف نمی‌شود.`
        : `قفسهٔ «${location.name}» حذف شود؟`;
    if (!window.confirm(question)) return;
    setBusy(true);
    try {
      const result = await api<{ data: { detachedItems: number } }>(`/locations/${location.id}`, {
        method: 'DELETE',
      });
      setMessage(
        result.data.detachedItems > 0
          ? `محل حذف شد؛ ${formatPersianNumber(result.data.detachedItems)} قلم بدون قفسه شدند`
          : 'محل حذف شد',
      );
      await loadLocations();
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** One click → the full label studio with this item preselected
   * (#/labels?item=<id>): real barcode, three sizes, three styles, A4 sheet. */
  const openLabelStudio = (item: Item) => {
    window.location.hash = hashForPage('labels', { item: item.id });
  };

  /** Publishes the product announcement to the Telegram/Bale channels. */
  const publishGroup = async (group: ProductGroup) => {
    const productId = group.items.find((item) => item.product?.id)?.product?.id;
    if (!productId) return;
    setMessage('در حال انتشار در کانال‌ها...');
    try {
      const result = await api<{
        data: {
          telegram: { ok: boolean; skipped?: boolean; reason?: string };
          bale: { ok: boolean; skipped?: boolean; reason?: string };
        };
      }>(`/products/${productId}/publish`, { method: 'POST' });
      const label = (name: string, channel: { ok: boolean; skipped?: boolean; reason?: string }) =>
        channel.skipped
          ? `${name}: پیکربندی نشده`
          : channel.ok
            ? `${name}: ارسال شد ✓`
            : `${name}: خطا — ${channel.reason}`;
      setMessage(
        `انتشار «${group.name}» — ${label('تلگرام', result.data.telegram)} · ${label(
          'بله',
          result.data.bale,
        )}`,
      );
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const activeTab = tabs.find((entry) => entry.id === tab) ?? tabs[0];
  const totalPieces = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <section className="inventory-page">
      <div className="page-title">
        <div>
          <h1>{tab === 'stock' ? 'اقلام موجودی و اصلاح' : 'انبار و موجودی'}</h1>
          <p className="muted">
            {tab === 'stock'
              ? 'لیست قلم‌های موجودی (محصول × برند) با قفسه و آستانه؛ ویرایش با دلیل اجباری و تاریخچه تراکنش‌ها.'
              : activeTab.hint}
          </p>
        </div>
        <span className="count inventory-count">
          <b>{formatPersianNumber(items.length)} قلم</b>
          <i>·</i>
          <b>{formatPersianNumber(totalPieces)} قطعه</b>
        </span>
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
        <ProductCreateModal
          open
          inline
          onClose={() => setTab('stock')}
          onCreated={(msg) => {
            setMessage(msg);
            void load();
          }}
          categories={categories}
          brands={brands}
          locations={locations}
          vehicles={vehicles}
        />
      )}

      {tab === 'stock' && (
        <div className="stock-tab">
          {/* One compact filter toolbar, matching the documented inventory screen. */}
          <div className="inventory-kpis" aria-label="خلاصه موجودی">
            <article className="inventory-kpi">
              <span className="kpi-icon">▱</span>
              <div>
                <small>اقلام فعال</small>
                <strong>{formatPersianNumber(items.length)}</strong>
                <em>در {formatPersianNumber(groups.length)} محصول</em>
              </div>
            </article>
            <article className="inventory-kpi">
              <span className="kpi-icon">▣</span>
              <div>
                <small>ارزش انبار (خرید)</small>
                <strong>
                  {formatRial(
                    items.reduce(
                      (sum, item) =>
                        sum + item.quantity * Number(item.purchasePrice ?? item.salePrice),
                      0,
                    ),
                  )}
                </strong>
                <em>بر پایه قیمت خرید</em>
              </div>
            </article>
            <article className="inventory-kpi inventory-kpi-sale-value">
              <span className="kpi-icon">◈</span>
              <div>
                <small>ارزش انبار (فروش)</small>
                <strong>
                  {formatRial(
                    items.reduce(
                      (sum, item) => sum + item.quantity * Number(item.salePrice || 0),
                      0,
                    ),
                  )}
                </strong>
                <em>بر پایه قیمت فروش</em>
              </div>
            </article>
            <article className="inventory-kpi inventory-kpi-alert">
              <span className="kpi-icon">△</span>
              <div>
                <small>زیر آستانه</small>
                <strong>
                  {formatPersianNumber(
                    items.filter(
                      (item) =>
                        item.quantity > 0 &&
                        item.minStock != null &&
                        item.quantity <= item.minStock,
                    ).length,
                  )}
                </strong>
                <em>نیاز به سفارش</em>
              </div>
            </article>
          </div>
          <div className="inventory-filter-toolbar">
            <div className="search-field inventory-search-field">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path
                  d="m20 20-3.6-3.6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <input
                placeholder="نام قطعه، کد محصول، بارکد یا برند…"
                aria-label="جست‌وجوی کالا در انبار"
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
            <div className="inventory-quick-filters" aria-label="فیلترهای سریع">
              <button
                className="filter-pill active"
                onClick={() => {
                  setFilter('');
                  void load('');
                }}
              >
                همه اقلام
              </button>
              <button className="filter-pill" onClick={() => void lowStock()}>
                کم‌موجود
              </button>
              <button
                className="filter-pill"
                onClick={() =>
                  void downloadFile('/reports/inventory/export', 'salimvand-inventory.csv').catch(
                    (e: Error) => setMessage(e.message),
                  )
                }
              >
                خروجی CSV
              </button>
              <button
                className="filter-pill accounting-export"
                onClick={() =>
                  void downloadFile(
                    '/reports/inventory/accounting-export',
                    'salimvand-products-accounting.xlsx',
                  ).catch((e: Error) => setMessage(e.message))
                }
              >
                خروجی حسابداری
              </button>
            </div>
            <Suspense
              fallback={<span className="muted scanner-inline-loading">آماده‌سازی اسکنر…</span>}
            >
              <BarcodeScanner
                onCode={(code) => {
                  setFilter(code);
                  void lookupBarcode(code);
                }}
              />
            </Suspense>
            <p className="stock-search-meta" aria-live="polite">
              {filter
                ? `${formatPersianNumber(groups.length)} کالا · ${formatPersianNumber(items.length)} قلم برای «${filter}»`
                : `${formatPersianNumber(groups.length)} کالا · ${formatPersianNumber(items.length)} قلم در انبار`}
            </p>
          </div>
          <div className="bulk-price-toolbar">
            <b>مدیریت گروهی قیمت</b>
            <select value={bulkBrand} onChange={(event) => setBulkBrand(event.target.value)}>
              <option value="">همه برندها</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
            <select value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value)}>
              <option value="">همه دسته‌ها</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <input
              dir="ltr"
              inputMode="decimal"
              placeholder="٪ فروش"
              value={bulkSalePercent}
              onChange={(event) => setBulkSalePercent(event.target.value)}
            />
            <input
              dir="ltr"
              inputMode="decimal"
              placeholder="٪ خرید"
              value={bulkPurchasePercent}
              onChange={(event) => setBulkPurchasePercent(event.target.value)}
            />
            <input
              dir="ltr"
              inputMode="numeric"
              placeholder="گرد کردن"
              value={bulkRoundTo}
              onChange={(event) => setBulkRoundTo(event.target.value)}
            />
            <button
              className="outline"
              disabled={bulkBusy}
              onClick={async () => {
                if (!bulkBrand && !bulkCategory)
                  return setMessage('برای تغییر گروهی، برند یا دسته را انتخاب کنید.');
                setBulkBusy(true);
                try {
                  const result = await api<{ data: { updated: number } }>(
                    '/inventory/bulk-prices',
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        brandId: bulkBrand || undefined,
                        categoryId: bulkCategory || undefined,
                        salePercent: Number(bulkSalePercent || 0),
                        purchasePercent: Number(bulkPurchasePercent || 0),
                        roundTo: Number(bulkRoundTo || 0),
                      }),
                    },
                  );
                  setMessage(`${result.data.updated.toLocaleString('fa-IR')} قلم بروزرسانی شد.`);
                  await load();
                } catch (error) {
                  setMessage((error as Error).message);
                } finally {
                  setBulkBusy(false);
                }
              }}
            >
              {bulkBusy ? 'در حال بروزرسانی…' : 'اعمال تغییر قیمت'}
            </button>
          </div>
          <div className="inventory-table-head inventory-list-head" aria-hidden="true">
            <span>محصول</span>
            <span>برند و کد</span>
            <span>وضعیت و موجودی</span>
            <span>قفسه و قیمت</span>
            <span>عملیات</span>
          </div>
          <div className="inventory-list inventory-flat-list">
            {items.map((item) => {
              const status = stockStatus(item);
              const product = item.product;
              const purchasePrice = Number(item.purchasePrice ?? 0);
              const salePrice = Number(item.salePrice ?? 0);
              const grossProfit =
                salePrice > 0 && purchasePrice > 0 ? salePrice - purchasePrice : null;
              const margin =
                grossProfit !== null && purchasePrice > 0
                  ? (grossProfit / purchasePrice) * 100
                  : null;
              return (
                <article className="inventory-flat-row" key={item.id}>
                  <div className="inventory-product-cell">
                    <span className="product-thumb">
                      {product?.images?.[0]?.path ? (
                        <img src={product.images[0].path} alt={product.name} loading="lazy" />
                      ) : (
                        <span>قطعه</span>
                      )}
                    </span>
                    <div className="inventory-product-info">
                      <b>{product?.name ?? item.barcode}</b>
                      <small dir="ltr">{product?.code ?? 'بدون کد محصول'}</small>
                      {product?.category?.name && (
                        <span className="chip">{product.category.name}</span>
                      )}
                    </div>
                  </div>
                  <div className="inventory-brand-cell">
                    <b>{item.brand?.name ?? 'بدون برند'}</b>
                    <code dir="ltr">{item.barcode}</code>
                  </div>
                  <div className="inventory-stock-cell">
                    <div className="inventory-stock-status">
                      <span className={`badge ${status.badge}`}>{status.label}</span>
                      <b>{formatPersianNumber(item.quantity)} قطعه</b>
                    </div>
                    <div className="inv-stock-line">
                      <i className={`stockbar ${status.bar}`}>
                        <i style={{ width: `${Math.round(stockRatio(item) * 100)}%` }} />
                      </i>
                      {item.minStock != null && item.minStock > 0 && (
                        <small className="muted">حداقل {formatPersianNumber(item.minStock)}</small>
                      )}
                    </div>
                    <StockStepper
                      itemId={item.id}
                      quantity={item.quantity}
                      onMessage={setMessage}
                      onSaved={() => void load()}
                    />
                  </div>
                  <div className="inventory-location-cell">
                    <span
                      className="inv-shelf"
                      title={item.location ? locationLabel(item.location) : 'بدون قفسه'}
                    >
                      {item.location ? `📦 ${locationLabel(item.location)}` : 'بدون قفسه'}
                    </span>
                    <div className="inventory-price">
                      <b>{salePrice > 0 ? formatRial(salePrice) : '—'}</b>
                      <small>قیمت فروش</small>
                      {item.priceUpdatedAt && (
                        <small className="inv-price-date">
                          از {formatJalaliDate(item.priceUpdatedAt)}
                        </small>
                      )}
                    </div>
                    {purchasePrice > 0 && (
                      <small className="inventory-purchase-price">
                        خرید: {formatRial(purchasePrice)}
                      </small>
                    )}
                    {grossProfit !== null && (
                      <span className={`inventory-margin ${grossProfit < 0 ? 'negative' : ''}`}>
                        {grossProfit < 0 ? 'ضرر' : 'سود'}: {formatRial(grossProfit)}
                        {margin !== null ? ` · ${margin.toFixed(1)}٪` : ''}
                      </span>
                    )}
                  </div>
                  <div className="inventory-actions-cell">
                    <button className="row-action" onClick={() => void openDetail(item)}>
                      کارت قلم
                    </button>
                    <button className="row-action" onClick={() => openLabelStudio(item)}>
                      برچسب
                    </button>
                    {product?.id && (
                      <button
                        className="row-action"
                        onClick={() =>
                          void publishGroup({
                            productId: product.id,
                            name: product.name,
                            code: product.code,
                            image: product.images?.[0]?.path,
                            category: product.category?.name,
                            vehicles: [],
                            items: [item],
                          })
                        }
                      >
                        انتشار
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
            {!items.length && (
              <p className="muted">
                {filter ? `قلمی مطابق «${filter}» پیدا نشد.` : 'قلمی یافت نشد.'}
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'shelves' && (
        <div className="shelves-tab">
          {/* Warehouses — the grouping level (انبار اصلی، فروشگاه، …) */}
          <div className="shelves-box">
            <h2>{editingWarehouse ? `ویرایش انبار «${editingWarehouse.name}»` : 'انبارها'}</h2>
            <p className="muted">
              هر انبار یک گروه برای قفسه‌هاست — انبار اصلی، فروشگاه، انبار دوم و… به دلخواه.
            </p>
            <div className="shelves-form">
              <input
                value={warehouseForm.name}
                onChange={(e) => setWarehouseForm({ ...warehouseForm, name: e.target.value })}
                placeholder="نام انبار (مثلاً انبار اصلی)"
              />
              <input
                value={warehouseForm.code}
                onChange={(e) => setWarehouseForm({ ...warehouseForm, code: e.target.value })}
                placeholder="کد مثل W-01"
                dir="ltr"
              />
              <button
                className="button-primary"
                disabled={busy}
                onClick={() => void saveWarehouse()}
              >
                {editingWarehouse ? 'ذخیرهٔ ویرایش' : 'افزودن انبار'}
              </button>
              {editingWarehouse && (
                <button
                  className="outline"
                  onClick={() => {
                    setEditingWarehouse(null);
                    setWarehouseForm({ name: '', code: '' });
                  }}
                >
                  انصراف
                </button>
              )}
            </div>
            <div className="inventory-list">
              {warehouses.map((warehouse) => (
                <div className="inventory-row" key={warehouse.id}>
                  <div className="inv-info">
                    <b>{warehouse.name}</b>
                    <small dir="ltr">{warehouse.code}</small>
                  </div>
                  <span className="chip">
                    {formatPersianNumber(warehouse.children?.length ?? 0)} قفسه ·{' '}
                    {formatPersianNumber(
                      (warehouse.children ?? []).reduce(
                        (sum, child) => sum + (child._count?.items ?? 0),
                        warehouse._count?.items ?? 0,
                      ),
                    )}{' '}
                    قلم
                  </span>
                  <div className="inv-actions">
                    <button className="row-action" onClick={() => startWarehouseEdit(warehouse)}>
                      ویرایش
                    </button>
                    <button
                      className="row-action danger-text"
                      disabled={busy}
                      onClick={() => void removeLocation(warehouse)}
                    >
                      حذف
                    </button>
                  </div>
                </div>
              ))}
              {!warehouses.length && <p className="muted">هنوز انباری ثبت نشده است.</p>}
            </div>
          </div>

          {/* Shelves — placed inside a warehouse (or «بدون انبار») */}
          <div className="shelves-box">
            <h2>{editingShelf ? `ویرایش قفسهٔ «${editingShelf.name}»` : 'قفسه‌ها'}</h2>
            <div className="shelves-form">
              <input
                value={shelfForm.name}
                onChange={(e) => setShelfForm({ ...shelfForm, name: e.target.value })}
                placeholder="نام قفسه (مثلاً قفسه جلو)"
              />
              <input
                value={shelfForm.code}
                onChange={(e) => setShelfForm({ ...shelfForm, code: e.target.value })}
                placeholder="کد مثل A-03"
                dir="ltr"
              />
              <select
                value={shelfForm.parentId}
                onChange={(e) => setShelfForm({ ...shelfForm, parentId: e.target.value })}
              >
                <option value="">بدون انبار</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
              <button className="button-primary" disabled={busy} onClick={() => void saveShelf()}>
                {editingShelf ? 'ذخیرهٔ ویرایش' : 'افزودن قفسه'}
              </button>
              {editingShelf && (
                <button
                  className="outline"
                  onClick={() => {
                    setEditingShelf(null);
                    setShelfForm({ name: '', code: '', parentId: '' });
                  }}
                >
                  انصراف
                </button>
              )}
            </div>
            {locationError && <small className="field-error">{locationError}</small>}
            {[
              ...warehouses.map((warehouse) => ({ id: warehouse.id, name: warehouse.name })),
              { id: '', name: 'بدون انبار' },
            ].map((bucket) => {
              const rows = shelvesOf(bucket.id || null);
              if (!rows.length) return null;
              return (
                <div className="shelf-group" key={bucket.id || 'none'}>
                  <h3>{bucket.name}</h3>
                  <div className="inventory-list">
                    {rows.map((shelf) => (
                      <div className="inventory-row" key={shelf.id}>
                        <div className="inv-info">
                          <b>{shelf.name}</b>
                          <small dir="ltr">{shelf.code}</small>
                        </div>
                        <span className="chip">{locationTypeLabels[shelf.type] ?? shelf.type}</span>
                        <span className="muted">
                          {formatPersianNumber(shelf._count?.items ?? 0)} قلم
                        </span>
                        <div className="inv-actions">
                          <button className="row-action" onClick={() => startShelfEdit(shelf)}>
                            ویرایش
                          </button>
                          <button
                            className="row-action danger-text"
                            disabled={busy}
                            onClick={() => void removeLocation(shelf)}
                          >
                            حذف
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {!shelves.length && <p className="muted">هنوز قفسه‌ای ثبت نشده است.</p>}
          </div>
        </div>
      )}

      <Modal
        open={Boolean(detail)}
        size="lg"
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
            <button
              className="outline danger-text"
              disabled={busy}
              onClick={() => void removeItem()}
            >
              حذف قلم از انبار
            </button>
          </div>
        }
      >
        {detail && (
          <div className="sheet-body inventory-detail-body">
            <div className="inventory-detail-hero">
              <span className="detail-product-thumb">
                {detail.product?.images?.[0]?.path ? (
                  <img src={detail.product.images[0].path} alt="" />
                ) : (
                  <span>قطعه</span>
                )}
              </span>
              <div>
                <small>کارت قلم انبار</small>
                <h4>{detail.product?.name ?? 'قلم بدون محصول'}</h4>
                <code dir="ltr">{detail.product?.code ?? detail.barcode}</code>
              </div>
              <span className={`badge ${stockStatus(detail).badge}`}>
                {stockStatus(detail).label}
              </span>
            </div>
            <dl className="sheet-meta">
              <div>
                <dt>برند</dt>
                <dd>{detail.brand?.name ?? '—'}</dd>
              </div>
              <div>
                <dt>محل نگهداری</dt>
                <dd>{detail.location ? locationLabel(detail.location) : 'بدون قفسه'}</dd>
              </div>
              <div>
                <dt>موجودی فعلی</dt>
                <dd>{formatPersianNumber(detail.quantity)}</dd>
              </div>
              <div>
                <dt>قیمت فروش</dt>
                <dd>
                  {Number(detail.salePrice) > 0 ? formatRial(Number(detail.salePrice)) : 'ثبت نشده'}
                  {detail.priceUpdatedAt && (
                    <small className="inv-price-date">
                      {' '}
                      از {formatJalaliDate(detail.priceUpdatedAt)}
                    </small>
                  )}
                </dd>
              </div>
              <div>
                <dt>قیمت خرید</dt>
                <dd>
                  {Number(detail.purchasePrice ?? 0) > 0
                    ? formatRial(Number(detail.purchasePrice))
                    : 'ثبت نشده'}
                </dd>
              </div>
              <div>
                <dt>سود ناخالص</dt>
                <dd>
                  {Number(detail.salePrice) > 0 && Number(detail.purchasePrice ?? 0) > 0
                    ? formatRial(Number(detail.salePrice) - Number(detail.purchasePrice))
                    : 'قابل محاسبه نیست'}
                </dd>
              </div>
              <div>
                <dt>آستانهٔ هشدار</dt>
                <dd>{detail.minStock != null ? formatPersianNumber(detail.minStock) : '—'}</dd>
              </div>
            </dl>
            <div className="sheet-barcode">
              <BarcodeSvg value={detail.barcode} />
              <code dir="ltr">{detail.barcode}</code>
            </div>
            <div className="two-fields">
              <label>
                ورود کالا (تعداد)
                <FaNumberInput
                  group={false}
                  value={receiveQty}
                  onChange={(plain) => setReceiveQty(plain)}
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
                      {locationLabel(location)}
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
                      {formatPersianNumber(row.quantityChange)}
                    </b>
                    <small>پس از تراکنش: {formatPersianNumber(row.quantityAfter)}</small>
                  </div>
                ))}
              </div>
            )}
            <div className="history price-history">
              <h3>تاریخچهٔ قیمت (شمسی)</h3>
              {priceHistory.length > 0 ? (
                priceHistory.map((row) => (
                  <div key={row.id}>
                    <span title={row.changedAt}>{row.changedAtJalali}</span>
                    <b>
                      {row.oldSalePrice !== null && row.oldSalePrice !== row.newSalePrice
                        ? `${formatRial(Number(row.oldSalePrice))} → `
                        : ''}
                      {formatRial(Number(row.newSalePrice))}
                    </b>
                    <small>
                      {priceSourceLabels[row.source] ?? row.source}
                      {row.userName ? ` · ${row.userName}` : ''}
                    </small>
                  </div>
                ))
              ) : (
                <p className="muted">
                  هنوز تغییری در قیمت فروش این قلم ثبت نشده است؛ از این به بعد هر تغییر قیمت به‌طور
                  خودکار با تاریخ شمسی ثبت می‌شود.
                </p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
