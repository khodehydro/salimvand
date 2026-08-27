import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createEan13 } from '@salimvand/shared';
import { api } from '../lib/api';

type ProductRow = { id: string; name: string; code: string; slug: string; status: string; deletedAt?: string | null; category?: { name: string }; inventoryItems?: Array<{ quantity: number; brand: { name: string } }> };
type ProductDetail = {
  id: string; name: string; code: string; slug: string; status: string; description?: string | null; partNumber?: string | null;
  aparatVideoId?: string | null; seoTitle?: string | null; seoDescription?: string | null; seoKeywords?: string[];
  category?: { id: string; name: string };
  images?: Array<{ id: string; path: string; alt?: string | null; isPrimary: boolean; sort: number }>;
  compatibilities?: Array<{ id: string; model: { id: string; name: string; make: { id: string; name: string } }; trim?: { id: string; name: string } | null }>;
  inventoryItems?: Array<{ id: string; barcode: string; quantity: number; salePrice: string; purchasePrice: string; minStock?: number | null; isActive: boolean; brand: { id: string; name: string }; location?: { code: string; name: string } | null }>;
};
type Media = { id: string; path: string; alt?: string; product?: { name: string } };
type Category = { id: string; name: string };
type Brand = { id: string; name: string };
type Location = { id: string; code: string; name: string; type: string };
type VehicleMake = { id: string; name: string; models: Array<{ id: string; name: string; trims: Array<{ id: string; name: string }> }> };

const tabs = [
  { id: 'basic', label: 'پایه و سئو' },
  { id: 'images', label: 'تصاویر' },
  { id: 'aparat', label: 'ویدیوی آپارات' },
  { id: 'vehicles', label: 'سازگاری خودرو' },
  { id: 'items', label: 'اقلام برند و بارکد' },
] as const;
type Tab = typeof tabs[number]['id'];

const empty = { name: '', categoryId: '', description: '', partNumber: '', status: 'active' };
const aparatEmbed = (videoId: string) => `https://www.aparat.com/video/video/embed/videohash/${videoId}/vt/frame`;

