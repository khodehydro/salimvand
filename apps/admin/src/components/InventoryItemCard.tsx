import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@salimvand/ui';
import { formatJalaliDate, formatPersianNumber, formatRial } from '@salimvand/shared';
import { api } from '../lib/api';
import type { InventoryLine, Location, Supplier } from '../lib/catalog-types';
import { lineTone, priceOf, stockToneLabel } from '../lib/catalog-list';
import { basketLabel, locationLabel, placementLabel } from '../lib/location-label';
import { BarcodeSvg } from './BarcodeSvg';
import { FaNumberInput } from './FaNumberInput';
import { SupplierBadge } from './SupplierBadge';

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

const transactionLabels: Record<string, string> = {
  initial: 'موجودی اولیه',
  purchase: 'خرید',
  adjust: 'اصلاح',
  transfer: 'انتقال',
  sale: 'فروش',
  return: 'مرجوعی',
};

/** A stock line plus its product context (the list row already carries it). */
export type ItemCardLine = InventoryLine & {
  product?: {
    id: string;
    name: string;
    code?: string | null;
    images?: Array<{ path: string }>;
  } | null;
};

/**
 * «کارت قلم» — the floating detail sheet of ONE stock line: placement,
 * prices, barcode, quick receive, shelf/basket transfer, supplier and the
 * full ledger + Shamsi price history. Opened from any row of the unified
 * list; every write refreshes the list behind it.
 */
