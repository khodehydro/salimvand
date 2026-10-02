import { FormEvent, useEffect, useState } from 'react';
import { formatPersianNumber } from '@salimvand/shared';
import { FaNumberInput } from '../components/FaNumberInput';
import { api } from '../lib/api';

type Category = {
  id: string;
  name: string;
  code: string;
  slug: string;
  parentId?: string | null;
  sort: number;
  isActive: boolean;
  _count?: { products: number };
};
type Brand = { id: string; name: string; isActive: boolean; _count?: { inventoryItems: number } };
type Trim = { id: string; name: string };
type Model = {
  id: string;
  name: string;
  productionFrom?: number | null;
  productionTo?: number | null;
  trims: Trim[];
};
type VehicleMake = { id: string; name: string; models: Model[] };
type Tab = 'categories' | 'brands' | 'vehicles';
type CreateKind = 'make' | 'model' | 'trim';

/** Chevron used on every accordion row; flips direction with CSS in RTL. */
function ChevronIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="vh-chevron"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M9 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7.5 18.5 3 20l1.5-4.5L16.5 3.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ReferencesPage() {
  const [tab, setTab] = useState<Tab>('categories');
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [vehicles, setVehicles] = useState<VehicleMake[]>([]);
  const [category, setCategory] = useState({
    name: '',
    code: '',
    slug: '',
    parentId: '',
    sort: '0',
  });
  const [brand, setBrand] = useState('');
  const [selectedMake, setSelectedMake] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [createKind, setCreateKind] = useState<CreateKind>('make');
  const [createName, setCreateName] = useState('');
  const [openMakes, setOpenMakes] = useState<string[]>([]);
  const [openModels, setOpenModels] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [inline, setInline] = useState<{
    kind: 'model' | 'trim';
    parentId: string;
    value: string;
  } | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api<{
        data: { categories: Category[]; brands: Brand[]; vehicles: VehicleMake[] };
      }>('/references');
      setCategories(result.data.categories);
      setBrands(result.data.brands);
      setVehicles(result.data.vehicles);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const submit = async (
    event: FormEvent,
    path: string,
    body: Record<string, unknown>,
    reset: () => void,
  ) => {
    event.preventDefault();
    if (!path) return;
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      setMessage('اطلاعات با موفقیت ثبت شد.');
      reset();
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const toggle = async (kind: 'categories' | 'brands', id: string, active: boolean) => {
    try {
      await api(`/${kind}/${id}${active ? '/restore' : ''}`, {
        method: active ? 'POST' : 'DELETE',
      });
      setMessage(active ? 'مورد بازیابی شد.' : 'مورد غیرفعال شد.');
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const rename = async (path: string, current: string) => {
    const name = window.prompt('نام جدید را وارد کنید:', current)?.trim();
    if (!name || name === current) return;
    try {
      await api(path, { method: 'PATCH', body: JSON.stringify({ name }) });
      setMessage('نام ویرایش شد.');
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  // ── Vehicles tab: unified creation card + accordion tree ──
  const currentMake = vehicles.find((item) => item.id === selectedMake);
  const currentModel = currentMake?.models.find((item) => item.id === selectedModel);
  const vehicleTotals = vehicles.reduce(
    (acc, mk) => {
      acc.models += mk.models.length;
      acc.trims += mk.models.reduce((sum, md) => sum + md.trims.length, 0);
      return acc;
    },
    { models: 0, trims: 0 },
  );
  const normalizedQuery = query.trim().toLowerCase();
  const searching = normalizedQuery.length > 0;
  const filteredMakes = searching
    ? vehicles
        .map((mk) => {
          const makeMatch = mk.name.toLowerCase().includes(normalizedQuery);
          const models = makeMatch
            ? mk.models
            : mk.models.filter(
                (md) =>
                  md.name.toLowerCase().includes(normalizedQuery) ||
                  md.trims.some((tr) => tr.name.toLowerCase().includes(normalizedQuery)),
              );
          return { ...mk, models };
        })
        .filter(
          (mk) => mk.name.toLowerCase().includes(normalizedQuery) || mk.models.length > 0,
        )
    : vehicles;
  const isMakeOpen = (id: string) => searching || openMakes.includes(id);
  const isModelOpen = (id: string) => searching || openModels.includes(id);
  const toggleMakeOpen = (id: string) =>
    setOpenMakes((cur) =>
      cur.includes(id) ? cur.filter((item) => item !== id) : [...cur, id],
    );
  const toggleModelOpen = (id: string) =>
    setOpenModels((cur) =>
      cur.includes(id) ? cur.filter((item) => item !== id) : [...cur, id],
    );

  const submitVehicleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const name = createName.trim();
    if (!name) return;
    try {
      if (createKind === 'make') {
        await api('/vehicles/makes', { method: 'POST', body: JSON.stringify({ name }) });
      } else if (createKind === 'model' && selectedMake) {
        await api(`/vehicles/makes/${selectedMake}/models`, {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
        setOpenMakes((cur) => (cur.includes(selectedMake) ? cur : [...cur, selectedMake]));
      } else if (createKind === 'trim' && selectedModel) {
        await api(`/vehicles/models/${selectedModel}/trims`, {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
        if (selectedMake)
          setOpenMakes((cur) => (cur.includes(selectedMake) ? cur : [...cur, selectedMake]));
        setOpenModels((cur) => (cur.includes(selectedModel) ? cur : [...cur, selectedModel]));
      } else {
        return;
      }
      setMessage('اطلاعات با موفقیت ثبت شد.');
      setCreateName('');
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const submitInline = async () => {
    if (!inline) return;
    const name = inline.value.trim();
    if (!name) return;
    try {
      if (inline.kind === 'model') {
        await api(`/vehicles/makes/${inline.parentId}/models`, {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
      } else {
        await api(`/vehicles/models/${inline.parentId}/trims`, {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
      }
      setInline(null);
      setMessage('اطلاعات با موفقیت ثبت شد.');
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const createKindLabels: Record<CreateKind, string> = {
    make: 'برند خودرو',
    model: 'خودرو (مدل)',
    trim: 'تیپ خودرو',
  };
  const createHints: Record<CreateKind, string> = {
    make: 'برند سازنده (مثل ایران‌خودرو، سایپا، کیا) در ریشهٔ کاتالوگ ثبت می‌شود.',
    model: 'خودروی جدید زیر برند انتخاب‌شده ثبت می‌شود (مثل پژو ۲۰۶).',
    trim: 'تیپ زیر خودروی انتخاب‌شده ثبت می‌شود (مثل تیپ ۵، اتوماتیک).',
  };

  return (
    <section className="references-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">کاتالوگ</span>
          <h1>داده‌های پایه</h1>
          <p className="muted">
            دسته‌بندی، برند قطعه و درخت خودروها از همین‌جا به محصولات و سایت متصل می‌شوند.
          </p>
        </div>
        <span className="count">{formatPersianNumber(categories.length + brands.length)} مرجع</span>
      </div>
      {message && <div className="notice">{message}</div>}
      <div className="tabs reference-tabs seg-tabs">
        <button
          className={tab === 'categories' ? 'active' : ''}
          onClick={() => setTab('categories')}
        >
          دسته‌بندی‌ها
        </button>
        <button className={tab === 'brands' ? 'active' : ''} onClick={() => setTab('brands')}>
          برندهای قطعه
        </button>
        <button className={tab === 'vehicles' ? 'active' : ''} onClick={() => setTab('vehicles')}>
          خودروها
        </button>
      </div>
      {loading ? (
        <div className="skeleton-block" />
      ) : tab === 'categories' ? (
        <div className="reference-workspace">
          <form
            className="reference-card reference-form"
            onSubmit={(event) =>
              void submit(event, '/categories', { ...category, sort: Number(category.sort) }, () =>
                setCategory({ name: '', code: '', slug: '', parentId: '', sort: '0' }),
              )
            }
          >
            <h2>دستهٔ جدید</h2>
            <label>
              نام
              <input
                required
                value={category.name}
                onChange={(event) => setCategory({ ...category, name: event.target.value })}
                placeholder="مثلاً سیستم ترمز"
              />
            </label>
            <label>
              کد لاتین
              <input
                required
                dir="ltr"
                maxLength={10}
                value={category.code}
                onChange={(event) =>
                  setCategory({ ...category, code: event.target.value.toUpperCase() })
                }
                placeholder="BRK"
              />
            </label>
            <label>
              نشانی انگلیسی (اختیاری)
              <input
                dir="ltr"
                value={category.slug}
                onChange={(event) => setCategory({ ...category, slug: event.target.value })}
                placeholder="brakes"
              />
            </label>
            <label>
              دستهٔ والد
              <select
                value={category.parentId}
                onChange={(event) => setCategory({ ...category, parentId: event.target.value })}
              >
                <option value="">بدون والد</option>
                {categories
                  .filter((item) => item.isActive)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              ترتیب
              <FaNumberInput
                group={false}
                value={category.sort}
                onChange={(plain) => setCategory({ ...category, sort: plain })}
              />
            </label>
            <button>ثبت دسته‌بندی</button>
          </form>
          <div className="reference-list">
            <div className="reference-list-head">
              <h2>ساختار دسته‌ها</h2>
              <span>
                {formatPersianNumber(categories.filter((item) => item.isActive).length)} فعال
              </span>
            </div>
            {categories.map((item) => (
              <article className={item.isActive ? '' : 'reference-inactive'} key={item.id}>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    <code>{item.code}</code> · {formatPersianNumber(item._count?.products ?? 0)}{' '}
                    محصول
                  </small>
                </span>
                <span className="row-actions">
                  <button onClick={() => void rename(`/categories/${item.id}`, item.name)}>
                    ویرایش
                  </button>
                  <button
                    className={item.isActive ? 'danger-text' : ''}
                    onClick={() => void toggle('categories', item.id, !item.isActive)}
                  >
                    {item.isActive ? 'غیرفعال' : 'بازیابی'}
                  </button>
                </span>
              </article>
            ))}
          </div>
        </div>
      ) : tab === 'brands' ? (
        <div className="reference-workspace">
          <form
            className="reference-card reference-form"
            onSubmit={(event) => void submit(event, '/brands', { name: brand }, () => setBrand(''))}
          >
            <h2>برند قطعهٔ جدید</h2>
            <label>
              نام برند
              <input
                required
                value={brand}
                onChange={(event) => setBrand(event.target.value)}
                placeholder="مثلاً ایساکو"
              />
            </label>
            <button>ثبت برند</button>
          </form>
          <div className="reference-list">
            <div className="reference-list-head">
              <h2>برندهای ثبت‌شده</h2>
              <span>{formatPersianNumber(brands.length)} مورد</span>
            </div>
            {brands.map((item) => (
              <article className={item.isActive ? '' : 'reference-inactive'} key={item.id}>
                <span>
                  <strong>{item.name}</strong>
                  <small>{formatPersianNumber(item._count?.inventoryItems ?? 0)} قلم انبار</small>
                </span>
                <span className="row-actions">
                  <button onClick={() => void rename(`/brands/${item.id}`, item.name)}>
                    ویرایش
                  </button>
                  <button
                    className={item.isActive ? 'danger-text' : ''}
                    onClick={() => void toggle('brands', item.id, !item.isActive)}
                  >
                    {item.isActive ? 'غیرفعال' : 'بازیابی'}
                  </button>
                </span>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <div className="reference-workspace vehicle-tab">
          <form className="reference-card vh-card" onSubmit={(e) => void submitVehicleCreate(e)}>
            <h2>افزودن به کاتالوگ خودرو</h2>
            <div className="vh-kind" role="tablist" aria-label="نوع ورودی جدید">
              {(['make', 'model', 'trim'] as const).map((kind) => (
                <button
                  type="button"
                  key={kind}
                  role="tab"
                  aria-selected={createKind === kind}
                  className={createKind === kind ? 'active' : ''}
                  onClick={() => {
                    setCreateKind(kind);
                    setCreateName('');
                    if (kind === 'make') {
                      setSelectedMake('');
                      setSelectedModel('');
                    } else if (kind === 'model') {
                      setSelectedModel('');
                    }
                  }}
                >
                  {createKindLabels[kind]}
                </button>
              ))}
            </div>

            {createKind !== 'make' && (
              <label>
                برند خودرو
                <select
                  required
                  value={selectedMake}
                  onChange={(event) => {
                    setSelectedMake(event.target.value);
                    setSelectedModel('');
                  }}
                >
                  <option value="">انتخاب برند…</option>
                  {vehicles.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {createKind === 'trim' && (
              <label>
                مدل خودرو
                <select
                  required
                  value={selectedModel}
                  disabled={!selectedMake}
                  onChange={(event) => setSelectedModel(event.target.value)}
                >
                  <option value="">
                    {selectedMake ? 'انتخاب مدل…' : 'ابتدا برند را انتخاب کنید'}
                  </option>
                  {currentMake?.models.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {createKind === 'make' ? 'نام برند' : createKind === 'model' ? 'نام خودرو' : 'نام تیپ'}
              <input
                required
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder={
                  createKind === 'make'
                    ? 'مثلاً ایران خودرو'
                    : createKind === 'model'
                      ? 'مثلاً پژو ۲۰۶'
                      : 'مثلاً تیپ ۵'
                }
              />
            </label>
            <button
              type="submit"
              className="vh-submit"
              disabled={
                (createKind === 'model' && !selectedMake) ||
                (createKind === 'trim' && !selectedModel)
              }
            >
              {createKind === 'make'
                ? 'ثبت برند خودرو'
                : createKind === 'model'
                  ? 'ثبت خودرو'
                  : 'ثبت تیپ'}
            </button>
            <small className="vh-hint">{createHints[createKind]}</small>
          </form>

          <div className="vh-panel">
            <div className="vh-toolbar">
              <div className="vh-search">
                <SearchIcon />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="جستجوی برند، خودرو یا تیپ…"
                  aria-label="جستجو در کاتالوگ خودروها"
                />
              </div>
              <div className="vh-counts">
                <span>
                  <b>{formatPersianNumber(vehicles.length)}</b> برند
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <b>{formatPersianNumber(vehicleTotals.models)}</b> خودرو
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <b>{formatPersianNumber(vehicleTotals.trims)}</b> تیپ
                </span>
              </div>
            </div>

            <div className="vh-acc">
              {filteredMakes.map((make) => {
                const makeOpen = isMakeOpen(make.id);
                return (
                  <article className={`vh-item${makeOpen ? ' open' : ''}`} key={make.id}>
                    <div className="vh-head-row">
                      <button
                        type="button"
                        className="vh-head"
                        aria-expanded={makeOpen}
                        onClick={() => toggleMakeOpen(make.id)}
                      >
                        <ChevronIcon />
                        <strong>{make.name}</strong>
                        <span className="vh-badge">
                          {formatPersianNumber(make.models.length)} خودرو
                        </span>
                      </button>
                      <button
                        type="button"
                        className="vh-iconbtn"
                        title={`تغییر نام ${make.name}`}
                        aria-label={`تغییر نام برند ${make.name}`}
                        onClick={() => void rename(`/vehicles/makes/${make.id}`, make.name)}
                      >
                        <PencilIcon />
                      </button>
                    </div>
                    {makeOpen && (
                      <div className="vh-body">
                        {make.models.map((model) => {
                          const modelOpen = isModelOpen(model.id);
                          const inlineTrimActive =
                            inline?.kind === 'trim' && inline.parentId === model.id;
                          return (
                            <div className="vh-model" key={model.id}>
                              <div className="vh-head-row">
                                <button
                                  type="button"
                                  className="vh-model-head"
                                  aria-expanded={modelOpen}
                                  onClick={() => toggleModelOpen(model.id)}
                                >
                                  <ChevronIcon size={12} />
                                  <span>{model.name}</span>
                                  <span className="vh-model-badge">
                                    {model.trims.length
                                      ? `${formatPersianNumber(model.trims.length)} تیپ`
                                      : 'بدون تیپ'}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className="vh-iconbtn"
                                  title={`تغییر نام ${model.name}`}
                                  aria-label={`تغییر نام خودرو ${model.name}`}
                                  onClick={() =>
                                    void rename(`/vehicles/models/${model.id}`, model.name)
                                  }
                                >
                                  <PencilIcon />
                                </button>
                              </div>
                              {modelOpen && (
                                <>
                                  <div className="vh-trims">
                                    {model.trims.map((vehicleTrim) => (
                                      <button
                                        type="button"
                                        className="vh-trim"
                                        key={vehicleTrim.id}
                                        title="تغییر نام تیپ"
                                        onClick={() =>
                                          void rename(
                                            `/vehicles/trims/${vehicleTrim.id}`,
                                            vehicleTrim.name,
                                          )
                                        }
                                      >
                                        {vehicleTrim.name}
                                      </button>
                                    ))}
                                    {!model.trims.length && (
                                      <small className="vh-empty-small">
                                        هنوز تیپی برای این خودرو ثبت نشده است.
                                      </small>
                                    )}
                                    {inlineTrimActive ? (
                                      <span className="vh-inline vh-inline-trim">
                                        <input
                                          autoFocus
                                          value={inline.value}
                                          onChange={(event) =>
                                            setInline({
                                              ...inline,
                                              value: event.target.value,
                                            })
                                          }
                                          onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                              event.preventDefault();
                                              void submitInline();
                                            } else if (event.key === 'Escape') {
                                              setInline(null);
                                            }
                                          }}
                                          placeholder="نام تیپ…"
                                          aria-label="نام تیپ جدید"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => void submitInline()}
                                        >
                                          ثبت
                                        </button>
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        className="vh-add-trim"
                                        onClick={() =>
                                          setInline({
                                            kind: 'trim',
                                            parentId: model.id,
                                            value: '',
                                          })
                                        }
                                      >
                                        + افزودن تیپ
                                      </button>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                        {!make.models.length && (
                          <p className="vh-empty-small">
                            هنوز خودرویی برای این برند ثبت نشده است.
                          </p>
                        )}
                        {inline?.kind === 'model' && inline.parentId === make.id ? (
                          <span className="vh-inline">
                            <input
                              autoFocus
                              value={inline.value}
                              onChange={(event) =>
                                setInline({ ...inline, value: event.target.value })
                              }
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void submitInline();
                                } else if (event.key === 'Escape') {
                                  setInline(null);
                                }
                              }}
                              placeholder="نام خودرو…"
                              aria-label="نام خودروی جدید"
                            />
                            <button type="button" onClick={() => void submitInline()}>
                              ثبت خودرو
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="vh-add-model"
                            onClick={() =>
                              setInline({ kind: 'model', parentId: make.id, value: '' })
                            }
                          >
                            + افزودن خودرو به این برند
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
              {!filteredMakes.length && (
                <div className="vh-empty">
                  {searching
                    ? 'نتیجه‌ای برای این جستجو یافت نشد.'
                    : 'هنوز برند خودرویی ثبت نشده است؛ از فرم روبه‌رو (بالا در موبایل) اولین برند را اضافه کنید.'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