export function ProductsPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [vehicles, setVehicles] = useState<VehicleMake[]>([]);
  const [form, setForm] = useState(empty);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ProductDetail | null>(null);
  const [tab, setTab] = useState<Tab>('basic');

  const load = () => api<{ data: ProductRow[] }>('/products').then((result) => setProducts(result.data)).catch((error: Error) => setMessage(error.message));
  const refresh = async (id: string) => {
    const fresh = await api<{ data: ProductDetail }>(`/products/${id}`);
    setDraft(fresh.data);
    await load();
    return fresh.data;
  };

  useEffect(() => {
    void load();
    void api<{ data: Media[] }>('/media').then((result) => setMedia(result.data)).catch(() => undefined);
    void api<{ data: Category[] }>('/categories').then((result) => setCategories(result.data)).catch(() => undefined);
    void api<{ data: Brand[] }>('/brands').then((result) => setBrands(result.data)).catch(() => undefined);
    void api<{ data: Location[] }>('/locations').then((result) => setLocations(result.data)).catch(() => undefined);
    void api<{ data: VehicleMake[] }>('/vehicles/tree').then((result) => setVehicles(result.data)).catch(() => undefined);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const created = await api<{ data: ProductDetail }>('/products', { method: 'POST', body: JSON.stringify(form) });
      setMessage(`محصول ${created.data.name} ثبت شد؛ تب‌های بعدی را کامل کنید.`);
      setForm(empty);
      setDraft(created.data);
      setTab('images');
      await load();
    } catch (error) { setMessage((error as Error).message); } finally { setSaving(false); }
  };

  const stock = (product: ProductRow) => product.inventoryItems?.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  return <section className="products-page">
    <div className="page-title">
      <div><h1>محصولات</h1><p className="muted">کاتالوگ، سئو خودکار، سازگاری خودرو و اقلام برند با بارکد EAN-13</p></div>
      <span className="count">{products.length} محصول</span>
    </div>

    <form className="product-form" onSubmit={submit}>
      <h2>افزودن محصول</h2>
      <label>نام محصول<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="مثلاً قاب ستون بالای پژو ۲۰۶" /></label>
      <label>دسته‌بندی<select required value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">انتخاب دسته‌بندی</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
      <label>شماره فنی<input value={form.partNumber} onChange={(event) => setForm({ ...form, partNumber: event.target.value })} placeholder="Part Number" dir="ltr" /></label>
      <label>وضعیت<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="active">فعال</option><option value="hidden">مخفی</option></select></label>
      <label>توضیحات<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="توضیح واقعی و کاربردی قطعه" /></label>
      <button disabled={saving}>{saving ? 'در حال ثبت…' : 'ثبت و ادامه در تب‌ها'}</button>
    </form>

    {message && <div className="notice">{message}</div>}

    <div className="product-table">
      <div className="table-head"><span>نام محصول</span><span>کد</span><span>دسته</span><span>موجودی</span><span>وضعیت</span><span>عملیات</span></div>
      {products.map((product) => <div className="table-row" key={product.id}>
        <strong>{product.name}</strong>
        <code dir="ltr">{product.code}</code>
        <span>{product.category?.name ?? '—'}</span>
        <span>{stock(product)}</span>
        <span className={product.status === 'active' ? 'status-chip' : 'low-stock'}>{product.status === 'active' ? 'فعال' : 'مخفی'}</span>
        <span>
          <button className="row-action" onClick={() => { void refresh(product.id).then(() => setTab('basic')); }}>ویرایش</button>
          {' '}
          <button className="row-action" onClick={async () => {
            if (!window.confirm('محصول حذف نرم شود؟ از سایت پنهان می‌شود.')) return;
            try { await api(`/products/${product.id}`, { method: 'DELETE' }); setMessage('محصول حذف نرم شد.'); await load(); } catch (error) { setMessage((error as Error).message); }
          }}>حذف</button>
        </span>
      </div>)}
    </div>

    {draft && <ProductEditor key={draft.id} product={draft} tab={tab} setTab={setTab} onClose={() => setDraft(null)} onMessage={setMessage} onRefresh={() => void refresh(draft.id)} media={media} categories={categories} brands={brands} locations={locations} vehicles={vehicles} />}
  </section>;
}

type EditorProps = {
  product: ProductDetail; tab: Tab; setTab: (tab: Tab) => void; onClose: () => void; onMessage: (text: string) => void; onRefresh: () => void;
  media: Media[]; categories: Category[]; brands: Brand[]; locations: Location[]; vehicles: VehicleMake[];
};

