// Extracted building blocks of the old InventoryPage (لیست انبار):
// the «ساختار انبار» management section and the «کارت قلم» detail sheet.
// The unified products page embeds both, so EVERY warehouse capability
// lives in ONE list. Code moved verbatim from InventoryPage.tsx.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from '@salimvand/ui';
import { SupplierBadge } from '../components/SupplierBadge';
import { BarcodeSvg } from '../components/BarcodeSvg';
import { formatJalaliDate, formatPersianNumber, formatRial } from '@salimvand/shared';
import { FaNumberInput } from '../components/FaNumberInput';
import { basketLabel, locationLabel, placementLabel } from '../lib/location-label';

export type Item = {
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
  supplier?: { id: string; name: string } | null;
  location?: { id: string; name: string; code: string; parent?: { name: string } | null };
  /** سبد — the basket (bin) this line is filed in, when it has one. */
  basket?: { id: string; name: string; code: string } | null;
};
type Option = { id: string; name: string };
type Location = {
  id: string;
  name: string;
  code: string;
  type: string;
  parentId?: string | null;
  parent?: { id: string; name: string } | null;
  children?: Array<Location & { _count?: { items: number; basketItems?: number } }>;
  _count?: { items: number; basketItems?: number };
};
type VehicleMake = {
  id: string;
  name: string;
  models: Array<{ id: string; name: string; trims: Array<{ id: string; name: string }> }>;
};

type Transaction = { id: string; type: string; quantityChange: number; quantityAfter: number };

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

/** Depth in the placement tree: انبار = 0، قفسه = 1، سبد = 2. */
const locationDepth = (location: { type: string }) =>
  location.type === 'warehouse' ? 0 : location.type === 'basket' ? 2 : 1;

