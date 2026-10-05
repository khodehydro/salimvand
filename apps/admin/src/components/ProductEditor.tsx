import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createEan13, formatJalaliDate } from '@salimvand/shared';
import type {
  Brand,
  Category,
  Location,
  ProductDetail,
  Supplier,
  VehicleMake,
} from '../lib/catalog-types';
import { FaNumberInput } from './FaNumberInput';
import { StockStepper } from './StockStepper';
import { basketLabel, locationLabel } from '../lib/location-label';
import { api } from '../lib/api';
import { MediaPicker, type PickerItem } from './MediaPicker';
import { MediaImage } from './MediaImage';

/**
 * Product editor dialog — one floating window over the list (never an inline
 * block at the end of the page: the reported «پنجرهٔ ویرایش پایین لیست است و
 * باید اسکرول کنیم» bug). Head + tabs stay put, the body scrolls, and every
 * save action lives in the pinned header so it is always reachable.
 */

const tabs = [
  { id: 'basic', label: 'پایه و سئو' },
  { id: 'images', label: 'تصاویر' },
  { id: 'aparat', label: 'ویدیوی آپارات' },
  { id: 'vehicles', label: 'سازگاری خودرو' },
  { id: 'items', label: 'قلم‌ها، قیمت و موجودی' },
] as const;
export type ProductEditorTab = (typeof tabs)[number]['id'];

const aparatEmbed = (videoId: string) =>
  `https://www.aparat.com/video/video/embed/videohash/${videoId}/vt/frame`;

export type EditorProps = {
  product: ProductDetail;
  tab: ProductEditorTab;
  setTab: (tab: ProductEditorTab) => void;
  onClose: () => void;
  onMessage: (text: string) => void;
  onRefresh: () => void;
  categories: Category[];
  brands: Brand[];
  suppliers: Supplier[];
  locations: Location[];
  vehicles: VehicleMake[];
  /** Managers may edit the product itself; warehouse operators only its stock lines. */
  canEditProductFields?: boolean;
};

