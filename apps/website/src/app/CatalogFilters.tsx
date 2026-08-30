'use client';

import { useRef } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';

type Filter = { id: string; name: string; slug?: string };
type Vehicle = {
  id: string;
  name: string;
  models: Array<{ id: string; name: string; trims?: Array<{ id: string; name: string }> }>;
};

/**
 * Catalog filter form with auto-apply: choosing a select option or ticking
 * «فقط موجود» navigates immediately — no «اعمال فیلتر» button. The free-text
 * search submits on Enter. Navigation goes through the Next.js router with
 * `scroll: false` so the visitor's scroll position is preserved instead of
 * jumping to the top of the page. Picking a new make resets the model/trim
 * selects so stale ids are never sent.
 */
export function CatalogFilters({
  filters,
  params,
}: {
  filters: { categories: Filter[]; vehicles: Vehicle[] };
  params: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const modelRef = useRef<HTMLSelectElement>(null);
  const trimRef = useRef<HTMLSelectElement>(null);

  const makeId = params.vehicleMakeId ?? '';
  const modelId = params.vehicleModelId ?? '';
  const scopedMakes = makeId
    ? filters.vehicles.filter((make) => make.id === makeId)
    : filters.vehicles;
  const selectedModel = scopedMakes.flatMap((make) => make.models).find((m) => m.id === modelId);
  const scopedTrims: Array<{ id: string; label: string }> = selectedModel
    ? (selectedModel.trims ?? []).map((trim) => ({ id: trim.id, label: trim.name }))
    : scopedMakes.flatMap((make) =>
        make.models.flatMap((model) =>
          (model.trims ?? []).map((trim) => ({
            id: trim.id,
            label: `${make.name} · ${model.name} · ${trim.name}`,
          })),
        ),
      );

  const apply = () => {
    const form = formRef.current;
    if (!form) return;
    const query = new URLSearchParams();
    for (const [key, value] of new FormData(form).entries()) {
      const text = String(value).trim();
      if (text) query.set(key, text);
    }
    router.push(query.toString() ? `/?${query.toString()}` : '/', { scroll: false });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    apply();
  };

  return (
    <form ref={formRef} className="catalog-filters" onSubmit={onSubmit}>
      <label className="search-field">
        <span>⌕</span>
        <input name="q" defaultValue={params.q} placeholder="نام قطعه یا شماره فنی..." />
      </label>
      <select
        name="vehicleMakeId"
        defaultValue={makeId}
        onChange={(event) => {
          if (modelRef.current) modelRef.current.value = '';
          if (trimRef.current) trimRef.current.value = '';
          apply();
        }}
      >
        <option value="">برند خودرو</option>
        {filters.vehicles.map((make) => (
          <option key={make.id} value={make.id}>
            {make.name}
          </option>
        ))}
      </select>
      <select ref={modelRef} name="vehicleModelId" defaultValue={modelId} onChange={apply}>
        <option value="">مدل خودرو</option>
        {scopedMakes.flatMap((make) =>
          make.models.map((model) => (
            <option key={model.id} value={model.id}>
              {make.name} · {model.name}
            </option>
          )),
        )}
      </select>
      <select
        ref={trimRef}
        name="vehicleTrimId"
        defaultValue={params.vehicleTrimId ?? ''}
        onChange={apply}
      >
        <option value="">تیپ / موتور</option>
        {scopedTrims.map((trim) => (
          <option key={trim.id} value={trim.id}>
            {trim.label}
          </option>
        ))}
      </select>
      <select name="categoryId" defaultValue={params.categoryId ?? ''} onChange={apply}>
        <option value="">دسته‌بندی</option>
        {filters.categories.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <label className="check-field">
        <input
          type="checkbox"
          name="inStock"
          value="true"
          defaultChecked={params.inStock === 'true'}
          onChange={apply}
        />{' '}
        فقط موجود
      </label>
      {(() => {
        const active = [
          params.q,
          params.brandId,
          params.vehicleMakeId,
          params.vehicleModelId,
          params.vehicleTrimId,
          params.categoryId,
          params.inStock,
        ].some(Boolean);
        if (!active) return null;
        return (
          <button
            type="button"
            className="clear-filter"
            onClick={() => router.push('/', { scroll: false })}
          >
            <span aria-hidden="true">✕</span> پاک کردن فیلترها
          </button>
        );
      })()}
    </form>
  );
}