const locationTypeLabels: Record<string, string> = {
  warehouse: 'انبار',
  aisle: 'راهرو',
  shelf: 'قفسه',
  level: 'طبقه',
  box: 'باکس',
  basket: 'سبد',
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

/**
 * «ساختار انبار» — warehouses, shelves and baskets management, extracted
 * from the old InventoryPage so the unified products page can embed it as
 * one collapsible section (ONE list, ALL capabilities).
 */
export function WarehouseStructureSection({
  onMessage,
}: {
  onMessage: (text: string) => void;
}) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [busy, setBusy] = useState(false);
  const [warehouseForm, setWarehouseForm] = useState({ name: '', code: '' });
  const [editingWarehouse, setEditingWarehouse] = useState<Location | null>(null);
  const [shelfForm, setShelfForm] = useState({ name: '', code: '', parentId: '' });
  const [editingShelf, setEditingShelf] = useState<Location | null>(null);
  // سبدها — bins inside one shelf. The third level of the placement tree:
  // انبار › قفسه › سبد. A part may be filed straight on a shelf or into one
  // of its baskets, so both are managed here.
  const [basketForm, setBasketForm] = useState({ name: '', code: '', parentId: '' });
  const [editingBasket, setEditingBasket] = useState<Location | null>(null);
  const [locationError, setLocationError] = useState('');
  // تب «قفسه‌ها و سبدها» خودش سه تب دارد (انبارها / قفسه‌ها / سبدها) —
  // در یک صفحهٔ واحد همهٔ آن‌ها روی هم تلنبار می‌شد و کار با آن سخت بود.
  const [locationTab, setLocationTab] = useState<'warehouses' | 'shelves' | 'baskets'>('shelves');
  // جست‌وجو و فیلترِ هر سطح — یک فروشگاه واقعی ۱۴۰+ قفسه دارد، بدون فیلتر
  // پیدا کردن یک قفسه در لیست ممکن نیست.
  const [locationQuery, setLocationQuery] = useState('');
  const [shelfWarehouseFilter, setShelfWarehouseFilter] = useState('');
  const [basketShelfFilter, setBasketShelfFilter] = useState('');

  const loadLocations = () =>
    api<{ data: Location[] }>('/locations')
      // Warehouses first, then shelves in numeric code order (۱.۱ … ۱۰.۱ … ۲۰.۷)
      // — the API's plain string sort would push shelf 10-19 between 1 and 2.
      .then((r) =>
        setLocations(
          [...r.data].sort(
            (a, b) =>
              // انبار › قفسه › سبد — depth first, then the human code order
              // (۱.۱ … ۱۰.۱ … ۲۰.۷) inside each level.
              locationDepth(a) - locationDepth(b) ||
              a.code.localeCompare(b.code, 'en', { numeric: true }),
          ),
        ),
      )
      .catch(() => undefined);

  useEffect(() => {
    loadLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const warehouses = locations.filter(
    (location) => !location.parentId && location.type === 'warehouse',
  );
  const shelves = locations.filter(
    (location) =>
      location.type !== 'basket' && (location.parentId || location.type !== 'warehouse'),
  );
  const shelvesOf = (parentId: string | null) =>
    shelves.filter((location) => (location.parentId ?? null) === parentId);
  /** سبدها — bins of one shelf (parentId always points at a shelf). */
  const baskets = locations.filter((location) => location.type === 'basket');
  const basketsOf = (shelfId: string | null) =>
    baskets.filter((location) => (location.parentId ?? null) === shelfId);
  const itemsInBasket = (basket: Location) => basket._count?.basketItems ?? 0;
  /** خلاصهٔ یک انبار برای جدول: تعداد قفسه‌ها، سبدهای آن‌ها و اقلامِ روی قفسه. */
  const warehouseStats = (warehouse: Location) => {
    const rows = warehouse.children ?? [];
    return {
      shelves: rows.length,
      baskets: rows.reduce((sum, shelf) => sum + (shelf.children?.length ?? 0), 0),
      items: rows.reduce((sum, shelf) => sum + (shelf._count?.items ?? 0), 0),
    };
  };
  /** جست‌وجو در نام و کدِ یک محل (با ارقام فارسی/لاتین یکسان). */
  const matchesLocationQuery = (location: Location) => {
    const query = locationQuery.trim().toLocaleLowerCase('fa');
    if (!query) return true;
    return `${location.name} ${location.code}`.toLocaleLowerCase('fa').includes(query);
  };
  const visibleWarehouses = warehouses.filter(matchesLocationQuery);
  const visibleShelves = shelves.filter(
    (location) =>
      matchesLocationQuery(location) &&
      (!shelfWarehouseFilter || location.parentId === shelfWarehouseFilter),
  );
  const visibleBaskets = baskets.filter(
    (location) =>
      matchesLocationQuery(location) &&
      (!basketShelfFilter || location.parentId === basketShelfFilter),
  );
  /** گروه‌بندیِ نمایشی: هر لیست زیرِ والد خودش (انبار › قفسه، قفسه › سبد). */
  const locationBuckets = (
    rows: Location[],
    parents: Array<{ id: string; name: string }>,
    orphanLabel: string,
  ) => {
    const bucketMap = new Map<string, { id: string; name: string; rows: Location[] }>();
    for (const row of rows) {
      const key = row.parentId ?? '';
      const bucket = bucketMap.get(key) ?? {
        id: key,
        name: parents.find((parent) => parent.id === key)?.name ?? orphanLabel,
        rows: [],
      };
      bucket.rows.push(row);
      bucketMap.set(key, bucket);
    }
    return [...bucketMap.values()];
  };
  const shelfBuckets = locationBuckets(
    visibleShelves,
    warehouses.map((warehouse) => ({ id: warehouse.id, name: warehouse.name })),
    'بدون انبار',
  );
  const basketBuckets = locationBuckets(
    visibleBaskets,
    shelves.map((shelf) => ({ id: shelf.id, name: locationLabel(shelf) })),
    'بدون قفسه',
  );

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
        onMessage('انبار ویرایش شد');
      } else {
        await api('/locations', {
          method: 'POST',
          body: JSON.stringify({ ...warehouseForm, type: 'warehouse' }),
        });
        onMessage('انبار ایجاد شد');
      }
      setWarehouseForm({ name: '', code: '' });
      setEditingWarehouse(null);
      await loadLocations();
    } catch (e) {
      onMessage((e as Error).message);
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
        onMessage('قفسه ویرایش شد');
      } else {
        await api('/locations', {
          method: 'POST',
          body: JSON.stringify({ ...shelfForm, type: 'shelf' }),
        });
        onMessage('قفسه ایجاد شد');
      }
      setShelfForm({ name: '', code: '', parentId: '' });
      setEditingShelf(null);
      await loadLocations();
    } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const startBasketEdit = (basket: Location) => {
    setEditingBasket(basket);
    setLocationError('');
    setBasketForm({ name: basket.name, code: basket.code, parentId: basket.parentId ?? '' });
  };
  const saveBasket = async () => {
    if (!basketForm.name.trim() || !basketForm.code.trim())
      return setLocationError('نام و کد سبد الزامی است');
    if (!basketForm.parentId) return setLocationError('سبد باید داخل یک قفسه تعریف شود');
    setLocationError('');
    setBusy(true);
    try {
      if (editingBasket) {
        await api(`/locations/${editingBasket.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: basketForm.name,
            code: basketForm.code,
            parentId: basketForm.parentId,
          }),
        });
        onMessage('سبد ویرایش شد');
      } else {
        await api('/locations', {
          method: 'POST',
          body: JSON.stringify({ ...basketForm, type: 'basket' }),
        });
        onMessage('سبد ایجاد شد');
      }
      setBasketForm({ name: '', code: '', parentId: '' });
      setEditingBasket(null);
      await loadLocations();
    } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const removeLocation = async (location: Location) => {
    const isWarehouse = !location.parentId && location.type === 'warehouse';
    const isBasket = location.type === 'basket';
    const items = isBasket ? itemsInBasket(location) : (location._count?.items ?? 0);
    const question = isWarehouse
      ? `انبار «${location.name}» حذف شود؟`
      : isBasket
        ? items > 0
          ? `سبد «${location.name}» حذف شود؟ ${formatPersianNumber(items)} قلم کالا از سبد خارج می‌شوند (روی قفسه می‌مانند) — موجودی آن‌ها حذف نمی‌شود.`
          : `سبد «${location.name}» حذف شود؟`
        : items > 0
          ? `قفسهٔ «${location.name}» حذف شود؟ ${formatPersianNumber(items)} قلم کالا بدون قفسه می‌شوند — موجودی آن‌ها حذف نمی‌شود.`
          : `قفسهٔ «${location.name}» حذف شود؟`;
    if (!window.confirm(question)) return;
    setBusy(true);
    try {
      const result = await api<{ data: { detachedItems: number } }>(`/locations/${location.id}`, {
        method: 'DELETE',
      });
      onMessage(
        result.data.detachedItems > 0
          ? `محل حذف شد؛ ${formatPersianNumber(result.data.detachedItems)} قلم ${
              isBasket ? 'از سبد خارج شدند' : 'بدون قفسه شدند'
            }`
          : 'محل حذف شد',
      );
      await loadLocations();
          } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inv-structure">
        <div className="shelves-tab">
          {/* سه سطحِ درختِ مکان‌ها در سه تب جدا — انبارها / قفسه‌ها / سبدها
              — درست مثل تب‌های صفحهٔ فاکتورها. روی هم چیدنِ هر سه فرم در یک
              صفحه، تجربهٔ کاربریِ این بخش را خراب کرده بود. */}
          <nav className="settings-tabs seg-tabs locations-seg" aria-label="سطوح مکان‌ها">
            {[
              {
                id: 'warehouses' as const,
                label: 'انبارها',
                hint: 'گروه‌بندی قفسه‌ها',
                count: warehouses.length,
              },
              {
                id: 'shelves' as const,
                label: 'قفسه‌ها',
                hint: 'محل اصلی نگهداری کالا',
                count: shelves.length,
              },
              {
                id: 'baskets' as const,
                label: 'سبدها',
                hint: 'ظرف‌های داخل هر قفسه',
                count: baskets.length,
              },
            ].map((entry) => (
              <button
                type="button"
                key={entry.id}
                className={locationTab === entry.id ? 'active' : ''}
                onClick={() => {
                  setLocationTab(entry.id);
                  setLocationQuery('');
                  setLocationError('');
                }}
                aria-current={locationTab === entry.id ? 'true' : undefined}
              >
                <b>
                  {entry.label} · {formatPersianNumber(entry.count)}
                </b>
                <small>{entry.hint}</small>
              </button>
            ))}
          </nav>

          {locationTab === 'warehouses' && (
            <section className="loc-panel" aria-label="انبارها">
              <header className="loc-panel-head">
                <div>
                  <h2>
                    {editingWarehouse ? `ویرایش انبار «${editingWarehouse.name}»` : 'افزودن انبار'}
                  </h2>
                  <p className="muted">
                    هر انبار یک گروه برای قفسه‌هاست — انبار اصلی، فروشگاه، انبار دوم و… به دلخواه.
                  </p>
                </div>
                <span className="count">
                  {formatPersianNumber(visibleWarehouses.length)} انبار
                </span>
              </header>

              <form
                className="loc-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveWarehouse();
                }}
              >
                <label>
                  نام انبار
                  <input
                    value={warehouseForm.name}
                    onChange={(e) => setWarehouseForm({ ...warehouseForm, name: e.target.value })}
                    placeholder="مثلاً انبار اصلی"
                  />
                </label>
                <label>
                  کد انبار
                  <input
                    value={warehouseForm.code}
                    onChange={(e) => setWarehouseForm({ ...warehouseForm, code: e.target.value })}
                    placeholder="W-01"
                    dir="ltr"
                  />
                </label>
                <div className="loc-form-actions">
                  <button className="button-primary" type="submit" disabled={busy}>
                    {editingWarehouse ? 'ذخیرهٔ ویرایش' : 'افزودن انبار'}
                  </button>
                  {editingWarehouse && (
                    <button
                      type="button"
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
              </form>
              {locationError && <small className="field-error">{locationError}</small>}

              <div className="loc-list loc-5" role="table" aria-label="فهرست انبارها">
                <div className="loc-head" role="row">
                  <span role="columnheader">نام انبار</span>
                  <span role="columnheader">کد</span>
                  <span role="columnheader">قفسه‌ها</span>
                  <span role="columnheader">سبدها</span>
                  <span role="columnheader">عملیات</span>
                </div>
                {visibleWarehouses.map((warehouse) => {
                  const stats = warehouseStats(warehouse);
                  return (
                    <div className="loc-row" role="row" key={warehouse.id}>
                      <span className="loc-cell loc-name" role="cell" data-label="نام انبار">
                        <b>{warehouse.name}</b>
                      </span>
                      <span className="loc-cell loc-code" role="cell" data-label="کد" dir="ltr">
                        {warehouse.code}
                      </span>
                      <span className="loc-cell" role="cell" data-label="قفسه‌ها">
                        {formatPersianNumber(stats.shelves)} قفسه
                      </span>
                      <span className="loc-cell" role="cell" data-label="سبدها">
                        {formatPersianNumber(stats.baskets)} سبد ·{' '}
                        {formatPersianNumber(stats.items)} قلم
                      </span>
                      <span className="loc-cell loc-actions" role="cell" data-label="عملیات">
                        <button
                          className="row-action"
                          onClick={() => startWarehouseEdit(warehouse)}
                        >
                          ویرایش
                        </button>
                        <button
                          className="row-action danger-text"
                          disabled={busy}
                          onClick={() => void removeLocation(warehouse)}
                        >
                          حذف
                        </button>
                      </span>
                    </div>
                  );
                })}
                {!visibleWarehouses.length && (
                  <p className="loc-empty muted">
                    {warehouses.length
                      ? 'انباری با این جست‌وجو پیدا نشد.'
                      : 'هنوز انباری ثبت نشده است.'}
                  </p>
                )}
              </div>
            </section>
          )}

          {locationTab === 'shelves' && (
            <section className="loc-panel" aria-label="قفسه‌ها">
              <header className="loc-panel-head">
                <div>
                  <h2>{editingShelf ? `ویرایش قفسهٔ «${editingShelf.name}»` : 'افزودن قفسه'}</h2>
                  <p className="muted">
                    هر قفسه داخل یک انبار است و می‌تواند چند سبد داشته باشد — آدرس کالا
                    «انبار · قفسه · سبد» است.
                  </p>
                </div>
                <span className="count">{formatPersianNumber(visibleShelves.length)} قفسه</span>
              </header>

              <form
                className="loc-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveShelf();
                }}
              >
                <label>
                  نام قفسه
                  <input
                    value={shelfForm.name}
                    onChange={(e) => setShelfForm({ ...shelfForm, name: e.target.value })}
                    placeholder="مثلاً قفسه جلو"
                  />
                </label>
                <label>
                  کد قفسه
                  <input
                    value={shelfForm.code}
                    onChange={(e) => setShelfForm({ ...shelfForm, code: e.target.value })}
                    placeholder="A-03"
                    dir="ltr"
                  />
                </label>
                <label>
                  انبار
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
                </label>
                <div className="loc-form-actions">
                  <button className="button-primary" type="submit" disabled={busy}>
                    {editingShelf ? 'ذخیرهٔ ویرایش' : 'افزودن قفسه'}
                  </button>
                  {editingShelf && (
                    <button
                      type="button"
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
              </form>
              {locationError && <small className="field-error">{locationError}</small>}

              <div className="loc-filters">
                <div className="search-field">
                  <span className="search-icon">⌕</span>
                  <input
                    value={locationQuery}
                    onChange={(e) => setLocationQuery(e.target.value)}
                    placeholder="جست‌وجو در نام یا کد قفسه…"
                  />
                </div>
                <select
                  value={shelfWarehouseFilter}
                  onChange={(e) => setShelfWarehouseFilter(e.target.value)}
                  aria-label="فیلتر بر اساس انبار"
                >
                  <option value="">همهٔ انبارها</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="loc-list loc-6" role="table" aria-label="فهرست قفسه‌ها">
                <div className="loc-head" role="row">
                  <span role="columnheader">قفسه</span>
                  <span role="columnheader">کد</span>
                  <span role="columnheader">انبار</span>
                  <span role="columnheader">سبدها</span>
                  <span role="columnheader">اقلام</span>
                  <span role="columnheader">عملیات</span>
                </div>
                {shelfBuckets.map((bucket) => (
                  <div className="loc-bucket" key={bucket.id || 'none'}>
                    <div className="loc-bucket-head">
                      <b>{bucket.name}</b>
                      <small>{formatPersianNumber(bucket.rows.length)} قفسه</small>
                    </div>
                    {bucket.rows.map((shelf) => (
                      <div className="loc-row" role="row" key={shelf.id}>
                        <span className="loc-cell loc-name" role="cell" data-label="قفسه">
                          <b>{shelf.name}</b>
                        </span>
                        <span className="loc-cell loc-code" role="cell" data-label="کد" dir="ltr">
                          {shelf.code}
                        </span>
                        <span className="loc-cell" role="cell" data-label="انبار">
                          {warehouses.find((row) => row.id === shelf.parentId)?.name ?? (
                            <span className="loc-dash">بدون انبار</span>
                          )}
                        </span>
                        <span className="loc-cell" role="cell" data-label="سبدها">
                          {formatPersianNumber(shelf.children?.length ?? 0)} سبد
                        </span>
                        <span className="loc-cell" role="cell" data-label="اقلام">
                          {formatPersianNumber(shelf._count?.items ?? 0)} قلم
                        </span>
                        <span className="loc-cell loc-actions" role="cell" data-label="عملیات">
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
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
                {!visibleShelves.length && (
                  <p className="loc-empty muted">
                    {shelves.length
                      ? 'قفسه‌ای با این فیلتر پیدا نشد.'
                      : 'هنوز قفسه‌ای ثبت نشده است.'}
                  </p>
                )}
              </div>
            </section>
          )}

          {locationTab === 'baskets' && (
            <section className="loc-panel" aria-label="سبدها">
              <header className="loc-panel-head">
                <div>
                  <h2>{editingBasket ? `ویرایش سبد «${editingBasket.name}»` : 'افزودن سبد'}</h2>
                  <p className="muted">
                    هر سبد یک ظرفِ مشخص داخل یک قفسه است — «قفسه A-03، سبد ۲». کالا می‌تواند
                    مستقیماً روی قفسه باشد یا داخل یکی از سبدهای همان قفسه.
                  </p>
                </div>
                <span className="count">{formatPersianNumber(visibleBaskets.length)} سبد</span>
              </header>

              <form
                className="loc-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveBasket();
                }}
              >
                <label>
                  نام سبد
                  <input
                    value={basketForm.name}
                    onChange={(e) => setBasketForm({ ...basketForm, name: e.target.value })}
                    placeholder="مثلاً سبد ۲"
                  />
                </label>
                <label>
                  کد سبد
                  <input
                    value={basketForm.code}
                    onChange={(e) => setBasketForm({ ...basketForm, code: e.target.value })}
                    placeholder="B-2"
                    dir="ltr"
                  />
                </label>
                <label>
                  قفسه
                  <select
                    value={basketForm.parentId}
                    onChange={(e) => setBasketForm({ ...basketForm, parentId: e.target.value })}
                  >
                    <option value="">قفسه را انتخاب کنید…</option>
                    {shelves.map((shelf) => (
                      <option key={shelf.id} value={shelf.id}>
                        {locationLabel(shelf)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="loc-form-actions">
                  <button className="button-primary" type="submit" disabled={busy}>
                    {editingBasket ? 'ذخیرهٔ ویرایش' : 'افزودن سبد'}
                  </button>
                  {editingBasket && (
                    <button
                      type="button"
                      className="outline"
                      onClick={() => {
                        setEditingBasket(null);
                        setBasketForm({ name: '', code: '', parentId: '' });
                      }}
                    >
                      انصراف
                    </button>
                  )}
                </div>
              </form>
              {locationError && <small className="field-error">{locationError}</small>}

              <div className="loc-filters">
                <div className="search-field">
                  <span className="search-icon">⌕</span>
                  <input
                    value={locationQuery}
                    onChange={(e) => setLocationQuery(e.target.value)}
                    placeholder="جست‌وجو در نام یا کد سبد…"
                  />
                </div>
                <select
                  value={basketShelfFilter}
                  onChange={(e) => setBasketShelfFilter(e.target.value)}
                  aria-label="فیلتر بر اساس قفسه"
                >
                  <option value="">همهٔ قفسه‌ها</option>
                  {shelves.map((shelf) => (
                    <option key={shelf.id} value={shelf.id}>
                      {locationLabel(shelf)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="loc-list loc-5" role="table" aria-label="فهرست سبدها">
                <div className="loc-head" role="row">
                  <span role="columnheader">سبد</span>
                  <span role="columnheader">کد</span>
                  <span role="columnheader">قفسه</span>
                  <span role="columnheader">اقلام</span>
                  <span role="columnheader">عملیات</span>
                </div>
                {basketBuckets.map((bucket) => (
                  <div className="loc-bucket" key={bucket.id || 'none'}>
                    <div className="loc-bucket-head">
                      <b>{bucket.name}</b>
                      <small>{formatPersianNumber(bucket.rows.length)} سبد</small>
                    </div>
                    {bucket.rows.map((basket) => (
                      <div className="loc-row" role="row" key={basket.id}>
                        <span className="loc-cell loc-name" role="cell" data-label="سبد">
                          <b>{basket.name}</b>
                        </span>
                        <span className="loc-cell loc-code" role="cell" data-label="کد" dir="ltr">
                          {basket.code}
                        </span>
                        <span className="loc-cell" role="cell" data-label="قفسه">
                          <span className="place-chip" title={bucket.name}>
                            {shelves.find((row) => row.id === basket.parentId)?.code ?? bucket.name}
                          </span>
                        </span>
                        <span className="loc-cell" role="cell" data-label="اقلام">
                          {formatPersianNumber(itemsInBasket(basket))} قلم
                        </span>
                        <span className="loc-cell loc-actions" role="cell" data-label="عملیات">
                          <button className="row-action" onClick={() => startBasketEdit(basket)}>
                            ویرایش
                          </button>
                          <button
                            className="row-action danger-text"
                            disabled={busy}
                            onClick={() => void removeLocation(basket)}
                          >
                            حذف
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
                {!visibleBaskets.length && (
                  <p className="loc-empty muted">
                    {baskets.length
                      ? 'سبدی با این فیلتر پیدا نشد.'
                      : 'هنوز سبدی ثبت نشده است — کالاها فعلاً مستقیماً روی قفسه‌ها هستند.'}
                  </p>
                )}
              </div>
            </section>
          )}
        </div>
    </div>
  );
}


/**
 * «کارت قلم» — the detail sheet of one stock line: identity, prices,
 * placement, ledger + price history, bulk receive, shelf/basket transfer,
 * supplier switch and delete. Extracted from the old InventoryPage; the
 * unified products list opens it from every stock line row.
 */
export function InventoryItemSheet({
  item,
  suppliers,
  locations,
  onClose,
  onMessage,
  onChanged,
}: {
  item: Item | null;
  suppliers: Option[];
  locations: Location[];
  onClose: () => void;
  onMessage: (text: string) => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Item | null>(item);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryRow[]>([]);
  const [transferLocation, setTransferLocation] = useState('');
  const [transferBasket, setTransferBasket] = useState('');
  const [receiveQty, setReceiveQty] = useState('');
  const onSheetClose = () => {
    setDetail(null);
    onClose();
  };
  // Placement helpers for the transfer selects.
  const shelves = locations.filter((location) => location.type !== 'basket');
  const baskets = locations.filter((location) => location.type === 'basket');
  const basketsOf = (shelfId: string | null) =>
    baskets.filter((location) => (location.parentId ?? null) === shelfId);

  useEffect(() => {
    void (async () => {
    if (!item) return;
    setDetail(item);
    setTransferLocation(item.location?.id ?? '');
    setTransferBasket(item.basket?.id ?? '');
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
      onMessage((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, [item?.id]);

  const removeItem = async () => {
    if (!detail || !window.confirm(`قلم «${detail.product?.name ?? ''}» حذف شود؟`)) return;
    setBusy(true);
    try {
      await api(`/inventory/items/${detail.id}`, { method: 'DELETE' });
      onMessage('قلم از لیست انبار حذف شد');
      onSheetClose();
      onChanged();
    } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const transfer = async () => {
    if (!detail || !transferLocation) return onMessage('قفسهٔ مقصد را انتخاب کنید');
    // A basket must belong to the destination shelf — the select is filtered,
    // but switching the shelf after picking a basket would otherwise post a
    // placement the API rejects.
    if (transferBasket && basketsOf(transferLocation).every((row) => row.id !== transferBasket))
      return onMessage('سبد انتخاب‌شده متعلق به این قفسه نیست');
    setBusy(true);
    try {
      await api('/inventory/transfer', {
        method: 'POST',
        body: JSON.stringify({
          itemId: detail.id,
          locationId: transferLocation,
          basketId: transferBasket || null,
        }),
      });
      onMessage(transferBasket ? 'انتقال قفسه و سبد ثبت شد' : 'انتقال قفسه ثبت شد');
      setDetail({
        ...detail,
        location: locations.find((l) => l.id === transferLocation),
        basket: baskets.find((row) => row.id === transferBasket) ?? null,
      });
      onChanged();
    } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const receive = async () => {
    const qty = Number(receiveQty);
    if (!detail || !Number.isInteger(qty) || qty <= 0)
      return onMessage('تعداد ورود باید عدد صحیح مثبت باشد');
    setBusy(true);
    try {
      await api('/inventory/receive', {
        method: 'POST',
        body: JSON.stringify({ itemId: detail.id, quantity: qty, reason: 'ورود از کارت قلم' }),
      });
      onMessage('ورود کالا ثبت شد');
      onChanged();
      setDetail({ ...detail, quantity: detail.quantity + qty });
    } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
        open={Boolean(detail)}
        size="lg"
        title={detail ? `کارت قلم — ${detail.product?.name ?? ''}` : ''}
        onClose={onSheetClose}
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
                <dt>تأمین‌کننده</dt>
                <dd>
                  {detail.supplier?.name ? (
                    <SupplierBadge name={detail.supplier.name} />
                  ) : (
                    'ثبت نشده'
                  )}
                </dd>
              </div>
              <div>
                <dt>محل نگهداری</dt>
                <dd>
                  {detail.location || detail.basket ? (
                    placementLabel(detail)
                  ) : (
                    'بدون قفسه'
                  )}
                </dd>
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
                تأمین‌کننده
                <select
                  value={detail.supplier?.id ?? ''}
                  onChange={async (e) => {
                    const supId = e.target.value;
                    try {
                      await api(`/inventory/items/${detail.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ supplierId: supId || null }),
                      });
                      onMessage('تأمین‌کننده به‌روزرسانی شد');
                      const selectedSup = suppliers.find((s) => s.id === supId);
                      setDetail({
                        ...detail,
                        supplier: selectedSup ? { id: selectedSup.id, name: selectedSup.name } : null,
                      });
                      await onChanged();
                    } catch (err) {
                      onMessage((err as Error).message);
                    }
                  }}
                >
                  <option value="">بدون تأمین‌کننده</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
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
                  onChange={(e) => {
                    setTransferLocation(e.target.value);
                    // A basket only makes sense inside the new shelf.
                    setTransferBasket('');
                  }}
                >
                  <option value="">بدون قفسه</option>
                  {shelves.map((location) => (
                    <option key={location.id} value={location.id}>
                      {locationLabel(location)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                سبد مقصد (اختیاری)
                <select
                  value={transferBasket}
                  disabled={!transferLocation}
                  onChange={(e) => setTransferBasket(e.target.value)}
                >
                  <option value="">بدون سبد (روی قفسه)</option>
                  {basketsOf(transferLocation || null).map((basket) => (
                    <option key={basket.id} value={basket.id}>
                      {basketLabel(basket)}
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
  );
}

