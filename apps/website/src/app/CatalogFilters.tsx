'use client';

import { useRef } from 'react';

type Filter = { id: string; name: string; slug?: string };
type Vehicle = {
  id: string;
  name: string;
  models: Array<{ id: string; name: string; trims?: Array<{ id: string; name: string }> }>;
};

/**
 * Catalog filter form with auto-apply: choosing a select option or ticking
 * «فقط موجود» submits the form immediately (a plain GET navigation), so no
 * «اعمال فیلتر» button is needed. The free-text search still submits on Enter.
 * Picking a new make resets the model/trim selects so stale ids are never sent.
 */
export function CatalogFilters({
  filters,
  params,
}: {
  filters: { categories: Filter[]; brands: Filter[]; vehicles: Vehicle[] };
  params: Record<string, string | undefined>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const modelRef = useRef<HTMLSelectElement>(null);
  const trimRef = useRef<HTMLSelectElement>(null);

  const makeId = params.vehicleMakeId ?? '';
  const modelId = params.vehicleModelId ?? '';
  const scopedMakes = makeId
    ? filters.vehicles.filter((make) => make.id === makeId)
    : filters.vehicles;
  const scopedModels = scopedMakes.flatMap((make) => make.models);
  const selectedModel = scopedModels.find((model) => model.id === modelId);
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

  const submit = () => formRef.current?.requestSubmit();

  return (
    <form
      ref={formRef}
      className="catalog-filters"
      method="get"
      onChange={(event) => {
        const target = event.target as HTMLElement;
        const isSelect = target instanceof HTMLSelectElement;
        const isCheckbox = target instanceof HTMLInputElement && target.type === 'checkbox';
        if (!isSelect && !isCheckbox) return; // the text search submits on Enter
        // Changing the make invalidates the chosen model/trim.
        if (isSelect && (target as HTMLSelectElement).name === 'vehicleMakeId') {
          if (modelRef.current) modelRef.current.value = '';
          if (trimRef.current) trimRef.current.value = '';
        }
        if (isSelect && (target as HTMLSelectElement).name === 'vehicleModelId') {
          if (trimRef.current) trimRef.current.value = '';
        }
        submit();
      }}
    >
      <label className="search-field">
        <span>⌕</span>
        <input name="q" defaultValue={params.q} placeholder="نام قطعه یا شماره فنی..." />
      </label>
      <select name="brandId" defaultValue={params.brandId ?? ''}>
        <option value="">برند قطعه</option>
        {filters.brands.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <select name="vehicleMakeId" defaultValue={makeId}>
        <option value="">برند خودرو</option>
        {filters.vehicles.map((make) => (
          <option key={make.id} value={make.id}>
            {make.name}
          </option>
        ))}
      </select>
      <select ref={modelRef} name="vehicleModelId" defaultValue={modelId}>
        <option value="">مدل خودرو</option>
        {scopedMakes.flatMap((make) =>
          make.models.map((model) => (
            <option key={model.id} value={model.id}>
              {make.name} · {model.name}
            </option>
          )),
        )}
      </select>
      <select ref={trimRef} name="vehicleTrimId" defaultValue={params.vehicleTrimId ?? ''}>
        <option value="">تیپ / موتور</option>
        {scopedTrims.map((trim) => (
          <option key={trim.id} value={trim.id}>
            {trim.label}
          </option>
        ))}
      </select>
      <select name="categoryId" defaultValue={params.categoryId ?? ''}>
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
          <a className="clear-filter" href="#catalog">
            پاک کردن فیلترها
          </a>
        );
      })()}
    </form>
  );
}
