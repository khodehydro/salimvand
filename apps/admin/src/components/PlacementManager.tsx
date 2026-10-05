import { useState } from 'react';
import { formatPersianNumber } from '@salimvand/shared';
import { api } from '../lib/api';
import type { Location } from '../lib/catalog-types';
import { locationLabel } from '../lib/location-label';

/**
 * «قفسه‌ها و سبدها» — the placement tree of the store in one panel:
 * انبار › قفسه › سبد, each level as its own sub-tab with a form, a filter and
 * a real columnar table. Opened as a floating dialog from the unified
 * محصولات و انبار toolbar, so the list behind it stays the single workspace.
 */
export function PlacementManager({
  locations,
  canEdit = true,
  onRefresh,
  onMessage,
  onClose,
}: {
  locations: Location[];
  /** Managers may write the tree; warehouse operators only see it. */
  canEdit?: boolean;
  onRefresh: () => void | Promise<void>;
  onMessage: (text: string) => void;
  onClose: () => void;
}) {
  const [locationTab, setLocationTab] = useState<'warehouses' | 'shelves' | 'baskets'>('shelves');
  const [locationQuery, setLocationQuery] = useState('');
  const [shelfWarehouseFilter, setShelfWarehouseFilter] = useState('');
  const [basketShelfFilter, setBasketShelfFilter] = useState('');
  const [warehouseForm, setWarehouseForm] = useState({ name: '', code: '' });
  const [editingWarehouse, setEditingWarehouse] = useState<Location | null>(null);
  const [shelfForm, setShelfForm] = useState({ name: '', code: '', parentId: '' });
  const [editingShelf, setEditingShelf] = useState<Location | null>(null);
  const [basketForm, setBasketForm] = useState({ name: '', code: '', parentId: '' });
  const [editingBasket, setEditingBasket] = useState<Location | null>(null);
  const [locationError, setLocationError] = useState('');
  const [busy, setBusy] = useState(false);

  const warehouses = locations.filter(
    (location) => !location.parentId && location.type === 'warehouse',
  );
  const shelves = locations.filter(
    (location) =>
      location.type !== 'basket' && (location.parentId || location.type !== 'warehouse'),
  );
  const baskets = locations.filter((location) => location.type === 'basket');
  const itemsInBasket = (basket: Location) => basket._count?.basketItems ?? 0;

  const warehouseStats = (warehouse: Location) => {
    const rows = warehouse.children ?? [];
    return {
      shelves: rows.length,
      baskets: rows.reduce((sum, shelf) => sum + (shelf.children?.length ?? 0), 0),
      items: rows.reduce((sum, shelf) => sum + (shelf._count?.items ?? 0), 0),
    };
  };

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

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      onMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveWarehouse = () =>
    run(async () => {
      if (!warehouseForm.name.trim() || !warehouseForm.code.trim())
        return setLocationError('نام و کد انبار الزامی است');
      setLocationError('');
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
      await onRefresh();
    });

  const saveShelf = () =>
    run(async () => {
      if (!shelfForm.name.trim() || !shelfForm.code.trim())
        return setLocationError('نام و کد قفسه الزامی است');
      setLocationError('');
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
      await onRefresh();
    });

  const saveBasket = () =>
    run(async () => {
      if (!basketForm.name.trim() || !basketForm.code.trim())
        return setLocationError('نام و کد سبد الزامی است');
      if (!basketForm.parentId) return setLocationError('سبد باید داخل یک قفسه تعریف شود');
      setLocationError('');
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
      await onRefresh();
    });

  const removeLocation = (location: Location) =>
    run(async () => {
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
      await onRefresh();
    });

  return (
    <div className="placement-manager">
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
            <span className="count">{formatPersianNumber(visibleWarehouses.length)} انبار</span>
          </header>
          {canEdit && (
            <form
              className="loc-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveWarehouse();
              }}
            >
              <label>
                نام انبار
                <input
                  value={warehouseForm.name}
                  onChange={(event) =>
                    setWarehouseForm({ ...warehouseForm, name: event.target.value })
                  }
                  placeholder="مثلاً انبار اصلی"
                />
              </label>
              <label>
                کد انبار
                <input
                  value={warehouseForm.code}
                  onChange={(event) =>
                    setWarehouseForm({ ...warehouseForm, code: event.target.value })
                  }
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
          )}
          {canEdit && locationError && <small className="field-error">{locationError}</small>}
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
                    {formatPersianNumber(stats.baskets)} سبد · {formatPersianNumber(stats.items)}{' '}
                    قلم
                  </span>
                  <span className="loc-cell loc-actions" role="cell" data-label="عملیات">
                    {canEdit && (
                      <>
                        <button
                          className="row-action"
                          onClick={() => {
                            setEditingWarehouse(warehouse);
                            setLocationError('');
                            setWarehouseForm({ name: warehouse.name, code: warehouse.code });
                          }}
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
                      </>
                    )}
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
                هر قفسه داخل یک انبار است و می‌تواند چند سبد داشته باشد — آدرس کالا «انبار · قفسه ·
                سبد» است.
              </p>
            </div>
            <span className="count">{formatPersianNumber(visibleShelves.length)} قفسه</span>
          </header>
          {canEdit && (
            <form
              className="loc-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveShelf();
              }}
            >
              <label>
                نام قفسه
                <input
                  value={shelfForm.name}
                  onChange={(event) => setShelfForm({ ...shelfForm, name: event.target.value })}
                  placeholder="مثلاً قفسه جلو"
                />
              </label>
              <label>
                کد قفسه
                <input
                  value={shelfForm.code}
                  onChange={(event) => setShelfForm({ ...shelfForm, code: event.target.value })}
                  placeholder="A-03"
                  dir="ltr"
                />
              </label>
              <label>
                انبار
                <select
                  value={shelfForm.parentId}
                  onChange={(event) => setShelfForm({ ...shelfForm, parentId: event.target.value })}
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
          )}
          {canEdit && locationError && <small className="field-error">{locationError}</small>}
          <div className="loc-filters">
            <div className="search-field">
              <span className="search-icon">⌕</span>
              <input
                value={locationQuery}
                onChange={(event) => setLocationQuery(event.target.value)}
                placeholder="جست‌وجو در نام یا کد قفسه…"
              />
            </div>
            <select
              value={shelfWarehouseFilter}
              onChange={(event) => setShelfWarehouseFilter(event.target.value)}
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
                      {canEdit && (
                        <>
                          <button
                            className="row-action"
                            onClick={() => {
                              setEditingShelf(shelf);
                              setLocationError('');
                              setShelfForm({
                                name: shelf.name,
                                code: shelf.code,
                                parentId: shelf.parentId ?? '',
                              });
                            }}
                          >
                            ویرایش
                          </button>
                          <button
                            className="row-action danger-text"
                            disabled={busy}
                            onClick={() => void removeLocation(shelf)}
                          >
                            حذف
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {!visibleShelves.length && (
              <p className="loc-empty muted">
                {shelves.length ? 'قفسه‌ای با این فیلتر پیدا نشد.' : 'هنوز قفسه‌ای ثبت نشده است.'}
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
                هر سبد یک ظرفِ مشخص داخل یک قفسه است — «قفسه A-03، سبد ۲». کالا می‌تواند مستقیماً
                روی قفسه باشد یا داخل یکی از سبدهای همان قفسه.
              </p>
            </div>
            <span className="count">{formatPersianNumber(visibleBaskets.length)} سبد</span>
          </header>
          {canEdit && (
            <form
              className="loc-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveBasket();
              }}
            >
              <label>
                نام سبد
                <input
                  value={basketForm.name}
                  onChange={(event) => setBasketForm({ ...basketForm, name: event.target.value })}
                  placeholder="مثلاً سبد ۲"
                />
              </label>
              <label>
                کد سبد
                <input
                  value={basketForm.code}
                  onChange={(event) => setBasketForm({ ...basketForm, code: event.target.value })}
                  placeholder="B-2"
                  dir="ltr"
                />
              </label>
              <label>
                قفسه
                <select
                  value={basketForm.parentId}
                  onChange={(event) =>
                    setBasketForm({ ...basketForm, parentId: event.target.value })
                  }
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
          )}
          {canEdit && locationError && <small className="field-error">{locationError}</small>}
          <div className="loc-filters">
            <div className="search-field">
              <span className="search-icon">⌕</span>
              <input
                value={locationQuery}
                onChange={(event) => setLocationQuery(event.target.value)}
                placeholder="جست‌وجو در نام یا کد سبد…"
              />
            </div>
            <select
              value={basketShelfFilter}
              onChange={(event) => setBasketShelfFilter(event.target.value)}
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
                      {canEdit && (
                        <>
                          <button
                            className="row-action"
                            onClick={() => {
                              setEditingBasket(basket);
                              setLocationError('');
                              setBasketForm({
                                name: basket.name,
                                code: basket.code,
                                parentId: basket.parentId ?? '',
                              });
                            }}
                          >
                            ویرایش
                          </button>
                          <button
                            className="row-action danger-text"
                            disabled={busy}
                            onClick={() => void removeLocation(basket)}
                          >
                            حذف
                          </button>
                        </>
                      )}
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

      <footer className="placement-manager-foot">
        <button type="button" className="outline" onClick={onClose}>
          بستن
        </button>
      </footer>
    </div>
  );
}
