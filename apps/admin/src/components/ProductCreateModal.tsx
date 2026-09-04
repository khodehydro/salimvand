import { useMemo, useState } from 'react';
import { createEan13 } from '@salimvand/shared';
import { FaNumberInput } from './FaNumberInput';
import { locationLabel } from '../lib/location-label';
import { api } from '../lib/api';
import { MediaImage } from './MediaImage';
import { MediaPicker, type PickerItem } from './MediaPicker';

/**
 * Unified product registration window: catalog entry, inventory item and
 * vehicle compatibility are filled in one place and saved once — registering
 * a product in the warehouse IS registering it in the catalog IS publishing
 * it to the website. The save button stays pinned in the footer while the
 * tabs switch above it, unlike the old «register at the top, continue from
 * the list» flow.
 */
type Option = { id: string; name: string };
type Location = { id: string; name: string; code: string; parent?: { name: string } | null };
type VehicleMake = {
  id: string;
  name: string;
  models: Array<{ id: string; name: string; trims: Array<{ id: string; name: string }> }>;
};

const tabs = [
  { id: 'basic', label: 'مشخصات و سئو' },
  { id: 'item', label: 'قلم انبار و قیمت' },
  { id: 'vehicles', label: 'سازگاری خودرو' },
] as const;
type Tab = (typeof tabs)[number]['id'];

const emptyBasic = {
  name: '',
  categoryId: '',
  description: '',
  partNumber: '',
  status: 'active',
  priceDisplay: 'inherit',
  seoTitle: '',
  seoDescription: '',
  seoKeywords: '',
};
const emptyItem = {
  brandId: '',
  barcode: '',
  salePrice: '',
  purchasePrice: '',
  minStock: '',
  locationId: '',
  initialQuantity: '',
};

