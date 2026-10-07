import { useEffect, useMemo, useRef, useState } from 'react';
import { createEan13, formatPersianNumber } from '@salimvand/shared';
import { FaNumberInput } from './FaNumberInput';
import { basketLabel, locationLabel } from '../lib/location-label';
import { api } from '../lib/api';
import { MediaPicker, type PickerItem } from './MediaPicker';

/**
 * Unified product registration window: catalog entry, inventory item and
 * vehicle compatibility are filled in one place and saved once — registering
 * a product in the warehouse IS registering it in the catalog IS publishing
 * it to the website.
 *
 * Simplified layout (pc-* classes, owned by this file only): one compact
 * card with only the fields an operator touches daily (name, category,
 * brand, quantity, prices, shelf/basket, supplier) and EVERYTHING optional
 * folded into a single «گزینه‌های بیشتر» <details>. The submit is atomic:
 * catalog row + all stock lines go in ONE POST /products call (items[]),
 * so quantity/price/location can never be silently dropped and a failure
 * leaves nothing half-registered.
 */
type Option = { id: string; name: string };
type Location = {
  id: string;
  name: string;
  code: string;
  type: string;
  parentId?: string | null;
  parent?: { name: string } | null;
};
type VehicleMake = {
  id: string;
  name: string;
  models: Array<{ id: string; name: string; trims: Array<{ id: string; name: string }> }>;
};

const emptyBasic = {
  name: '',
  categoryId: '',
  supplierId: '',
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
  supplierId: '',
  salePrice: '',
  purchasePrice: '',
  minStock: '',
  locationId: '',
  basketId: '',
  initialQuantity: '',
};

/** A stock line is worth sending when ANY of its fields was touched. */
function lineHasContent(entry: typeof emptyItem): boolean {
  return Boolean(
    entry.brandId ||
      entry.supplierId ||
      entry.locationId ||
      entry.basketId ||
      entry.barcode.trim() ||
      Number(entry.purchasePrice) > 0 ||
      Number(entry.salePrice) > 0 ||
      Number(entry.minStock) > 0 ||
      Number(entry.initialQuantity) > 0,
  );
}