export function ProductEditor({
  product,
  tab,
  setTab,
  onClose,
  onMessage,
  onRefresh,
  categories,
  brands,
  suppliers,
  locations: initialLocations,
  vehicles,
  canEditProductFields = true,
}: EditorProps) {
  const [locations, setLocations] = useState<Location[]>(initialLocations);
  // A warehouse operator opens the editor straight on the stock lines: the
  // product tabs (سئو، تصاویر، سازگاری) would 403 on save for them.
  const visibleTabs = canEditProductFields ? tabs : tabs.filter((entry) => entry.id === 'items');
  useEffect(() => {
    if (!canEditProductFields && tab !== 'items') setTab('items');
  }, [canEditProductFields, tab, setTab]);
  useEffect(() => {
    setLocations(initialLocations);
  }, [initialLocations]);
  useEffect(() => {
    if (initialLocations.length === 0) {
      void api<{ data: Location[] }>('/locations')
        .then((result) =>
          setLocations(
            [...result.data].sort(
              (a, b) =>
                Number(b.type === 'warehouse') - Number(a.type === 'warehouse') ||
                a.code.localeCompare(b.code, 'en', { numeric: true }),
            ),
          ),
        )
        .catch(() => undefined);
    }
  }, [initialLocations.length]);
  const [basic, setBasic] = useState({
    name: product.name,
    categoryId: product.category?.id ?? '',
    description: product.description ?? '',
    partNumber: product.partNumber ?? '',
    status: product.status,
    priceDisplay: product.priceDisplay ?? 'inherit',
    seoTitle: product.seoTitle ?? '',
    seoDescription: product.seoDescription ?? '',
    seoKeywords: (product.seoKeywords ?? []).join('، '),
  });
  const [aparatId, setAparatId] = useState(product.aparatVideoId ?? '');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [compat, setCompat] = useState<Array<{ modelId: string; trimId: string }>>(
    (product.compatibilities ?? []).map((entry) => ({
      modelId: entry.model.id,
      trimId: entry.trim?.id ?? '',
    })),
  );
  const [pickModel, setPickModel] = useState('');
  const [pickTrim, setPickTrim] = useState('');
  const [item, setItem] = useState({
    brandId: '',
    supplierId: product.supplierId ?? product.supplier?.id ?? '',
    barcode: createEan13(String(Date.now()).slice(-9)),
    salePrice: '',
    purchasePrice: '',
    minStock: '',
    locationId: '',
    basketId: '',
    initialQuantity: '',
  });
  /** Inline edits for existing inventory items (price/minStock/shelf). */
  const [itemEdits, setItemEdits] = useState<
    Record<
      string,
      {
        salePrice: string;
        purchasePrice: string;
        minStock: string;
        supplierId: string;
        locationId: string;
        basketId: string;
      }
    >
  >({});
  const [busy, setBusy] = useState(false);
  /** Notices must render INSIDE the modal: the page-level message strip sits
   *  behind the backdrop and is invisible while the editor is open. */
  const [notice, setNotice] = useState('');
  const notify = (text: string) => {
    setNotice(text);
    onMessage(text);
  };

  const models = useMemo(
    () => vehicles.flatMap((make) => make.models.map((model) => ({ ...model, make: make.name }))),
    [vehicles],
  );
  const trims = useMemo(
    () =>
      vehicles.flatMap((make) => make.models).find((model) => model.id === pickModel)?.trims ?? [],
    [vehicles, pickModel],
  );
  // Placement tree in the editor: every location that is not a basket is a
  // shelf, and a basket may only be picked for the shelf it belongs to.
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

  // Saves report success so the header save button can close the editor
  // only when the change actually landed (failures keep it open + noticed).
  const patch = async (payload: Record<string, unknown>, success: string) => {
    setBusy(true);
    try {
      await api(`/products/${product.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify(success);
      onRefresh();
      return true;
    } catch (error) {
      notify((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveBasic = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!basic.name.trim() || !basic.categoryId) {
      notify('نام محصول و دسته‌بندی الزامی است.');
      return false;
    }
    return patch(
      {
        name: basic.name,
        categoryId: basic.categoryId,
        description: basic.description || null,
        partNumber: basic.partNumber || null,
        status: basic.status,
        priceDisplay: basic.priceDisplay,
        seoTitle: basic.seoTitle || null,
        seoDescription: basic.seoDescription || null,
      },
      'مشخصات و سئو ذخیره شد',
    );
  };

  const reorderImages = async (imageIds: string[]) => {
    try {
      await api(`/media/products/${product.id}/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({ imageIds }),
      });
      notify('ترتیب تصاویر ذخیره شد');
      onRefresh();
    } catch (error) {
      notify((error as Error).message);
    }
  };

  const upload = async () => {
    if (!mediaFile) {
      notify('ابتدا یک فایل انتخاب کنید');
      return false;
    }
    setBusy(true);
    try {
      const data = new FormData();
      data.append('file', mediaFile);
      await api(`/media/products/${product.id}/upload`, { method: 'POST', body: data });
      setMediaFile(null);
      notify('تصویر آپلود شد');
      onRefresh();
      return true;
    } catch (error) {
      notify((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveCompat = async () => {
    setBusy(true);
    try {
      await api(`/products/${product.id}/compat`, {
        method: 'PUT',
        body: JSON.stringify({
          vehicles: compat.map((entry) => ({
            modelId: entry.modelId,
            trimId: entry.trimId || null,
          })),
        }),
      });
      notify('سازگاری خودرو ذخیره شد');
      onRefresh();
      return true;
    } catch (error) {
      notify((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createItem = async () => {
    if (!item.brandId) {
      notify('برند قلم را انتخاب کنید');
      return false;
    }
    setBusy(true);
    try {
      await api('/inventory/items', {
        method: 'POST',
        body: JSON.stringify({
          productId: product.id,
          brandId: item.brandId,
          supplierId: item.supplierId || undefined,
          barcode: item.barcode,
          salePrice: Number(item.salePrice) || 0,
          purchasePrice: Number(item.purchasePrice) || 0,
          minStock: item.minStock ? Number(item.minStock) : undefined,
          locationId: item.locationId || undefined,
          basketId: item.basketId || undefined,
          initialQuantity: item.initialQuantity ? Number(item.initialQuantity) : 0,
        }),
      });
      notify('قلم برند با بارکد ثبت شد');
      setItem({
        ...item,
        brandId: '',
        barcode: createEan13(String(Date.now()).slice(-9)),
        salePrice: '',
        purchasePrice: '',
        initialQuantity: '',
      });
      onRefresh();
      return true;
    } catch (error) {
      notify((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveItemEdit = async (itemId: string) => {
    const edit = itemEdits[itemId];
    if (!edit) return true;
    setBusy(true);
    try {
      await api(`/inventory/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          salePrice: Number(edit.salePrice) || 0,
          purchasePrice: Number(edit.purchasePrice) || 0,
          minStock: edit.minStock === '' ? null : Number(edit.minStock),
          supplierId: edit.supplierId || null,
          locationId: edit.locationId || null,
          basketId: edit.basketId || null,
        }),
      });
      setItemEdits((current) => {
        const next = { ...current };
        delete next[itemId];
        return next;
      });
      notify('قلم انبار ذخیره شد');
      onRefresh();
      return true;
    } catch (error) {
      notify((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const itemEditFor = (entry: NonNullable<ProductDetail['inventoryItems']>[number]) =>
    itemEdits[entry.id] ?? {
      salePrice: String(entry.salePrice),
      purchasePrice: String(entry.purchasePrice),
      minStock: entry.minStock == null ? '' : String(entry.minStock),
      supplierId: entry.supplierId ?? entry.supplier?.id ?? '',
      locationId: entry.location?.id ?? '',
      basketId: entry.basket?.id ?? '',
    };
  const setItemEdit = (
    entry: NonNullable<ProductDetail['inventoryItems']>[number],
    changes: Partial<{
      salePrice: string;
      purchasePrice: string;
      minStock: string;
      supplierId: string;
      locationId: string;
      basketId: string;
    }>,
  ) =>
    setItemEdits((current) => ({
      ...current,
      [entry.id]: { ...itemEditFor(entry), ...changes },
    }));

  // The header save: each tab maps to its own save action, so the button
  // never scrolls away while the operator switches tabs.
  const saveActiveTab = async (): Promise<boolean> => {
    if (tab === 'basic') return saveBasic();
    if (tab === 'images') return upload();
    if (tab === 'aparat')
      return patch(
        { aparatVideoId: aparatId || null },
        aparatId ? 'ویدیوی آپارات ذخیره شد' : 'ویدیوی آپارات حذف شد',
      );
    if (tab === 'vehicles') return saveCompat();
    return saveItemsTab();
  };
  /** Header save-and-close: the editor only closes when the active tab's
   *  save succeeded — a failure keeps it open with the error notice. */
  const saveAndClose = async () => {
    if (await saveActiveTab()) onClose();
  };
  /** The items-tab footer button saves everything on the tab: pending row
   *  edits first, then the new-item form when a brand was selected. */
  const saveItemsTab = async () => {
    const dirtyIds = Object.keys(itemEdits);
    let saved = true;
    for (const itemId of dirtyIds) saved = (await saveItemEdit(itemId)) && saved;
    if (item.brandId) saved = (await createItem()) && saved;
    if (!dirtyIds.length && !item.brandId) {
      notify('تغییری برای ذخیره نیست؛ برای افزودن قلم، برند را انتخاب کنید.');
      return false;
    }
    return saved;
  };
  const footerLabel: Record<ProductEditorTab, string> = {
    basic: 'ذخیرهٔ پایه و سئو',
    images: 'بارگذاری تصویر انتخاب‌شده',
    aparat: 'ذخیرهٔ ویدیو',
    vehicles: 'ذخیرهٔ سازگاری',
    items: 'ذخیرهٔ تغییرات اقلام',
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="editor"
        role="dialog"
        aria-modal="true"
        aria-label={`ویرایش ${product.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="editor-head">
          <h2>
            {product.name} <code dir="ltr">{product.code}</code>
          </h2>
          <div className="editor-head-actions">
            {(canEditProductFields || tab === 'items') && (
              <button
                type="button"
                className="button-primary editor-save"
                disabled={busy}
                title={footerLabel[tab]}
                onClick={() => void saveAndClose()}
              >
                {busy ? 'در حال ذخیره…' : '✓ ذخیره'}
              </button>
            )}
            <button className="close" onClick={onClose} aria-label="بستن">
              ✕
            </button>
          </div>
        </div>
        {notice && (
          <div className="notice modal-notice" role="status">
            {notice}
            <button
              type="button"
              className="search-clear"
              aria-label="بستن پیام"
              onClick={() => setNotice('')}
            >
              ✕
            </button>
          </div>
        )}
        <div className="tabs" role="tablist">
          {visibleTabs.map((entry) => (
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
          {product.partial && <div className="notice">در حال دریافت کامل اطلاعات محصول…</div>}
          {tab === 'basic' && (
            <form
              className="product-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveAndClose();
              }}
            >
              <label>
                نام
                <input
                  required
                  value={basic.name}
                  onChange={(event) => setBasic({ ...basic, name: event.target.value })}
                />
              </label>
              <label>
                دسته‌بندی
                <select
                  required
                  value={basic.categoryId}
                  onChange={(event) => setBasic({ ...basic, categoryId: event.target.value })}
                >
                  <option value="">انتخاب</option>
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
                <textarea
                  rows={4}
                  value={basic.description}
                  onChange={(event) => setBasic({ ...basic, description: event.target.value })}
                  placeholder="توضیحات محصول را وارد کنید"
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
                  readOnly
                  title="کلیدواژه‌ها خودکار از نام محصول و خودروهای سازگار ساخته می‌شوند"
                  placeholder="پس از ذخیره خودکار تولید می‌شود"
                />
                <small className="field-hint">
                  تک‌واژه‌ها و ترکیب‌های دوکلمه‌ای، سه‌کلمه‌ای و بیشتر به‌صورت خودکار ساخته می‌شوند.
                </small>
              </label>
            </form>
          )}

          {tab === 'images' && (
            <div>
              <p className="media-reorder-hint">
                برای تغییر ترتیب، تصویر را بگیرید و روی تصویر مقصد رها کنید. تصویر اصلی در سایت و
                پیش‌نمایش لینک نمایش داده می‌شود.
              </p>
              <div className="image-grid">
                {(product.images ?? []).map((image) => (
                  <div
                    className="image-item"
                    key={image.id}
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData('text/plain', image.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const draggedId = event.dataTransfer.getData('text/plain');
                      const current = [...(product.images ?? [])];
                      const from = current.findIndex((entry) => entry.id === draggedId);
                      const to = current.findIndex((entry) => entry.id === image.id);
                      if (from < 0 || to < 0 || from === to) return;
                      const [moved] = current.splice(from, 1);
                      current.splice(to, 0, moved);
                      void reorderImages(current.map((entry) => entry.id));
                    }}
                  >
                    <MediaImage src={image.path} alt={image.alt ?? product.name} />
                    <small>{image.isPrimary ? 'تصویر اصلی' : (image.alt ?? 'بدون Alt')}</small>
                    <button
                      onClick={() =>
                        void api(`/media/products/${product.id}/${image.id}/primary`, {
                          method: 'PATCH',
                        }).then(() => {
                          notify('تصویر اصلی تغییر کرد');
                          onRefresh();
                        })
                      }
                    >
                      اصلی
                    </button>
                    <button
                      className="danger"
                      onClick={() =>
                        void api(`/media/products/${product.id}/${image.id}`, {
                          method: 'DELETE',
                        }).then(() => {
                          notify('تصویر حذف شد');
                          onRefresh();
                        })
                      }
                    >
                      حذف
                    </button>
                  </div>
                ))}
                {!(product.images ?? []).length && (
                  <p className="muted">هنوز تصویری بارگذاری نشده است.</p>
                )}
              </div>
              <div className="editor-actions">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => setMediaFile(event.target.files?.[0] ?? null)}
                />
                <input
                  dir="ltr"
                  value={mediaUrl}
                  onChange={(event) => setMediaUrl(event.target.value)}
                  placeholder="https://…"
                />
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (!mediaUrl) return notify('نشانی تصویر را وارد کنید');
                    try {
                      await api(`/media/products/${product.id}/url`, {
                        method: 'POST',
                        body: JSON.stringify({ url: mediaUrl, alt: product.name }),
                      });
                      setMediaUrl('');
                      notify('تصویر از نشانی افزوده شد');
                      onRefresh();
                    } catch (error) {
                      notify((error as Error).message);
                    }
                  }}
                >
                  افزودن از نشانی
                </button>
                <button
                  type="button"
                  className="outline"
                  disabled={busy}
                  onClick={() => setMediaPickerOpen(true)}
                >
                  انتخاب از رسانه‌های موجود
                </button>
              </div>
              <p className="muted">
                تصاویر با همان نشانی در سایت و فاکتور استفاده می‌شوند؛ Alt خالی برای دسترسی‌پذیری و
                سئو توصیه نمی‌شود.
              </p>
              <MediaPicker
                open={mediaPickerOpen}
                title={`انتخاب تصویر برای ${product.name}`}
                onClose={() => setMediaPickerOpen(false)}
                onSelect={async (item: PickerItem) => {
                  if (item.kind === 'site') return notify('رسانه‌های سایت به محصول متصل نمی‌شوند.');
                  try {
                    await api(`/media/products/${product.id}/select`, {
                      method: 'POST',
                      body: JSON.stringify({ imageId: item.id, alt: item.alt ?? product.name }),
                    });
                    notify('تصویر از کتابخانه افزوده شد');
                    onRefresh();
                  } catch (error) {
                    notify((error as Error).message);
                  }
                }}
              />
            </div>
          )}

          {tab === 'aparat' && (
            <div className="form-grid">
              <label>
                شناسهٔ ویدیوی آپارات
                <input
                  dir="ltr"
                  value={aparatId}
                  onChange={(event) => setAparatId(event.target.value)}
                  placeholder="مثلاً a1b2c3d4"
                />
              </label>
              {aparatId && (
                <iframe
                  title="پیش‌نمایش ویدیو"
                  className="aparat-frame"
                  src={aparatEmbed(aparatId)}
                  allowFullScreen
                />
              )}
              <p className="muted">
                فقط شناسهٔ ویدیو ذخیره می‌شود؛ پخش در سایت عمومی با iframe همان شناسه انجام می‌شود و
                فایلی آپلود نمی‌گردد.
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
                          {vehicles
                            .flatMap((make) => make.models)
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
                    هیچ خودرویی ثبت نشده؛ این محصول در فیلتر خودروهای سایت نمایش داده نمی‌شود.
                  </p>
                )}
              </div>
            </div>
          )}

          {tab === 'items' && (
            <div>
              <h3 className="list-subhead">قلم‌های ثبت‌شدهٔ این محصول</h3>
              <div className="item-edit-list">
                {(product.inventoryItems ?? []).map((entry) => {
                  const edit = itemEditFor(entry);
                  const dirty = Boolean(itemEdits[entry.id]);
                  return (
                    <div className="item-edit-row" key={entry.id}>
                      <div className="ier-head">
                        <b>{entry.brand?.name ?? 'بدون برند'}</b>
                        <code dir="ltr">{entry.barcode}</code>
                        <StockStepper
                          itemId={entry.id}
                          quantity={entry.quantity}
                          onMessage={notify}
                          onSaved={onRefresh}
                        />
                      </div>
                      <div className="ier-fields">
                        <label>
                          قیمت فروش
                          <FaNumberInput
                            value={edit.salePrice}
                            onChange={(plain) => setItemEdit(entry, { salePrice: plain })}
                          />
                          {entry.priceUpdatedAt && (
                            <small className="ier-price-date">
                              قیمت فعلی از {formatJalaliDate(entry.priceUpdatedAt)}
                            </small>
                          )}
                        </label>
                        <label>
                          قیمت خرید
                          <FaNumberInput
                            value={edit.purchasePrice}
                            onChange={(plain) => setItemEdit(entry, { purchasePrice: plain })}
                          />
                        </label>
                        <label>
                          آستانهٔ هشدار
                          <FaNumberInput
                            group={false}
                            value={edit.minStock}
                            onChange={(plain) => setItemEdit(entry, { minStock: plain })}
                          />
                        </label>
                        <label>
                          تأمین‌کننده
                          <select
                            value={edit.supplierId}
                            onChange={(event) =>
                              setItemEdit(entry, { supplierId: event.target.value })
                            }
                          >
                            <option value="">بدون تأمین‌کننده</option>
                            {suppliers.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          قفسه
                          <select
                            value={edit.locationId}
                            onChange={(event) =>
                              setItemEdit(entry, {
                                locationId: event.target.value,
                                basketId: '',
                              })
                            }
                          >
                            <option value="">بدون قفسه</option>
                            {shelves.length ? (
                              shelves.map((location) => (
                                <option value={location.id} key={location.id}>
                                  {locationLabel(location)}
                                </option>
                              ))
                            ) : (
                              <option disabled>در حال بارگذاری قفسه‌ها...</option>
                            )}
                          </select>
                          {!shelves.length && (
                            <small className="muted">
                              قفسه‌ای یافت نشد — از دکمهٔ «قفسه‌ها و سبدها» در نوار بالای همین لیست،
                              قفسه بسازید
                            </small>
                          )}
                        </label>
                        <label>
                          سبد (اختیاری)
                          <select
                            value={edit.basketId}
                            disabled={!edit.locationId}
                            onChange={(event) =>
                              setItemEdit(entry, { basketId: event.target.value })
                            }
                          >
                            <option value="">بدون سبد (روی قفسه)</option>
                            {basketsOf(edit.locationId).map((basket) => (
                              <option value={basket.id} key={basket.id}>
                                {basketLabel(basket)}
                              </option>
                            ))}
                          </select>
                          {edit.locationId && basketsOf(edit.locationId).length === 0 && (
                            <small className="muted">
                              این قفسه سبدی ندارد — از دکمهٔ «قفسه‌ها و سبدها» در نوار بالای همین
                              لیست اضافه کنید
                            </small>
                          )}
                        </label>
                        <button
                          className={dirty ? 'button-primary' : 'outline'}
                          disabled={busy}
                          onClick={() => void saveItemEdit(entry.id)}
                        >
                          {dirty ? 'ذخیره' : 'بدون تغییر'}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {!(product.inventoryItems ?? []).length && (
                  <p className="muted">هنوز قلمی برای این محصول ثبت نشده است.</p>
                )}
              </div>

              <h3 className="list-subhead">افزودن قلم جدید (برند/بارکد)</h3>
              <div className="form-grid">
                <label>
                  برند
                  <select
                    value={item.brandId}
                    onChange={(event) => setItem({ ...item, brandId: event.target.value })}
                  >
                    <option value="">انتخاب برند</option>
                    {brands.map((brand) => (
                      <option value={brand.id} key={brand.id}>
                        {brand.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  تأمین‌کننده
                  <select
                    value={item.supplierId}
                    onChange={(event) => setItem({ ...item, supplierId: event.target.value })}
                  >
                    <option value="">انتخاب تأمین‌کننده (اختیاری)</option>
                    {suppliers.map((s) => (
                      <option value={s.id} key={s.id}>
                        {s.name}
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
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setItem({
                      ...item,
                      barcode: createEan13(
                        `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-9),
                      ),
                    })
                  }
                >
                  تولید بارکد
                </button>
                <label>
                  قیمت فروش (ریال)
                  <FaNumberInput
                    value={item.salePrice}
                    onChange={(plain) => setItem({ ...item, salePrice: plain })}
                  />
                </label>
                <label>
                  قیمت خرید (ریال)
                  <FaNumberInput
                    value={item.purchasePrice}
                    onChange={(plain) => setItem({ ...item, purchasePrice: plain })}
                  />
                </label>
                <label>
                  آستانهٔ هشدار
                  <FaNumberInput
                    group={false}
                    value={item.minStock}
                    onChange={(plain) => setItem({ ...item, minStock: plain })}
                  />
                </label>
                <label>
                  قفسه
                  <select
                    value={item.locationId}
                    onChange={(event) =>
                      setItem({ ...item, locationId: event.target.value, basketId: '' })
                    }
                  >
                    <option value="">بدون قفسه</option>
                    {shelves.length ? (
                      shelves.map((location) => (
                        <option value={location.id} key={location.id}>
                          {locationLabel(location)}
                        </option>
                      ))
                    ) : (
                      <option disabled>در حال بارگذاری قفسه‌ها...</option>
                    )}
                  </select>
                  {!shelves.length && (
                    <small className="muted">
                      قفسه‌ای یافت نشد — از دکمهٔ «قفسه‌ها و سبدها» در نوار بالای همین لیست، قفسه
                      بسازید
                    </small>
                  )}
                </label>
                <label>
                  سبد (اختیاری)
                  <select
                    value={item.basketId}
                    disabled={!item.locationId}
                    onChange={(event) => setItem({ ...item, basketId: event.target.value })}
                  >
                    <option value="">بدون سبد (روی قفسه)</option>
                    {basketsOf(item.locationId).map((basket) => (
                      <option value={basket.id} key={basket.id}>
                        {basketLabel(basket)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  موجودی اولیه
                  <FaNumberInput
                    group={false}
                    value={item.initialQuantity}
                    onChange={(plain) => setItem({ ...item, initialQuantity: plain })}
                  />
                </label>
              </div>
              <p className="muted">
                قیمت خرید هرگز در سایت عمومی یا فاکتور مشتری نمایش داده نمی‌شود.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