export function ProductCreateModal({
  open,
  onClose,
  onCreated,
  categories,
  brands,
  locations,
  vehicles,
  inline = false,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (message: string) => void;
  categories: Option[];
  brands: Option[];
  locations: Location[];
  vehicles: VehicleMake[];
  inline?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('basic');
  const [basic, setBasic] = useState(emptyBasic);
  const [item, setItem] = useState(emptyItem);
  const [compat, setCompat] = useState<Array<{ modelId: string; trimId: string }>>([]);
  const [pickModel, setPickModel] = useState('');
  const [pickTrim, setPickTrim] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [selectedImage, setSelectedImage] = useState<PickerItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const models = useMemo(
    () => vehicles.flatMap((make) => make.models.map((model) => ({ ...model, make: make.name }))),
    [vehicles],
  );
  const trims = useMemo(
    () =>
      vehicles.flatMap((make) => make.models).find((model) => model.id === pickModel)?.trims ?? [],
    [vehicles, pickModel],
  );

  if (!open) return null;

  const reset = () => {
    setTab('basic');
    setBasic(emptyBasic);
    setItem({ ...emptyItem, barcode: '' });
    setCompat([]);
    setPickModel('');
    setPickTrim('');
    setError('');
    setImageUrl('');
    setImageFile(null);
    setSelectedImage(null);
    setPickerOpen(false);
  };

  const submit = async () => {
    setError('');
    if (!basic.name.trim() || !basic.categoryId) {
      setTab('basic');
      return setError('نام محصول و دسته‌بندی در تب «مشخصات و سئو» الزامی است.');
    }
    if (item.brandId && (!item.salePrice || !item.purchasePrice)) {
      setTab('item');
      return setError('برند را که انتخاب می‌کنید، قیمت خرید و فروش (ریال) هم لازم است.');
    }
    setBusy(true);
    // Which step failed, if any — the error message tells the operator what
    // was already saved so they do not register the product twice.
    let stage = 'مشخصات محصول';
    try {
      // 1) Catalog entry — this is what the public site reads.
      const created = await api<{ data: { id: string; name: string; code: string } }>('/products', {
        method: 'POST',
        body: JSON.stringify({
          name: basic.name,
          categoryId: basic.categoryId,
          description: basic.description || null,
          partNumber: basic.partNumber || null,
          status: basic.status,
          priceDisplay: basic.priceDisplay,
          seoTitle: basic.seoTitle || null,
          seoDescription: basic.seoDescription || null,
          seoKeywords: basic.seoKeywords
            .split(/[،,]/)
            .map((entry) => entry.trim())
            .filter(Boolean),
        }),
      });
      const productId = created.data.id;
      stage = 'تصویر محصول';
      if (imageUrl.trim()) {
        await api(`/media/products/${productId}/url`, {
          method: 'POST',
          body: JSON.stringify({ url: imageUrl.trim(), alt: basic.name }),
        });
      } else if (imageFile) {
        const form = new FormData();
        form.append('file', imageFile);
        form.append('alt', basic.name);
        await api(`/media/products/${productId}/upload`, { method: 'POST', body: form });
      } else if (selectedImage) {
        await api(`/media/products/${productId}/select`, {
          method: 'POST',
          body: JSON.stringify({ imageId: selectedImage.id, alt: basic.name }),
        });
      }
      stage = 'قلم انبار';
      // 2) Inventory item — brand, prices and the opening stock, all optional
      //    but filled in the same window so the flow is not split.
      if (item.brandId) {
        await api('/inventory/items', {
          method: 'POST',
          body: JSON.stringify({
            productId,
            brandId: item.brandId,
            barcode: item.barcode || createEan13(`${Date.now()}`.slice(-9)),
            purchasePrice: Number(item.purchasePrice) || 0,
            salePrice: Number(item.salePrice) || 0,
            minStock: item.minStock ? Number(item.minStock) : undefined,
            locationId: item.locationId || undefined,
            initialQuantity: item.initialQuantity ? Number(item.initialQuantity) : 0,
          }),
        });
      }
      stage = 'سازگاری خودرو';
      // 3) Vehicle compatibility for the site filters.
      if (compat.length) {
        await api(`/products/${productId}/compat`, {
          method: 'PUT',
          body: JSON.stringify({
            vehicles: compat.map((entry) => ({
              modelId: entry.modelId,
              trimId: entry.trimId || null,
            })),
          }),
        });
      }
      onCreated(
        `محصول «${created.data.name}» ثبت شد${item.brandId ? ' — قلم انبار و بارکد ایجاد گردید' : ''} و روی سایت نمایش داده می‌شود.`,
      );
      reset();
      onClose();
    } catch (e) {
      const base = (e as Error).message;
      setError(
        stage === 'قلم انبار' && item.brandId
          ? `محصول ثبت شد اما ثبت ${stage} ناموفق بود: ${base} — پنجره را نبندید و دوباره ذخیره نکنید؛ محصول را از لیست ویرایش کنید.`
          : stage !== 'قلم انبار' && compat.length
            ? `محصول و قلم انبار ثبت شد اما ثبت ${stage} ناموفق بود: ${base} — از ویرایشگر محصول کامل کنید.`
            : base,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={inline ? 'product-create-inline' : 'modal-backdrop'}
      role={inline ? undefined : 'presentation'}
      onClick={inline ? undefined : onClose}
    >
      <div
        className={inline ? 'product-create-inline-editor' : 'editor product-create-modal'}
        role="dialog"
        aria-modal={inline ? undefined : true}
        aria-label="ثبت محصول جدید"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="editor-head">
          <h2>ثبت محصول جدید</h2>
          <button className="close" onClick={onClose} aria-label="بستن">
            ✕
          </button>
        </div>
        <p className="modal-hint">
          ثبت در انبار = ثبت در کاتالوگ = نمایش در سایت. هر سه بخش را در همین پنجره پر کنید و یک بار
          ذخیره کنید.
        </p>
        <div className="tabs" role="tablist">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={tab === entry.id}
              className={tab === entry.id ? 'tab active' : 'tab'}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="editor-body">
          {tab === 'basic' && (
            <>
              <div className="form-grid">
              <label>
                نام محصول *
                <input
                  value={basic.name}
                  onChange={(event) => setBasic({ ...basic, name: event.target.value })}
                  placeholder="مثلاً قاب ستون بالای پژو ۲۰۶"
                />
              </label>
              <label>
                دسته‌بندی *
                <select
                  value={basic.categoryId}
                  onChange={(event) => setBasic({ ...basic, categoryId: event.target.value })}
                >
                  <option value="">انتخاب دسته‌بندی</option>
                  {categories.map((category) => (
                    <option value={category.id} key={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                شماره فنی
                <input
                  dir="ltr"
                  value={basic.partNumber}
                  onChange={(event) => setBasic({ ...basic, partNumber: event.target.value })}
                  placeholder="Part Number"
                />
              </label>
              <label>
                وضعیت
                <select
                  value={basic.status}
                  onChange={(event) => setBasic({ ...basic, status: event.target.value })}
                >
                  <option value="active">فعال</option>
                  <option value="hidden">مخفی</option>
                </select>
              </label>
              <label>
                نمایش قیمت در سایت
                <select
                  value={basic.priceDisplay}
                  onChange={(event) => setBasic({ ...basic, priceDisplay: event.target.value })}
                >
                  <option value="inherit">مطابق تنظیم سایت</option>
                  <option value="show">همیشه نمایش بده</option>
                  <option value="hide">همیشه پنهان (استعلام)</option>
                </select>
              </label>
              <label>
                توضیحات
                <input
                  value={basic.description}
                  onChange={(event) => setBasic({ ...basic, description: event.target.value })}
                  placeholder="توضیح واقعی و کاربردی قطعه"
                />
              </label>
              <label>
                عنوان سئو
                <input
                  value={basic.seoTitle}
                  onChange={(event) => setBasic({ ...basic, seoTitle: event.target.value })}
                  placeholder="خالی = تولید خودکار"
                />
              </label>
              <label>
                توضیح سئو
                <input
                  value={basic.seoDescription}
                  onChange={(event) => setBasic({ ...basic, seoDescription: event.target.value })}
                  placeholder="خالی = تولید خودکار"
                />
              </label>
              <label>
                کلیدواژه‌ها
                <input
                  value={basic.seoKeywords}
                  onChange={(event) => setBasic({ ...basic, seoKeywords: event.target.value })}
                  placeholder="لنت، ترمز، پژو ۲۰۶"
                />
              </label>
            </div>
            <div className="create-image-panel">
              <div className="create-image-heading">
                <b>تصویر محصول</b>
                <small>اختیاری · لینک، آپلود یا انتخاب از رسانه‌ها</small>
              </div>
              <div className="create-image-actions">
                <label className="create-image-url">
                  لینک تصویر
                  <input
                    dir="ltr"
                    value={imageUrl}
                    onChange={(event) => {
                      setImageUrl(event.target.value);
                      setImageFile(null);
                      setSelectedImage(null);
                    }}
                    placeholder="https://example.com/product.jpg"
                  />
                </label>
                <label className="create-image-upload">
                  آپلود تصویر
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      setImageFile(event.target.files?.[0] ?? null);
                      setImageUrl('');
                      setSelectedImage(null);
                    }}
                  />
                </label>
                <button type="button" className="outline" onClick={() => setPickerOpen(true)}>
                  انتخاب از رسانه‌ها
                </button>
              </div>
              {(imageFile || selectedImage || imageUrl) && (
                <div className="create-image-selected">
                  <span>✓</span>
                  {imageFile?.name ?? selectedImage?.path ?? imageUrl}
                </div>
              )}
              </div>
            </>
          )}

          {tab === 'item' && (
            <div>
              <div className="form-grid">
                <label>
                  برند قطعه
                  <select
                    value={item.brandId}
                    onChange={(event) => setItem({ ...item, brandId: event.target.value })}
                  >
                    <option value="">بدون قلم انبار (بعداً از ویرایشگر اضافه کنید)</option>
                    {brands.map((brand) => (
                      <option value={brand.id} key={brand.id}>
                        {brand.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  بارکد EAN-13
                  <input
                    dir="ltr"
                    value={item.barcode}
                    onChange={(event) => setItem({ ...item, barcode: event.target.value })}
                    placeholder="خالی = تولید خودکار"
                  />
                </label>
                <label>
                  قیمت فروش (ریال) *
                  <FaNumberInput
                    value={item.salePrice}
                    onChange={(plain) => setItem({ ...item, salePrice: plain })}
                  />
                </label>
                <label>
                  قیمت خرید (ریال) *
                  <FaNumberInput
                    value={item.purchasePrice}
                    onChange={(plain) => setItem({ ...item, purchasePrice: plain })}
                  />
                </label>
                <label>
                  موجودی اولیه
                  <FaNumberInput
                    group={false}
                    value={item.initialQuantity}
                    onChange={(plain) => setItem({ ...item, initialQuantity: plain })}
                    placeholder="۰"
                  />
                </label>
                <label>
                  آستانهٔ هشدار
                  <FaNumberInput
                    group={false}
                    value={item.minStock}
                    onChange={(plain) => setItem({ ...item, minStock: plain })}
                    placeholder="مثلاً ۳"
                  />
                </label>
                <label>
                  قفسه
                  <select
                    value={item.locationId}
                    onChange={(event) => setItem({ ...item, locationId: event.target.value })}
                  >
                    <option value="">بدون قفسه</option>
                    {locations.map((location) => (
                      <option value={location.id} key={location.id}>
                        {locationLabel(location)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="muted">
                قیمت خرید فقط داخلی است و هرگز در سایت یا فاکتور مشتری نمایش داده نمی‌شود.
              </p>
            </div>
          )}

          {tab === 'vehicles' && (
            <div>
              <div className="invoice-product-picker">
                <select
                  aria-label="مدل خودرو"
                  value={pickModel}
                  onChange={(event) => {
                    setPickModel(event.target.value);
                    setPickTrim('');
                  }}
                >
                  <option value="">انتخاب مدل</option>
                  {models.map((model) => (
                    <option value={model.id} key={model.id}>
                      {model.make} — {model.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="تیپ خودرو"
                  value={pickTrim}
                  onChange={(event) => setPickTrim(event.target.value)}
                >
                  <option value="">همهٔ تیپ‌ها</option>
                  {trims.map((trim) => (
                    <option value={trim.id} key={trim.id}>
                      {trim.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!pickModel}
                  onClick={() =>
                    setCompat((current) =>
                      current.some(
                        (entry) => entry.modelId === pickModel && entry.trimId === pickTrim,
                      )
                        ? current
                        : [...current, { modelId: pickModel, trimId: pickTrim }],
                    )
                  }
                >
                  افزودن
                </button>
              </div>
              <div className="invoice-lines">
                {compat.length ? (
                  compat.map((entry, index) => (
                    <div className="invoice-line" key={`${entry.modelId}-${entry.trimId}-${index}`}>
                      <span>
                        <b>
                          {models.find((model) => model.id === entry.modelId)?.make}{' '}
                          {models.find((model) => model.id === entry.modelId)?.name}
                        </b>
                        <small>
                          {models
                            .find((model) => model.id === entry.modelId)
                            ?.trims.find((trim) => trim.id === entry.trimId)?.name ?? 'همهٔ تیپ‌ها'}
                        </small>
                      </span>
                      <button
                        type="button"
                        aria-label="حذف سازگاری"
                        onClick={() =>
                          setCompat((current) => current.filter((_, i) => i !== index))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    اختیاری است؛ بدون خودروی سازگار، محصول در فیلتر خودروهای سایت نمایش داده
                    نمی‌شود.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {error && <div className="notice field-error">{error}</div>}
        <div className="editor-footer">
          <button type="button" className="outline" onClick={onClose} disabled={busy}>
            انصراف
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? 'در حال ثبت…' : '✓ ثبت محصول (انبار + کاتالوگ + سایت)'}
          </button>
        </div>
      </div>
      <MediaPicker
        open={pickerOpen}
        title="انتخاب تصویر محصول از رسانه‌ها"
        onClose={() => setPickerOpen(false)}
        onSelect={(image) => {
          setSelectedImage(image);
          setImageFile(null);
          setImageUrl('');
        }}
      />
    </div>
  );
}

/** Small thumbnail for list rows: primary image or a neutral placeholder. */
export function ProductThumb({
  image,
  name,
}: {
  image?: { path: string; alt?: string | null } | null;
  name: string;
}) {
  if (!image) return <span className="product-thumb placeholder">قطعه</span>;
  return (
    <span className="product-thumb">
      <MediaImage src={image.path} alt={image.alt ?? name} />
    </span>
  );
}
