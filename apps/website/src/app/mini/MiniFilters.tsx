'use client';
import { useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatPersianNumber } from '@salimvand/shared';
import { CATALOG_LEAVE_EVENT } from '../catalog-return';
import { MiniIcon } from './MiniIcon';
import type { MiniFiltersData } from './mini-data';

export function MiniFilters({
  filters,
  params,
  base,
}: {
  filters: MiniFiltersData;
  params: Record<string, string | undefined>;
  base: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = ['categoryId', 'brandId', 'vehicleModelId', 'inStock'].filter(
    (key) => params[key],
  ).length;
  const apply = (clear = false) => {
    const query = new URLSearchParams();
    if (!clear && form.current)
      for (const [key, value] of new FormData(form.current)) {
        const text = String(value).trim();
        if (text) query.set(key, text);
      }
    window.dispatchEvent(new Event(CATALOG_LEAVE_EVENT));
    startTransition(() => router.push(base + (query.size ? `?${query}` : ''), { scroll: false }));
  };
  return (
    <form
      ref={form}
      className="mini-filters"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <input type="hidden" name="q" value={params.q || ''} />
      <details className="mini-filter-details" open={active > 0 || undefined}>
        <summary>
          <MiniIcon name="filter" />
          فیلتر محصولات{active > 0 && <b>{formatPersianNumber(active)}</b>}
          <span aria-hidden="true">⌄</span>
        </summary>
        <div className="mini-filter-options">
          <label>
            دسته‌بندی
            <select
              name="categoryId"
              defaultValue={params.categoryId || ''}
              onChange={() => apply()}
            >
              <option value="">همهٔ دسته‌ها</option>
              {filters.categories.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            خودرو
            <select
              name="vehicleModelId"
              defaultValue={params.vehicleModelId || ''}
              onChange={() => apply()}
            >
              <option value="">همهٔ خودروها</option>
              {filters.vehicles.flatMap((make) =>
                make.models.map((model) => (
                  <option value={model.id} key={model.id}>
                    {make.name} · {model.name}
                  </option>
                )),
              )}
            </select>
          </label>
          <label>
            برند قطعه
            <select name="brandId" defaultValue={params.brandId || ''} onChange={() => apply()}>
              <option value="">همهٔ برندها</option>
              {filters.brands.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mini-stock-filter">
            <input
              type="checkbox"
              name="inStock"
              value="true"
              defaultChecked={params.inStock === 'true'}
              onChange={() => apply()}
            />
            فقط کالاهای موجود
          </label>
        </div>
      </details>
      {(active > 0 || params.q) && (
        <button type="button" className="mini-clear" disabled={pending} onClick={() => apply(true)}>
          پاک کردن فیلترها ×
        </button>
      )}
    </form>
  );
}
