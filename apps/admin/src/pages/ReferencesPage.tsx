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
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [trim, setTrim] = useState('');
  const [selectedMake, setSelectedMake] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
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
  const currentMake = vehicles.find((item) => item.id === selectedMake);

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
        <div className="vehicle-workspace">
          <div className="reference-grid">
            <form
              className="reference-card"
              onSubmit={(event) =>
                void submit(event, '/vehicles/makes', { name: make }, () => setMake(''))
              }
            >
              <h2>برند خودرو</h2>
              <input
                required
                value={make}
                onChange={(event) => setMake(event.target.value)}
                placeholder="ایران خودرو"
              />
              <button>ثبت برند خودرو</button>
            </form>
            <form
              className="reference-card"
              onSubmit={(event) =>
                void submit(
                  event,
                  selectedMake ? `/vehicles/makes/${selectedMake}/models` : '',
                  { name: model },
                  () => setModel(''),
                )
              }
            >
              <h2>مدل خودرو</h2>
              <select
                required
                value={selectedMake}
                onChange={(event) => {
                  setSelectedMake(event.target.value);
                  setSelectedModel('');
                }}
              >
                <option value="">انتخاب برند</option>
                {vehicles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <input
                required
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="پژو ۲۰۶"
              />
              <button disabled={!selectedMake}>ثبت مدل</button>
            </form>
            <form
              className="reference-card"
              onSubmit={(event) =>
                void submit(
                  event,
                  selectedModel ? `/vehicles/models/${selectedModel}/trims` : '',
                  { name: trim },
                  () => setTrim(''),
                )
              }
            >
              <h2>تیپ خودرو</h2>
              <select
                required
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
              >
                <option value="">انتخاب مدل</option>
                {currentMake?.models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <input
                required
                value={trim}
                onChange={(event) => setTrim(event.target.value)}
                placeholder="تیپ ۵"
              />
              <button disabled={!selectedModel}>ثبت تیپ</button>
            </form>
          </div>
          <div className="vehicle-tree">
            {vehicles.map((vehicleMake) => (
              <article key={vehicleMake.id}>
                <header>
                  <strong>{vehicleMake.name}</strong>
                  <button
                    onClick={() =>
                      void rename(`/vehicles/makes/${vehicleMake.id}`, vehicleMake.name)
                    }
                  >
                    ویرایش
                  </button>
                </header>
                {vehicleMake.models.map((vehicleModel) => (
                  <div className="vehicle-model" key={vehicleModel.id}>
                    <span>
                      <b>{vehicleModel.name}</b>
                      <button
                        onClick={() =>
                          void rename(`/vehicles/models/${vehicleModel.id}`, vehicleModel.name)
                        }
                      >
                        ویرایش
                      </button>
                    </span>
                    <div>
                      {vehicleModel.trims.map((vehicleTrim) => (
                        <button
                          className="vehicle-trim"
                          key={vehicleTrim.id}
                          onClick={() =>
                            void rename(`/vehicles/trims/${vehicleTrim.id}`, vehicleTrim.name)
                          }
                        >
                          {vehicleTrim.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
