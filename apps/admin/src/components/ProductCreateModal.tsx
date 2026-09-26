import { useEffect, useMemo, useRef, useState } from 'react';
import { createEan13, formatPersianNumber } from '@salimvand/shared';
import { FaNumberInput } from './FaNumberInput';
import { basketLabel, locationLabel } from '../lib/location-label';
import { api } from '../lib/api';
import { MediaImage } from './MediaImage';
import { MediaPicker, type PickerItem } from './MediaPicker';

/**
 * Unified product registration window: catalog entry, inventory item and
 * vehicle compatibility are filled in one place and saved once — registering
 * a product in the warehouse IS registering it in the catalog IS publishing
 * it to the website.
 *
 * Redesigned layout (pc-* classes, owned by this file only):
 *  - calm single-page flow: numbered cards instead of the old fake step bar;
 *  - SEO fields folded into a collapsible <details> so the required fields
 *    own the visual focus;
 *  - wide screens get a sticky «خلاصهٔ ثبت» aside: live identity preview +
 *    completion checklist derived from the same form state (display only —
 *    no extra submit logic);
 *  - the save bar stays pinned in the footer in both modal and inline modes.
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
  basketId: '',
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
  const [basic, setBasic] = useState(emptyBasic);
  const [items, setItems] = useState([emptyItem]);
  const updateItem = (index: number, patch: Partial<typeof emptyItem>) =>
    setItems((current) =>
      current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );
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

  // Display-only derivations for the live summary aside + footer status pill.
  const validImageUrlList = imageUrlList.filter((url) => /^https:\/\//i.test(url));
  const imageCount = imageFiles.length + selectedImages.length + validImageUrlList.length;
  const activeItems = items.filter((entry) => entry.brandId);
  const hasBasic = Boolean(basic.name.trim() && basic.categoryId);
  const categoryName = categories.find((category) => category.id === basic.categoryId)?.name ?? '';

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

  const summaryThumb =
    filePreviews[0]?.url ?? selectedImages[0]?.path ?? validImageUrlList[0] ?? '';

  if (!open) return null;

  const reset = () => {
    setBasic(emptyBasic);
    setItems([{ ...emptyItem, barcode: '' }]);
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
          inventoryBrandIds: items.map((entry) => entry.brandId).filter(Boolean),
        }),
      });
      const productId = created.data.id;
      stage = 'تصویر محصول';
      for (const url of imageUrl
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean)) {
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
      stage = 'قلم انبار';
      // 2) Inventory item — brand, prices and the opening stock, all optional
      //    but filled in the same window so the flow is not split.
      const filledItems = items.filter((entry) => entry.brandId);
      for (const [index, item] of filledItems.entries()) {
        await api('/inventory/items', {
          method: 'POST',
          body: JSON.stringify({
            productId,
            brandId: item.brandId,
            barcode: item.barcode || createEan13(`${Date.now()}${index}`.slice(-9)),
            purchasePrice: Number(item.purchasePrice) || 0,
            salePrice: Number(item.salePrice) || 0,
            minStock: item.minStock ? Number(item.minStock) : undefined,
            locationId: item.locationId || undefined,
            basketId: item.basketId || undefined,
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
        `محصول «${created.data.name}» ثبت شد${items.some((entry) => entry.brandId) ? ` — ${items.filter((entry) => entry.brandId).length} قلم انبار ایجاد گردید` : ''} و روی سایت نمایش داده می‌شود.`,
      );
      reset();
      onClose();
    } catch (e) {
      const base = (e as Error).message;
      setError(
        stage === 'قلم انبار' && items.some((entry) => entry.brandId)
          ? `محصول ثبت شد اما ثبت ${stage} ناموفق بود: ${base} — پنجره را نبندید و دوباره ذخیره نکنید؛ محصول را از لیست ویرایش کنید.`
          : stage !== 'قلم انبار' && compat.length
            ? `محصول و قلم انبار ثبت شد اما ثبت ${stage} ناموفق بود: ${base} — از ویرایشگر محصول کامل کنید.`
            : base,
      );
    } finally {
      setBusy(false);
    }
  };

  const footerStats = [
    imageCount ? `${formatPersianNumber(imageCount)} تصویر` : '',
    activeItems.length ? `${formatPersianNumber(activeItems.length)} قلم انبار` : '',
    compat.length ? `${formatPersianNumber(compat.length)} خودرو` : '',
  ].filter(Boolean);

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
            <p>یک بار ذخیره می‌کنید؛ محصول هم‌زمان در انبار، کاتالوگ و سایت ثبت می‌شود.</p>
          </div>
          <span className="pc-head-badge">ثبت یکجا</span>
          <button className="close" onClick={onClose} aria-label="بستن">
            ✕
          </button>
        </header>

        <div className="editor-body pc-body">
          <div className="pc-workspace">
            <div className="pc-main">
              {/* ── ۱ · مشخصات محصول ─────────────────────────── */}
              <section className="pc-section">
                <div className="pc-section-head">
                  <span className="pc-step-n" aria-hidden="true">
                    ۱
                  </span>
                  <div>
                    <h3>مشخصات محصول</h3>
                    <p>نام و دسته‌بندی الزامی‌اند؛ سایر فیلدها اختیاری‌اند.</p>
                  </div>
                </div>
                <div className="pc-grid">
                  <label className="pc-s6 pc-field-name is-req">
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
                  <label className="pc-s6">
                    توضیحات
                    <input
                      value={basic.description}
                      onChange={(event) => setBasic({ ...basic, description: event.target.value })}
                      placeholder="توضیح واقعی و کاربردی قطعه"
                    />
                  </label>
                </div>

                <details className="pc-seo">
                  <summary>
                    <span className="pc-seo-title">تنظیمات سئو</span>
                    <small>اختیاری — خالی بماند تا خودکار ساخته شود</small>
                  </summary>
                  <div className="pc-seo-body pc-grid">
                    <label className="pc-s3">
                      عنوان سئو
                      <input
                        value={basic.seoTitle}
                        onChange={(event) => setBasic({ ...basic, seoTitle: event.target.value })}
                        placeholder="خالی = تولید خودکار"
                      />
                    </label>
                    <label className="pc-s3">
                      توضیح سئو
                      <input
                        value={basic.seoDescription}
                        onChange={(event) =>
                          setBasic({ ...basic, seoDescription: event.target.value })
                        }
                        placeholder="خالی = تولید خودکار"
                      />
                    </label>
                    <label className="pc-s6">
                      کلیدواژه‌ها
                      <input
                        value={basic.seoKeywords}
                        onChange={(event) =>
                          setBasic({ ...basic, seoKeywords: event.target.value })
                        }
                        placeholder="لنت، ترمز، پژو ۲۰۶"
                      />
                    </label>
                  </div>
                </details>
              </section>

              {/* ── ۲ · تصاویر محصول ─────────────────────────── */}
              <section className="pc-section">
                <div className="pc-section-head">
                  <span className="pc-step-n" aria-hidden="true">
                    ۲
                  </span>
                  <div>
                    <h3>تصاویر محصول</h3>
                    <p>اختیاری — با لینک، آپلود فایل یا انتخاب از کتابخانهٔ رسانه‌ها.</p>
                  </div>
                  {imageCount > 0 && (
                    <span className="pc-section-count">
                      {formatPersianNumber(imageCount)} تصویر
                    </span>
                  )}
                </div>
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
                <p className="pc-image-note">
                  هر بار یکی از سه روش فعال می‌شود؛ انتخاب روش تازه، تصاویر روش قبلی را پاک می‌کند.
                </p>
              </section>

              {/* ── ۳ · برندها و انبار ────────────────────────── */}
              <section className="pc-section">
                <div className="pc-section-head">
                  <span className="pc-step-n" aria-hidden="true">
                    ۳
                  </span>
                  <div>
                    <h3>برندها و انبار</h3>
                    <p>برای هر برند، قیمت، بارکد، قفسه، سبد و موجودی مستقل ثبت کنید.</p>
                  </div>
                  <span className="pc-section-count">{formatPersianNumber(items.length)} قلم</span>
                </div>
                <div className="pc-items">
                  {items.map((item, index) => {
                    const brandName =
                      brands.find((brand) => brand.id === item.brandId)?.name ?? 'بدون برند';
                    return (
                      <div className="pc-item" key={index}>
                        <div className="pc-item-head">
                          <b>قلم {formatPersianNumber(index + 1)}</b>
                          <span className="pc-item-brand">{brandName}</span>
                          {items.length > 1 && (
                            <button
                              type="button"
                              className="pc-item-remove"
                              onClick={() =>
                                setItems((current) => current.filter((_, i) => i !== index))
                              }
                            >
                              حذف قلم
                            </button>
                          )}
                        </div>
                        <div className="pc-grid">
                          <label className="pc-s2">
                            برند قطعه
                            <select
                              value={item.brandId}
                              onChange={(event) =>
                                updateItem(index, { brandId: event.target.value })
                              }
                            >
                              <option value="">بدون قلم انبار</option>
                              {brands.map((brand) => (
                                <option value={brand.id} key={brand.id}>
                                  {brand.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="pc-s2">
                            بارکد EAN-13
                            <input
                              dir="ltr"
                              value={item.barcode}
                              onChange={(event) =>
                                updateItem(index, { barcode: event.target.value })
                              }
                              placeholder="خالی = تولید خودکار"
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
                              onChange={(event) =>
                                updateItem(index, { basketId: event.target.value })
                              }
                            >
                              <option value="">بدون سبد (روی قفسه)</option>
                              {basketsOf(item.locationId).map((basket) => (
                                <option value={basket.id} key={basket.id}>
                                  {basketLabel(basket)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="pc-s2">
                            <span>
                              قیمت فروش (ریال) <small>اختیاری</small>
                            </span>
                            <FaNumberInput
                              value={item.salePrice}
                              onChange={(plain) => updateItem(index, { salePrice: plain })}
                            />
                          </label>
                          <label className="pc-s2">
                            <span>
                              قیمت خرید (ریال) <small>اختیاری</small>
                            </span>
                            <FaNumberInput
                              value={item.purchasePrice}
                              onChange={(plain) => updateItem(index, { purchasePrice: plain })}
                            />
                          </label>
                          <label className="pc-s1">
                            موجودی اولیه
                            <FaNumberInput
                              group={false}
                              value={item.initialQuantity}
                              onChange={(plain) => updateItem(index, { initialQuantity: plain })}
                              placeholder="۰"
                            />
                          </label>
                          <label className="pc-s1">
                            آستانهٔ هشدار
                            <FaNumberInput
                              group={false}
                              value={item.minStock}
                              onChange={(plain) => updateItem(index, { minStock: plain })}
                              placeholder="مثلاً ۳"
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="pc-item-add"
                    onClick={() => setItems((current) => [...current, { ...emptyItem }])}
                  >
                    ＋ افزودن برند دیگر
                  </button>
                </div>
                <p className="pc-item-note">
                  🔒 قیمت خرید فقط داخلی است و هرگز در سایت یا فاکتور مشتری نمایش داده نمی‌شود.
                </p>
              </section>

              {/* ── ۴ · خودروهای سازگار ───────────────────────── */}
              <section className="pc-section">
                <div className="pc-section-head">
                  <span className="pc-step-n" aria-hidden="true">
                    ۴
                  </span>
                  <div>
                    <h3>خودروهای سازگار</h3>
                    <p>برای دیده‌شدن در فیلتر خودروهای سایت، مدل‌های سازگار را اضافه کنید.</p>
                  </div>
                  {compat.length > 0 && (
                    <span className="pc-section-count">
                      {formatPersianNumber(compat.length)} خودرو
                    </span>
                  )}
                </div>
                <div className="pc-vehicle-picker">
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
                    className="outline"
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
                {compat.length ? (
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
                            aria-label="حذف سازگاری"
                            onClick={() =>
                              setCompat((current) => current.filter((_, i) => i !== index))
                            }
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <p className="pc-compat-empty">
                    اختیاری است؛ بدون خودروی سازگار، محصول در فیلتر خودروهای سایت نمایش داده
                    نمی‌شود.
                  </p>
                )}
              </section>
            </div>

            {/* ── خلاصهٔ ثبت (فقط نمایشی؛ از همان state فرم مشتق می‌شود) ── */}
            <aside className="pc-aside" aria-label="خلاصهٔ ثبت محصول">
              <div className="pc-aside-card">
                <h4>خلاصهٔ ثبت</h4>
                <div className="pc-id">
                  <span className="pc-id-thumb" aria-hidden="true">
                    {summaryThumb ? <img src={summaryThumb} alt="" /> : '📦'}
                  </span>
                  <div className="pc-id-meta">
                    <b>{basic.name.trim() || 'نام محصول…'}</b>
                    <span>{categoryName || 'بدون دسته‌بندی'}</span>
                  </div>
                </div>
                <ul className="pc-checklist">
                  <li className={hasBasic ? 'ok' : ''}>
                    <i aria-hidden="true" />
                    <span>نام و دسته‌بندی</span>
                    <b>{hasBasic ? 'آماده' : 'الزامی'}</b>
                  </li>
                  <li className={imageCount ? 'ok' : ''}>
                    <i aria-hidden="true" />
                    <span>تصاویر</span>
                    <b>{imageCount ? `${formatPersianNumber(imageCount)} تصویر` : 'اختیاری'}</b>
                  </li>
                  <li className={activeItems.length ? 'ok' : ''}>
                    <i aria-hidden="true" />
                    <span>اقلام انبار</span>
                    <b>
                      {activeItems.length
                        ? `${formatPersianNumber(activeItems.length)} قلم`
                        : 'اختیاری'}
                    </b>
                  </li>
                  <li className={compat.length ? 'ok' : ''}>
                    <i aria-hidden="true" />
                    <span>خودروهای سازگار</span>
                    <b>
                      {compat.length ? `${formatPersianNumber(compat.length)} خودرو` : 'اختیاری'}
                    </b>
                  </li>
                </ul>
                <p className="pc-aside-note">
                  با یک ذخیره، محصول در انبار ثبت و هم‌زمان در کاتالوگ و سایت منتشر می‌شود.
                </p>
              </div>
            </aside>
          </div>
        </div>

        {error && (
          <div className="pc-error" role="alert">
            {error}
          </div>
        )}

        <footer className="editor-footer pc-footer">
          <div className="pc-footer-status">
            {footerStats.length ? (
              footerStats.map((stat) => (
                <span className="pc-stat" key={stat}>
                  {stat}
                </span>
              ))
            ) : (
              <span className="pc-footer-hint">فقط «نام محصول» و «دسته‌بندی» الزامی‌اند.</span>
            )}
          </div>
          <div className="pc-footer-actions">
            <button type="button" className="outline" onClick={onClose} disabled={busy}>
              انصراف
            </button>
            <button
              type="button"
              className="button-primary"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? 'در حال ثبت…' : 'ثبت نهایی محصول'}
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