function ProductEditor({ product, tab, setTab, onClose, onMessage, onRefresh, media, categories, brands, locations, vehicles }: EditorProps) {
  const [basic, setBasic] = useState({ name: product.name, categoryId: product.category?.id ?? '', description: product.description ?? '', partNumber: product.partNumber ?? '', status: product.status, seoTitle: product.seoTitle ?? '', seoDescription: product.seoDescription ?? '', seoKeywords: (product.seoKeywords ?? []).join('، ') });
  const [aparatId, setAparatId] = useState(product.aparatVideoId ?? '');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [compat, setCompat] = useState<Array<{ modelId: string; trimId: string }>>((product.compatibilities ?? []).map((entry) => ({ modelId: entry.model.id, trimId: entry.trim?.id ?? '' })));
  const [pickModel, setPickModel] = useState('');
  const [pickTrim, setPickTrim] = useState('');
  const [item, setItem] = useState({ brandId: '', barcode: createEan13(String(Date.now()).slice(-9)), salePrice: '', purchasePrice: '', minStock: '', locationId: '', initialQuantity: '' });
  const [busy, setBusy] = useState(false);

  const models = useMemo(() => vehicles.flatMap((make) => make.models.map((model) => ({ ...model, make: make.name }))), [vehicles]);
  const trims = useMemo(() => vehicles.flatMap((make) => make.models).find((model) => model.id === pickModel)?.trims ?? [], [vehicles, pickModel]);

  const patch = async (payload: Record<string, unknown>, success: string) => {
    setBusy(true);
    try { await api(`/products/${product.id}`, { method: 'PATCH', body: JSON.stringify(payload) }); onMessage(success); onRefresh(); } catch (error) { onMessage((error as Error).message); } finally { setBusy(false); }
  };

  const saveBasic = async (event: FormEvent) => {
    event.preventDefault();
    await patch({
      name: basic.name, categoryId: basic.categoryId, description: basic.description || null, partNumber: basic.partNumber || null,
      status: basic.status, seoTitle: basic.seoTitle || null, seoDescription: basic.seoDescription || null,
      seoKeywords: basic.seoKeywords.split(/[،,]/).map((entry) => entry.trim()).filter(Boolean),
    }, 'مشخصات و سئو ذخیره شد');
  };

  const upload = async () => {
    if (!mediaFile) return onMessage('ابتدا یک فایل انتخاب کنید');
    setBusy(true);
    try {
      const data = new FormData(); data.append('file', mediaFile);
      await api(`/media/products/${product.id}/upload`, { method: 'POST', body: data });
      setMediaFile(null); onMessage('تصویر آپلود شد'); onRefresh();
    } catch (error) { onMessage((error as Error).message); } finally { setBusy(false); }
  };

  const saveCompat = async () => {
    setBusy(true);
    try { await api(`/products/${product.id}/compat`, { method: 'PUT', body: JSON.stringify({ vehicles: compat.map((entry) => ({ modelId: entry.modelId, trimId: entry.trimId || null })) }) }); onMessage('سازگاری خودرو ذخیره شد'); onRefresh(); } catch (error) { onMessage((error as Error).message); } finally { setBusy(false); }
  };

  const createItem = async () => {
    if (!item.brandId) return onMessage('برند قلم را انتخاب کنید');
    setBusy(true);
    try {
      await api('/inventory/items', { method: 'POST', body: JSON.stringify({ productId: product.id, brandId: item.brandId, barcode: item.barcode, salePrice: Number(item.salePrice) || 0, purchasePrice: Number(item.purchasePrice) || 0, minStock: item.minStock ? Number(item.minStock) : undefined, locationId: item.locationId || undefined, initialQuantity: item.initialQuantity ? Number(item.initialQuantity) : 0 }) });
      onMessage('قلم برند با بارکد ثبت شد'); setItem({ ...item, brandId: '', barcode: createEan13(String(Date.now()).slice(-9)), salePrice: '', purchasePrice: '', initialQuantity: '' }); onRefresh();
    } catch (error) { onMessage((error as Error).message); } finally { setBusy(false); }
  };

  return <div className="editor" role="dialog" aria-label="ویرایش محصول">
    <div className="editor-head">
      <h2>{product.name} <code dir="ltr">{product.code}</code></h2>
      <button className="close" onClick={onClose}>بستن</button>
    </div>
    <div className="tabs" role="tablist">
      {tabs.map((entry) => <button key={entry.id} role="tab" aria-selected={tab === entry.id} className={tab === entry.id ? 'tab active' : 'tab'} onClick={() => setTab(entry.id)}>{entry.label}</button>)}
    </div>

    {tab === 'basic' && <form className="product-form" onSubmit={saveBasic}>
      <label>نام<input required value={basic.name} onChange={(event) => setBasic({ ...basic, name: event.target.value })} /></label>
      <label>دسته‌بندی<select required value={basic.categoryId} onChange={(event) => setBasic({ ...basic, categoryId: event.target.value })}><option value="">انتخاب</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
      <label>شماره فنی<input dir="ltr" value={basic.partNumber} onChange={(event) => setBasic({ ...basic, partNumber: event.target.value })} /></label>
      <label>وضعیت<select value={basic.status} onChange={(event) => setBasic({ ...basic, status: event.target.value })}><option value="active">فعال</option><option value="hidden">مخفی</option></select></label>
      <label>توضیحات<input value={basic.description} onChange={(event) => setBasic({ ...basic, description: event.target.value })} /></label>
      <label>عنوان سئو<input value={basic.seoTitle} onChange={(event) => setBasic({ ...basic, seoTitle: event.target.value })} placeholder="خالی = تولید خودکار" /></label>
      <label>توضیح سئو<input value={basic.seoDescription} onChange={(event) => setBasic({ ...basic, seoDescription: event.target.value })} placeholder="خالی = تولید خودکار" /></label>
      <label>کلیدواژه‌ها<input value={basic.seoKeywords} onChange={(event) => setBasic({ ...basic, seoKeywords: event.target.value })} placeholder="لنت، ترمز، پژو ۲۰۶" /></label>
      <button disabled={busy}>{busy ? 'در حال ذخیره…' : 'ذخیرهٔ پایه و سئو'}</button>
    </form>}

    {tab === 'images' && <div>
      <div className="image-grid">
        {(product.images ?? []).map((image) => <div className="image-item" key={image.id}>
          <img src={image.path} alt={image.alt ?? product.name} />
          <small>{image.isPrimary ? 'تصویر اصلی' : image.alt ?? 'بدون Alt'}</small>
          <button onClick={() => void api(`/media/products/${product.id}/${image.id}/primary`, { method: 'PATCH' }).then(() => { onMessage('تصویر اصلی تغییر کرد'); onRefresh(); })}>اصلی</button>
          <button className="danger" onClick={() => void api(`/media/products/${product.id}/${image.id}`, { method: 'DELETE' }).then(() => { onMessage('تصویر حذف شد'); onRefresh(); })}>حذف</button>
        </div>)}
        {!(product.images ?? []).length && <p className="muted">هنوز تصویری بارگذاری نشده است.</p>}
      </div>
      <div className="editor-actions">
        <input type="file" accept="image/*" onChange={(event) => setMediaFile(event.target.files?.[0] ?? null)} />
        <button disabled={busy} onClick={() => void upload()}>آپلود</button>
        <input dir="ltr" value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)} placeholder="https://…" />
        <button disabled={busy} onClick={async () => { if (!mediaUrl) return onMessage('نشانی تصویر را وارد کنید'); try { await api(`/media/products/${product.id}/url`, { method: 'POST', body: JSON.stringify({ url: mediaUrl, alt: product.name }) }); setMediaUrl(''); onMessage('تصویر از نشانی افزوده شد'); onRefresh(); } catch (error) { onMessage((error as Error).message); } }}>افزودن از نشانی</button>
        <select defaultValue="" onChange={async (event) => { if (!event.target.value) return; try { await api(`/media/products/${product.id}/select`, { method: 'POST', body: JSON.stringify({ imageId: event.target.value, alt: product.name }) }); onMessage('تصویر از کتابخانه افزوده شد'); onRefresh(); } catch (error) { onMessage((error as Error).message); } }}>
          <option value="">انتخاب از کتابخانهٔ رسانه</option>
          {media.filter((entry) => entry.product?.name !== product.name).map((entry) => <option key={entry.id} value={entry.id}>{entry.product?.name ?? entry.path}</option>)}
        </select>
      </div>
      <p className="muted">تصاویر با همان نشانی در سایت و فاکتور استفاده می‌شوند؛ Alt خالی برای دسترسی‌پذیری و سئو توصیه نمی‌شود.</p>
    </div>}

    {tab === 'aparat' && <div className="form-grid">
      <label>شناسهٔ ویدیوی آپارات<input dir="ltr" value={aparatId} onChange={(event) => setAparatId(event.target.value)} placeholder="مثلاً a1b2c3d4" /></label>
      <button disabled={busy} onClick={() => void patch({ aparatVideoId: aparatId || null }, aparatId ? 'ویدیوی آپارات ذخیره شد' : 'ویدیوی آپارات حذف شد')}>ذخیره</button>
      {aparatId && <iframe title="پیش‌نمایش ویدیو" className="aparat-frame" src={aparatEmbed(aparatId)} allowFullScreen />}
      <p className="muted">فقط شناسهٔ ویدیو ذخیره می‌شود؛ پخش در سایت عمومی با iframe همان شناسه انجام می‌شود و فایلی آپلود نمی‌گردد.</p>
    </div>}

    {tab === 'vehicles' && <div>
      <div className="invoice-product-picker">
        <select aria-label="مدل خودرو" value={pickModel} onChange={(event) => { setPickModel(event.target.value); setPickTrim(''); }}>
          <option value="">انتخاب مدل</option>
          {models.map((model) => <option value={model.id} key={model.id}>{model.make} — {model.name}</option>)}
        </select>
        <select aria-label="تیپ خودرو" value={pickTrim} onChange={(event) => setPickTrim(event.target.value)}>
          <option value="">همهٔ تیپ‌ها</option>
          {trims.map((trim) => <option value={trim.id} key={trim.id}>{trim.name}</option>)}
        </select>
        <button type="button" disabled={!pickModel} onClick={() => setCompat((current) => current.some((entry) => entry.modelId === pickModel && entry.trimId === pickTrim) ? current : [...current, { modelId: pickModel, trimId: pickTrim }])}>افزودن</button>
      </div>
      <div className="invoice-lines">
        {compat.length ? compat.map((entry, index) => <div className="invoice-line" key={`${entry.modelId}-${entry.trimId}-${index}`}>
          <span><b>{models.find((model) => model.id === entry.modelId)?.make} {models.find((model) => model.id === entry.modelId)?.name}</b><small>{vehicles.flatMap((make) => make.models).find((model) => model.id === entry.modelId)?.trims.find((trim) => trim.id === entry.trimId)?.name ?? 'همهٔ تیپ‌ها'}</small></span>
          <button type="button" aria-label="حذف سازگاری" onClick={() => setCompat((current) => current.filter((_, i) => i !== index))}>×</button>
        </div>) : <p className="muted">هیچ خودرویی ثبت نشده؛ این محصول در فیلتر خودروهای سایت نمایش داده نمی‌شود.</p>}
      </div>
      <button disabled={busy} onClick={() => void saveCompat()}>ذخیرهٔ سازگاری</button>
    </div>}

    {tab === 'items' && <div>
      <div className="form-grid">
        <label>برند<select value={item.brandId} onChange={(event) => setItem({ ...item, brandId: event.target.value })}><option value="">انتخاب برند</option>{brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}</select></label>
        <label>بارکد EAN-13<input dir="ltr" value={item.barcode} onChange={(event) => setItem({ ...item, barcode: event.target.value })} /></label>
        <button type="button" onClick={() => setItem({ ...item, barcode: createEan13(`${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-9)) })}>تولید بارکد</button>
        <label>قیمت فروش (ریال)<input type="number" min="0" value={item.salePrice} onChange={(event) => setItem({ ...item, salePrice: event.target.value })} /></label>
        <label>قیمت خرید (ریال)<input type="number" min="0" value={item.purchasePrice} onChange={(event) => setItem({ ...item, purchasePrice: event.target.value })} /></label>
        <label>آستانهٔ هشدار<input type="number" min="0" value={item.minStock} onChange={(event) => setItem({ ...item, minStock: event.target.value })} /></label>
        <label>قفسه<select value={item.locationId} onChange={(event) => setItem({ ...item, locationId: event.target.value })}><option value="">بدون قفسه</option>{locations.map((location) => <option value={location.id} key={location.id}>{location.code} — {location.name}</option>)}</select></label>
        <label>موجودی اولیه<input type="number" min="0" value={item.initialQuantity} onChange={(event) => setItem({ ...item, initialQuantity: event.target.value })} /></label>
      </div>
      <button disabled={busy} onClick={() => void createItem()}>ثبت قلم برند</button>
      <div className="product-table">
        <div className="table-head"><span>برند</span><span>بارکد</span><span>قفسه</span><span>موجودی</span><span>قیمت فروش</span></div>
        {(product.inventoryItems ?? []).map((entry) => <div className="table-row" key={entry.id}>
          <strong>{entry.brand.name}</strong>
          <code dir="ltr">{entry.barcode}</code>
          <span>{entry.location?.code ?? '—'}</span>
          <span className={entry.minStock != null && entry.quantity <= entry.minStock ? 'low-stock' : undefined}>{entry.quantity}</span>
          <strong>{Number(entry.salePrice).toLocaleString('fa-IR')}</strong>
        </div>)}
      </div>
      <p className="muted">قیمت خرید هرگز در سایت عمومی یا فاکتور مشتری نمایش داده نمی‌شود.</p>
    </div>}
  </div>;
}