export function InventoryItemCard({
  item,
  locations,
  suppliers,
  onClose,
  onMessage,
  onChanged,
}: {
  item: ItemCardLine;
  locations: Location[];
  suppliers: Supplier[];
  onClose: () => void;
  onMessage: (text: string) => void;
  onChanged: () => void | Promise<void>;
}) {
  const [current, setCurrent] = useState<ItemCardLine>(item);
  const [busy, setBusy] = useState(false);
  const [transferLocation, setTransferLocation] = useState(item.location?.id ?? '');
  const [transferBasket, setTransferBasket] = useState(item.basket?.id ?? '');
  const [receiveQty, setReceiveQty] = useState('');
  const [history, setHistory] = useState<Transaction[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryRow[]>([]);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setCurrent(item);
    setTransferLocation(item.location?.id ?? '');
    setTransferBasket(item.basket?.id ?? '');
    setReceiveQty('');
    setNotice('');
  }, [item]);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      api<{ data: Transaction[] }>(`/inventory/items/${item.id}/transactions`),
      api<{ data: PriceHistoryRow[] }>(`/inventory/items/${item.id}/price-history`),
    ])
      .then(([transactions, prices]) => {
        if (!alive) return;
        setHistory(transactions.data);
        setPriceHistory(prices.data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [item.id]);

  const shelves = useMemo(
    () => locations.filter((location) => location.type !== 'basket'),
    [locations],
  );
  const basketsOf = (shelfId: string) =>
    locations.filter(
      (location) => location.type === 'basket' && (location.parentId ?? null) === (shelfId || null),
    );

  const notify = (text: string) => {
    setNotice(text);
    onMessage(text);
  };

  const patchSupplier = async (supplierId: string) => {
    try {
      await api(`/inventory/items/${current.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ supplierId: supplierId || null }),
      });
      const selected = suppliers.find((row) => row.id === supplierId);
      setCurrent({
        ...current,
        supplier: selected ? { id: selected.id, name: selected.name } : null,
      });
      notify('تأمین‌کننده به‌روزرسانی شد');
      await onChanged();
    } catch (error) {
      notify((error as Error).message);
    }
  };

  const receive = async () => {
    const quantity = Number(receiveQty);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      notify('تعداد ورود باید عدد صحیح مثبت باشد');
      return;
    }
    setBusy(true);
    try {
      await api('/inventory/receive', {
        method: 'POST',
        body: JSON.stringify({ itemId: current.id, quantity, reason: 'ورود از کارت قلم' }),
      });
      setReceiveQty('');
      notify('ورود کالا ثبت شد');
      await onChanged();
      setCurrent({ ...current, quantity: current.quantity + quantity });
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const transfer = async () => {
    if (transferBasket && !transferLocation) {
      notify('برای ثبت سبد، قفسهٔ مقصد را انتخاب کنید');
      return;
    }
    setBusy(true);
    try {
      await api('/inventory/transfer', {
        method: 'POST',
        body: JSON.stringify({
          itemId: current.id,
          locationId: transferLocation || null,
          basketId: transferBasket || null,
        }),
      });
      const shelf = locations.find((row) => row.id === transferLocation) ?? null;
      const basket = locations.find((row) => row.id === transferBasket) ?? null;
      setCurrent({
        ...current,
        location: shelf
          ? { id: shelf.id, code: shelf.code, name: shelf.name, parent: shelf.parent ?? null }
          : null,
        basket: basket ? { id: basket.id, code: basket.code, name: basket.name } : null,
      });
      notify(transferBasket ? 'انتقال قفسه و سبد ثبت شد' : 'انتقال قفسه ثبت شد');
      await onChanged();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeItem = async () => {
    if (!window.confirm(`قلم «${current.product?.name ?? ''}» از انبار حذف شود؟`)) return;
    setBusy(true);
    try {
      await api(`/inventory/items/${current.id}`, { method: 'DELETE' });
      onMessage('قلم از لیست انبار حذف شد');
      await onChanged();
      onClose();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tone = lineTone(current);
  const salePrice = priceOf(current.salePrice);
  const purchasePrice = priceOf(current.purchasePrice);
  const profit = salePrice > 0 && purchasePrice > 0 ? salePrice - purchasePrice : null;

  return (
    <Modal
      open
      size="lg"
      title={`کارت قلم — ${current.product?.name ?? ''}`}
      onClose={onClose}
      footer={
        <div className="sheet-footer-actions">
          <button disabled={busy} onClick={() => void receive()}>
            {busy ? 'در حال ثبت…' : 'ثبت ورود کالا'}
          </button>
          <button className="outline" disabled={busy} onClick={() => void transfer()}>
            انتقال به قفسهٔ انتخابی
          </button>
          <button className="outline danger-text" disabled={busy} onClick={() => void removeItem()}>
            حذف قلم از انبار
          </button>
        </div>
      }
    >
      <div className="sheet-body inventory-detail-body">
        {notice && (
          <div className="notice modal-notice" role="status">
            {notice}
            <button
              type="button"
              className="search-clear"
              aria-label="بستن پیام"
              onClick={() => setNotice('')}
            >
              ✕
            </button>
          </div>
        )}
        <div className="inventory-detail-hero">
          <span className="detail-product-thumb">
            {current.product?.images?.[0]?.path ? (
              <img src={current.product.images[0].path} alt="" />
            ) : (
              <span>قطعه</span>
            )}
          </span>
          <div>
            <small>کارت قلم انبار</small>
            <h4>{current.product?.name ?? 'قلم بدون محصول'}</h4>
            <code dir="ltr">{current.product?.code ?? current.barcode}</code>
          </div>
          <span className={`badge b-${tone === 'ok' ? 'ok' : tone === 'low' ? 'warn' : 'danger'}`}>
            {stockToneLabel[tone]}
          </span>
        </div>
        <dl className="sheet-meta">
          <div>
            <dt>برند</dt>
            <dd>{current.brand?.name ?? 'بدون برند'}</dd>
          </div>
          <div>
            <dt>تأمین‌کننده</dt>
            <dd>
              {current.supplier?.name ? <SupplierBadge name={current.supplier.name} /> : 'ثبت نشده'}
            </dd>
          </div>
          <div>
            <dt>محل نگهداری</dt>
            <dd>{current.location || current.basket ? placementLabel(current) : 'بدون قفسه'}</dd>
          </div>
          <div>
            <dt>موجودی فعلی</dt>
            <dd>{formatPersianNumber(current.quantity)}</dd>
          </div>
          <div>
            <dt>قیمت فروش</dt>
            <dd>
              {salePrice > 0 ? formatRial(salePrice) : 'ثبت نشده'}
              {current.priceUpdatedAt && (
                <small className="inv-price-date">
                  {' '}
                  از {formatJalaliDate(current.priceUpdatedAt)}
                </small>
              )}
            </dd>
          </div>
          <div>
            <dt>قیمت خرید</dt>
            <dd>{purchasePrice > 0 ? formatRial(purchasePrice) : 'ثبت نشده'}</dd>
          </div>
          <div>
            <dt>سود ناخالص</dt>
            <dd>{profit !== null ? formatRial(profit) : 'قابل محاسبه نیست'}</dd>
          </div>
          <div>
            <dt>آستانهٔ هشدار</dt>
            <dd>{current.minStock != null ? formatPersianNumber(current.minStock) : '—'}</dd>
          </div>
        </dl>
        <div className="sheet-barcode">
          <BarcodeSvg value={current.barcode ?? ''} />
          <code dir="ltr">{current.barcode}</code>
        </div>
        <div className="two-fields">
          <label>
            تأمین‌کننده
            <select
              value={current.supplier?.id ?? ''}
              onChange={(event) => void patchSupplier(event.target.value)}
            >
              <option value="">بدون تأمین‌کننده</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
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
              onChange={(event) => {
                setTransferLocation(event.target.value);
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
              onChange={(event) => setTransferBasket(event.target.value)}
            >
              <option value="">بدون سبد (روی قفسه)</option>
              {basketsOf(transferLocation).map((basket) => (
                <option key={basket.id} value={basket.id}>
                  {basketLabel(basket)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {history.length > 0 && (
          <div className="history">
            <h3>تاریخچهٔ این قلم</h3>
            {history.map((row) => (
              <div key={row.id}>
                <span>{transactionLabels[row.type] ?? row.type}</span>
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
    </Modal>
  );
}