export function ProductCreateModal({
  open,
  onClose,
  onCreated,
  categories,
  brands,
  locations,
  vehicles,
  suppliers: initialSuppliers,
  inline = false,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (message: string) => void;
  categories: Option[];
  brands: Option[];
  locations: Location[];
  vehicles: VehicleMake[];
  suppliers?: Option[];
  inline?: boolean;
}) {
  const [basic, setBasic] = useState(emptyBasic);
  const [items, setItems] = useState([{ ...emptyItem }]);
  const [suppliers, setSuppliers] = useState<Option[]>(initialSuppliers ?? []);

  useEffect(() => {
    if (initialSuppliers?.length) {
      setSuppliers(initialSuppliers);
    } else {
      api<{ data: Option[] }>('/suppliers')
        .then((res) => setSuppliers(res.data))
        .catch(() => {});
    }
  }, [initialSuppliers]);
  const updateItem = (index: number, patch: Partial<typeof emptyItem>) =>
    setItems((current) => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  const [compat, setCompat] = useState<Array<{ modelId: string; trimId: string }>>([]);
  const [pickModel, setPickModel] = useState('');
  const [pickTrim, setPickTrim] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [selectedImages, setSelectedImages] = useState<PickerItem[]>([]);
  const imageUrlList = imageUrl
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const removeImageUrl = (url: string) =>
    setImageUrl(imageUrlList.filter((value) => value !== url).join('\n'));
  const [pickerOpen, setPickerOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const models = useMemo(
    () => vehicles.flatMap((make) => make.models.map((model) => ({ ...model, make: make.name }))),
    [vehicles],
  );
  // Placement: shelves are every non-basket location, and a basket can only
  // be chosen for the shelf that owns it.
  const shelves = useMemo(
    () => locations.filter((location) => location.type !== 'basket'),
    [locations],
  );
  const baskets = useMemo(
    () => locations.filter((location) => location.type === 'basket'),
    [locations],
  );
  const basketsOf = (shelfId: string) =>
    baskets.filter((basket) => (basket.parentId ?? null) === (shelfId || null));
  const trims = useMemo(
    () =>
      vehicles.flatMap((make) => make.models).find((model) => model.id === pickModel)?.trims ?? [],
    [vehicles, pickModel],
  );

  // Display-only derivations for the optional-sections badge.
  const validImageUrlList = imageUrlList.filter((url) => /^https:\/\//i.test(url));
  const imageCount = imageFiles.length + selectedImages.length + validImageUrlList.length;
  const filledLines = items.filter(lineHasContent).length;

  // Object URLs for local file previews are created once per file list (the
  // old inline URL.createObjectURL leaked a fresh URL on every render) and
  // revoked when the list changes or the modal unmounts.
  const filePreviews = useMemo(
    () => imageFiles.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [imageFiles],
  );
  useEffect(
    () => () => {
      for (const entry of filePreviews) URL.revokeObjectURL(entry.url);
    },
    [filePreviews],
  );

  if (!open) return null;

  const reset = () => {
    setBasic(emptyBasic);
    setItems([{ ...emptyItem }]);
    setCompat([]);
    setPickModel('');
    setPickTrim('');
    setError('');
    setImageUrl('');
    setImageFiles([]);
    setSelectedImages([]);
    setPickerOpen(false);
  };

  const submit = async () => {
    setError('');
    if (!basic.name.trim() || !basic.categoryId) {
      setError('نام محصول و دسته‌بندی برای ثبت الزامی است.');
      nameRef.current?.focus();
      nameRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    setBusy(true);
    // Which step failed, if any — the error message tells the operator what
    // was already saved so they do not register the product twice.
    let stage = 'محصول و موجودی';
    try {
      // ONE atomic call: the API creates the catalog row and every stock
      // line (brand, prices, barcode, shelf/basket, opening quantity and
      // its ledger entry) inside a single transaction. Nothing is dropped
      // when برند is left empty — a no-brand stock line is valid — and a
      // failure here means NOTHING was saved.
      const payloadItems = items.filter(lineHasContent).map((entry, index) => ({
        brandId: entry.brandId || undefined,
        supplierId: entry.supplierId || basic.supplierId || undefined,
        barcode: entry.barcode.trim() || createEan13(`${Date.now()}${index}`.slice(-9)),
        purchasePrice: Number(entry.purchasePrice) || 0,
        salePrice: Number(entry.salePrice) || 0,
        minStock: Number(entry.minStock) || 0,
        locationId: entry.locationId || undefined,
        basketId: entry.basketId || undefined,
        initialQuantity: Number(entry.initialQuantity) || 0,
      }));
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
          ...(payloadItems.length ? { items: payloadItems } : {}),
        }),
      });
      const productId = created.data.id;
      stage = 'تصاویر';
      for (const url of imageUrlList) {
        await api(`/media/products/${productId}/url`, {
          method: 'POST',
          body: JSON.stringify({ url, alt: basic.name }),
        });
      }
      for (const file of imageFiles) {
        const form = new FormData();
        form.append('file', file);
        form.append('alt', basic.name);
        await api(`/media/products/${productId}/upload`, { method: 'POST', body: form });
      }
      for (const image of selectedImages) {
        await api(`/media/products/${productId}/select`, {
          method: 'POST',
          body: JSON.stringify({ imageId: image.id, alt: image.alt ?? basic.name }),
        });
      }
      stage = 'سازگاری خودرو';
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
        `محصول «${created.data.name}» ثبت شد${
          filledLines ? ` — ${formatPersianNumber(filledLines)} قلم انبار با تعداد و قیمت` : ''
        } و روی سایت نمایش داده می‌شود.${
          basic.status === 'active'
            ? ' آگهی آن به‌صورت خودکار در کانال‌های تلگرام و بله هم منتشر می‌شود.'
            : ''
        }`,
      );
      reset();
      onClose();
    } catch (e) {
      const base = (e as Error).message;
      setError(
        stage === 'محصول و موجودی'
          ? `ثبت انجام نشد و چیزی ذخیره نشده است: ${base}`
          : `محصول و موجودی ثبت شد اما ثبت ${stage} ناموفق بود: ${base} — محصول را از لیست محصولات ویرایش کنید.`,
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
        className={
          inline ? 'product-create-inline-editor pc-shell' : 'editor product-create-modal pc-shell'
        }
        role="dialog"
        aria-modal={inline ? undefined : true}
        aria-label="ثبت محصول جدید"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="editor-head pc-head">
          <div className="pc-head-titles">
            <h2>ثبت محصول جدید</h2>
            <p>همه‌چیز با یک دکمه ثبت می‌شود؛ فیلدهای اختیاری لازم نیست پر شوند.</p>
          </div>
          <button className="close" onClick={onClose} aria-label="بستن">
            ✕
          </button>
        </header>

        <div className="editor-body pc-body">
          {error && (
            <div className="pc-error" role="alert">
              {error}
            </div>
          )}

          {/* ── کارت اصلی: فقط چیزهایی که هر روز پر می‌شوند ── */}
          <section className="pc-section">
            <div className="pc-grid">
              <label className="pc-s6 is-req">
                نام محصول
                <input
                  ref={nameRef}
                  value={basic.name}
                  onChange={(event) => setBasic({ ...basic, name: event.target.value })}
                  placeholder="مثلاً قاب ستون بالای پژو ۲۰۶"
                />
              </label>
              <label className="pc-s3 is-req">
                دسته‌بندی
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
              <label className="pc-s3">
                تأمین‌کننده
                <select
                  value={basic.supplierId}
                  onChange={(event) => {
                    const supId = event.target.value;
                    setBasic({ ...basic, supplierId: supId });
                    setItems((current) =>
                      current.map((item, idx) =>
                        idx === 0 && !item.supplierId ? { ...item, supplierId: supId } : item,
                      ),
                    );
                  }}
                >
                  <option value="">بدون تأمین‌کننده</option>
                  {suppliers.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {items.map((item, index) => (
              <div className="pc-item" key={index}>
                {items.length > 1 && (
                  <div className="pc-item-head">
                    <b>قلم {formatPersianNumber(index + 1)}</b>
                    <span className="pc-item-brand">
                      {brands.find((brand) => brand.id === item.brandId)?.name ?? 'بدون برند'}
                    </span>
                    <button
                      type="button"
                      className="pc-item-remove"
                      onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                    >
                      حذف
                    </button>
                  </div>
                )}
                <div className="pc-grid">
                  <label className="pc-s2">
                    برند
                    <select
                      value={item.brandId}
                      onChange={(event) => updateItem(index, { brandId: event.target.value })}
                    >
                      <option value="">بدون برند</option>
                      {brands.map((brand) => (
                        <option value={brand.id} key={brand.id}>
                          {brand.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="pc-s2">
                    تعداد
                    <FaNumberInput
                      group={false}
                      value={item.initialQuantity}
                      onChange={(plain) => updateItem(index, { initialQuantity: plain })}
                      placeholder="۰"
                    />
                  </label>
                  <label className="pc-s2">
                    قیمت خرید (ریال)
                    <FaNumberInput
                      value={item.purchasePrice}
                      onChange={(plain) => updateItem(index, { purchasePrice: plain })}
                    />
                  </label>
                  <label className="pc-s2">
                    قیمت فروش (ریال)
                    <FaNumberInput
                      value={item.salePrice}
                      onChange={(plain) => updateItem(index, { salePrice: plain })}
                    />
                  </label>
                  <label className="pc-s2">
                    قفسه
                    <select
                      value={item.locationId}
                      onChange={(event) =>
                        updateItem(index, {
                          locationId: event.target.value,
                          basketId: '',
                        })
                      }
                    >
                      <option value="">بدون قفسه</option>
                      {shelves.map((location) => (
                        <option value={location.id} key={location.id}>
                          {locationLabel(location)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="pc-s2">
                    سبد (اختیاری)
                    <select
                      value={item.basketId}
                      disabled={!item.locationId}
                      onChange={(event) => updateItem(index, { basketId: event.target.value })}
                    >
                      <option value="">بدون سبد</option>
                      {basketsOf(item.locationId).map((basket) => (
                        <option value={basket.id} key={basket.id}>
                          {basketLabel(basket)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="pc-item-add"
              onClick={() => setItems((current) => [...current, { ...emptyItem }])}
            >
              ＋ این قطعه با برند دیگری هم ثبت شود
            </button>
          </section>

          {/* ── همه‌چیز اختیاری در یک جمع‌شونده ── */}
          <details className="pc-seo">
            <summary>
              <span className="pc-seo-title">گزینه‌های بیشتر</span>
              <small>
                تصویر، خودروهای سازگار، توضیحات، بارکد و سئو — همه اختیاری
                {(imageCount > 0 || compat.length > 0) &&
                  ` — ${[
                    imageCount ? `${formatPersianNumber(imageCount)} تصویر` : '',
                    compat.length ? `${formatPersianNumber(compat.length)} خودرو` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}`}
              </small>
            </summary>
            <div className="pc-seo-body">
            <section className="pc-section">
              <h3>تصاویر محصول</h3>
              <div className="pc-image-sources">
                <label className="pc-image-src">
                  لینک تصویر
                  <textarea
                    dir="ltr"
                    value={imageUrl}
                    onChange={(event) => {
                      setImageUrl(event.target.value);
                      setImageFiles([]);
                      setSelectedImages([]);
                    }}
                    placeholder="هر لینک https در یک خط"
                    rows={2}
                  />
                </label>
                <label className="pc-image-src">
                  آپلود از سیستم
                  <input
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      setImageFiles(Array.from(event.target.files ?? []));
                      setImageUrl('');
                      setSelectedImages([]);
                    }}
                  />
                </label>
                <div className="pc-image-src">
                  کتابخانهٔ رسانه
                  <button type="button" className="outline" onClick={() => setPickerOpen(true)}>
                    انتخاب از رسانه‌ها
                  </button>
                </div>
              </div>
              {imageCount > 0 && (
                <div className="pc-previews">
                  {filePreviews.map((entry) => (
                    <figure
                      className="pc-preview"
                      key={`${entry.file.name}-${entry.file.lastModified}`}
                    >
                      <img src={entry.url} alt={entry.file.name} />
                      <figcaption>{entry.file.name}</figcaption>
                      <button
                        type="button"
                        className="pc-preview-x"
                        onClick={() =>
                          setImageFiles((current) =>
                            current.filter((file) => file !== entry.file),
                          )
                        }
                        aria-label={`حذف ${entry.file.name}`}
                      >
                        ×
                      </button>
                    </figure>
                  ))}
                  {selectedImages.map((image) => (
                    <figure className="pc-preview" key={image.id}>
                      <img src={image.path} alt={image.alt ?? basic.name} />
                      <figcaption>{image.alt ?? 'رسانهٔ انتخاب‌شده'}</figcaption>
                      <button
                        type="button"
                        className="pc-preview-x"
                        onClick={() =>
                          setSelectedImages((current) =>
                            current.filter((entry) => entry.id !== image.id),
                          )
                        }
                        aria-label="حذف تصویر"
                      >
                        ×
                      </button>
                    </figure>
                  ))}
                  {validImageUrlList.map((url) => (
                    <figure className="pc-preview" key={url}>
                      <img src={url} alt={basic.name} />
                      <figcaption>تصویر لینک‌شده</figcaption>
                      <button
                        type="button"
                        className="pc-preview-x"
                        onClick={() => removeImageUrl(url)}
                        aria-label="حذف تصویر"
                      >
                        ×
                      </button>
                    </figure>
                  ))}
                </div>
              )}
            </section>

            <section className="pc-section">
              <h3>خودروهای سازگار</h3>
              <div className="pc-vehicle-picker">
                <select
                  aria-label="مدل خودرو"
                  value={pickModel}
                  onChange={(event) => {
                    setPickModel(event.target.value);
                    setPickTrim('');
                  }}
                >
                  <option value="">انتخاب مدل خودرو</option>
                  {models.map((model) => (
                    <option value={model.id} key={model.id}>
                      {model.make} {model.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="تیپ خودرو"
                  value={pickTrim}
                  disabled={!pickModel || !trims.length}
                  onChange={(event) => setPickTrim(event.target.value)}
                >
                  <option value="">بدون تیزپ (کل مدل)</option>
                  {trims.map((trim) => (
                    <option value={trim.id} key={trim.id}>
                      {trim.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="outline"
                  disabled={!pickModel}
                  onClick={() => {
                    if (!pickModel) return;
                    const duplicate = compat.some(
                      (entry) => entry.modelId === pickModel && entry.trimId === pickTrim,
                    );
                    if (!duplicate) setCompat((current) => [...current, { modelId: pickModel, trimId: pickTrim }]);
                    setPickTrim('');
                  }}
                >
                  افزودن
                </button>
              </div>
              {compat.length > 0 && (
                <div className="pc-compat-list">
                  {compat.map((entry, index) => {
                    const model = models.find((candidate) => candidate.id === entry.modelId);
                    const trim =
                      model?.trims.find((candidate) => candidate.id === entry.trimId)?.name ??
                      'همهٔ تیپ‌ها';
                    return (
                      <span
                        className="pc-compat-chip"
                        key={`${entry.modelId}-${entry.trimId}-${index}`}
                      >
                        <b>
                          {model?.make} {model?.name}
                        </b>
                        <small>{trim}</small>
                        <button
                          type="button"
                          className="pc-compat-x"
                          onClick={() =>
                            setCompat((current) => current.filter((_, i) => i !== index))
                          }
                          aria-label="حذف خودرو"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="pc-section">
              <h3>جزئیات و سئو</h3>
              <div className="pc-grid">
                <label className="pc-s3">
                  شماره فنی
                  <input
                    dir="ltr"
                    value={basic.partNumber}
                    onChange={(event) => setBasic({ ...basic, partNumber: event.target.value })}
                    placeholder="Part Number"
                  />
                </label>
                <label className="pc-s3">
                  وضعیت
                  <select
                    value={basic.status}
                    onChange={(event) => setBasic({ ...basic, status: event.target.value })}
                  >
                    <option value="active">فعال</option>
                    <option value="hidden">مخفی</option>
                  </select>
                </label>
                <label className="pc-s3">
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
                {items.length === 1 && (
                  <label className="pc-s3">
                    بارکد (خالی = خودکار)
                    <input
                      dir="ltr"
                      value={items[0].barcode}
                      onChange={(event) => updateItem(0, { barcode: event.target.value })}
                      placeholder="EAN-13"
                    />
                  </label>
                )}
                {items.length === 1 && (
                  <label className="pc-s3">
                    آستانهٔ هشدار موجودی
                    <FaNumberInput
                      group={false}
                      value={items[0].minStock}
                      onChange={(plain) => updateItem(0, { minStock: plain })}
                      placeholder="مثلاً ۳"
                    />
                  </label>
                )}
                <label className="pc-s6">
                  توضیحات
                  <textarea
                    value={basic.description}
                    onChange={(event) => setBasic({ ...basic, description: event.target.value })}
                    placeholder="توضیح واقعی و کاربردی قطعه"
                    rows={2}
                  />
                </label>
                <label className="pc-s4">
                  عنوان سئو
                  <input
                    value={basic.seoTitle}
                    onChange={(event) => setBasic({ ...basic, seoTitle: event.target.value })}
                    placeholder="خالی = تولید خودکار"
                  />
                </label>
                <label className="pc-s4">
                  توضیح سئو
                  <input
                    value={basic.seoDescription}
                    onChange={(event) => setBasic({ ...basic, seoDescription: event.target.value })}
                    placeholder="خالی = تولید خودکار"
                  />
                </label>
                <label className="pc-s4">
                  کلیدواژه‌ها
                  <input
                    value={basic.seoKeywords}
                    onChange={(event) => setBasic({ ...basic, seoKeywords: event.target.value })}
                    placeholder="لنت، ترمز، پژو ۲۰۶"
                  />
                </label>
              </div>
            </section>
            </div>
          </details>
        </div>

        <footer className="editor-footer pc-footer">
          <span className="pc-footer-note">🔒 قیمت خرید فقط داخلی است و در سایت نمایش داده نمی‌شود.</span>
          <div className="pc-footer-actions">
            <button className="button-primary" disabled={busy} onClick={() => void submit()}>
              {busy ? 'در حال ثبت…' : 'ثبت محصول'}
            </button>
            <button className="outline" disabled={busy} onClick={onClose}>
              انصراف
            </button>
          </div>
        </footer>
      </div>

      <MediaPicker
        open={pickerOpen}
        title="انتخاب تصویر محصول از رسانه‌ها"
        onClose={() => setPickerOpen(false)}
        onSelect={(image) => {
          setSelectedImages((current) =>
            current.some((entry) => entry.id === image.id) ? current : [...current, image],
          );
          setImageFiles([]);
          setImageUrl('');
        }}
      />
    </div>
  );
}
