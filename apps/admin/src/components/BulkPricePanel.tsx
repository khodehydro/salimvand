import { useState } from 'react';
import { api } from '../lib/api';
import type { Brand, Category } from '../lib/catalog-types';

/**
 * «مدیریت گروهی قیمت» — one toolbar band of the unified list: raise/lower
 * the sale and purchase price of a whole brand or category by a percentage
 * (with optional rounding) in a single atomic call.
 */
export function BulkPricePanel({
  brands,
  categories,
  onDone,
  onMessage,
}: {
  brands: Brand[];
  categories: Category[];
  onDone: () => void | Promise<void>;
  onMessage: (text: string) => void;
}) {
  const [brandId, setBrandId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [salePercent, setSalePercent] = useState('');
  const [purchasePercent, setPurchasePercent] = useState('');
  const [roundTo, setRoundTo] = useState('1000');
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    if (!brandId && !categoryId) {
      onMessage('برای تغییر گروهی، برند یا دسته را انتخاب کنید.');
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ data: { updated: number } }>('/inventory/bulk-prices', {
        method: 'POST',
        body: JSON.stringify({
          brandId: brandId || undefined,
          categoryId: categoryId || undefined,
          salePercent: Number(salePercent || 0),
          purchasePercent: Number(purchasePercent || 0),
          roundTo: Number(roundTo || 0),
        }),
      });
      onMessage(`${result.data.updated.toLocaleString('fa-IR')} قلم بروزرسانی شد.`);
      setSalePercent('');
      setPurchasePercent('');
      await onDone();
    } catch (error) {
      onMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bulk-price-toolbar">
      <b className="bulk-price-title">مدیریت گروهی قیمت</b>
      <div className="toolbar-filter-row">
        <label
          className={`toolbar-pill${brandId ? ' is-active' : ''}`}
          aria-label="برند تغییر گروهی"
        >
          <span className="tp-lead" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="8" r="6" />
              <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
            </svg>
          </span>
          <select
            value={brandId}
            onChange={(event) => setBrandId(event.target.value)}
            aria-label="برند تغییر گروهی"
          >
            <option value="">همه برندها</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </label>
        <label
          className={`toolbar-pill${categoryId ? ' is-active' : ''}`}
          aria-label="دستهٔ تغییر گروهی"
        >
          <span className="tp-lead" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
            </svg>
          </span>
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            aria-label="دستهٔ تغییر گروهی"
          >
            <option value="">همه دسته‌ها</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <div
          className={`toolbar-pill${salePercent || purchasePercent ? ' is-active' : ''}`}
          aria-label="درصد تغییر و گرد کردن"
        >
          <span className="tp-lead" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 5 5 19" />
              <circle cx="6.5" cy="6.5" r="2.5" />
              <circle cx="17.5" cy="17.5" r="2.5" />
            </svg>
          </span>
          <input
            dir="ltr"
            inputMode="decimal"
            placeholder="٪ فروش"
            aria-label="درصد تغییر قیمت فروش"
            value={salePercent}
            onChange={(event) => setSalePercent(event.target.value)}
          />
          <span className="drf-sep" aria-hidden="true" />
          <input
            dir="ltr"
            inputMode="decimal"
            placeholder="٪ خرید"
            aria-label="درصد تغییر قیمت خرید"
            value={purchasePercent}
            onChange={(event) => setPurchasePercent(event.target.value)}
          />
          <span className="drf-sep" aria-hidden="true" />
          <input
            dir="ltr"
            inputMode="numeric"
            placeholder="گرد کردن"
            aria-label="گرد کردن به"
            value={roundTo}
            onChange={(event) => setRoundTo(event.target.value)}
          />
        </div>
        <button className="bulk-apply" disabled={busy} onClick={() => void apply()}>
          {busy ? 'در حال بروزرسانی…' : 'اعمال تغییر قیمت'}
        </button>
      </div>
    </div>
  );
}
