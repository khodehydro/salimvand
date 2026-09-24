import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createEan13, formatJalaliDate, formatRial } from '@salimvand/shared';
import { FaNumberInput } from '../components/FaNumberInput';
import { locationChip, locationLabel } from '../lib/location-label';
import { api, downloadFile } from '../lib/api';
import { hashForPage } from '../lib/admin-route';
import { publicSiteUrl } from '../lib/public-site';
import { MediaPicker, type PickerItem } from '../components/MediaPicker';
import { MediaImage } from '../components/MediaImage';
import { StockStepper } from '../components/StockStepper';

type ProductRow = {
  id: string;
  name: string;
  code: string;
  slug: string;
  status: string;
  deletedAt?: string | null;
  partNumber?: string | null;
  seoKeywords?: string[];
  category?: { name: string };
  compatibilities?: Array<{ model: { name: string; make: { name: string } } }>;
  images?: Array<{ path: string; alt?: string | null; isPrimary: boolean }>;
  inventoryItems?: Array<{
    id: string;
    quantity: number;
    minStock?: number | null;
    salePrice: string;
    brand?: { name: string } | null;
    location?: { code: string; name: string } | null;
  }>;
};
type ProductDetail = {
  id: string;
  name: string;
  code: string;
  slug: string;
  status: string;
  /** Storefront price visibility: 'inherit' follows the site-wide switch. */
  priceDisplay?: string;
  description?: string | null;
  partNumber?: string | null;
  aparatVideoId?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoKeywords?: string[];
  category?: { id: string; name: string };
  images?: Array<{
    id: string;
    path: string;
    alt?: string | null;
    isPrimary: boolean;
    sort: number;
  }>;
  compatibilities?: Array<{
    id: string;
    model: { id: string; name: string; make: { id: string; name: string } };
    trim?: { id: string; name: string } | null;
  }>;
  inventoryItems?: Array<{
    id: string;
    barcode: string;
    quantity: number;
    salePrice: string;
    purchasePrice: string;
    minStock?: number | null;
    isActive: boolean;
    priceUpdatedAt?: string | null;
    brand?: { id: string; name: string } | null;
    location?: { id: string; code: string; name: string } | null;
  }>;
};
type Category = { id: string; name: string };
type Brand = { id: string; name: string };
type Location = {
  id: string;
  code: string;
  name: string;
  type: string;
  parent?: { name: string } | null;
};
type VehicleMake = {
  id: string;
  name: string;
  models: Array<{ id: string; name: string; trims: Array<{ id: string; name: string }> }>;
};

const tabs = [
  { id: 'basic', label: 'پایه و سئو' },
  { id: 'images', label: 'تصاویر' },
  { id: 'aparat', label: 'ویدیوی آپارات' },
  { id: 'vehicles', label: 'سازگاری خودرو' },
  { id: 'items', label: 'قلم‌ها، قیمت و موجودی' },
] as const;
type Tab = (typeof tabs)[number]['id'];

const aparatEmbed = (videoId: string) =>
  `https://www.aparat.com/video/video/embed/videohash/${videoId}/vt/frame`;

const totalStock = (product: ProductRow) =>
  product.inventoryItems?.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
const cheapestSalePrice = (product: ProductRow) => {
  const prices = (product.inventoryItems ?? []).map((item) => Number(item.salePrice));
  return prices.length ? Math.min(...prices) : null;
};

export function ProductsPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [vehicles, setVehicles] = useState<VehicleMake[]>([]);
  const [filter, setFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [keywordBusy, setKeywordBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<ProductDetail | null>(null);
  const [tab, setTab] = useState<Tab>('basic');

  const load = () =>
    api<{ data: ProductRow[] }>('/products')
      .then((result) => setProducts(result.data))
      .catch((error: Error) => setMessage(error.message));
  const refresh = async (id: string) => {
    const fresh = await api<{ data: ProductDetail }>(`/products/${id}`);
    // Update the open editor only: the header save closes the editor and a
    // refresh that was still in flight must never resurrect it.
    setDraft((current) => (current?.id === id ? fresh.data : current));
    await load();
    return fresh.data;
  };
  /** Opens the editor for a product — refresh() alone only updates an
   *  already-open draft, so every entry point (row button, deep link) must
   *  set the draft explicitly. */
  const openEditor = (id: string) =>
    void refresh(id).then((fresh) => {
      setTab('basic');
      setDraft(fresh);
    });

  // Deep link from the global palette (#/products?edit=<id>) opens the editor.
  useEffect(() => {
    const openFromHash = () => {
      const editId = paramsFromHash(window.location.hash).edit;
      if (editId) openEditor(editId);
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    void api<{ data: Category[] }>('/categories')
      .then((result) => setCategories(result.data))
      .catch(() => undefined);
    void api<{ data: Brand[] }>('/brands')
      .then((result) => setBrands(result.data))
      .catch(() => undefined);
    void api<{ data: Location[] }>('/locations')
      // Warehouses first, then shelves in numeric code order (۱.۱ … ۱۰.۱ … ۲۰.۷)
      // — mirrors the inventory page's ordering for the shelf pickers.
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
    void api<{ data: VehicleMake[] }>('/vehicles/tree')
      .then((result) => setVehicles(result.data))
      .catch(() => undefined);
  }, []);

  const visible = products.filter((product) => {
    const normalizedFilter = filter.trim().toLocaleLowerCase('fa');
    const queryMatch =
      `${product.name} ${product.code} ${product.partNumber ?? ''} ${(product.seoKeywords ?? []).join(' ')} ${
        product.compatibilities
          ?.map((entry) => `${entry.model.make.name} ${entry.model.name}`)
          .join(' ') ?? ''
      }`
        .toLocaleLowerCase('fa')
        .includes(normalizedFilter);
    const categoryMatch = !categoryFilter || product.category?.name === categoryFilter;
    const statusMatch = !statusFilter || product.status === statusFilter;
    const brandMatch =
      !brandFilter ||
      product.inventoryItems?.some((entry) => (entry.brand?.name ?? 'بدون برند') === brandFilter);
    const vehicleMatch =
      !vehicleFilter ||
      product.compatibilities?.some(
        (entry) => `${entry.model.make.name} ${entry.model.name}` === vehicleFilter,
      );
    return queryMatch && categoryMatch && statusMatch && brandMatch && vehicleMatch;
  });

  const vehicleOptions = [
    ...new Set(
      products.flatMap(
        (product) =>
          product.compatibilities?.map((entry) => `${entry.model.make.name} ${entry.model.name}`) ??
          [],
      ),
    ),
  ];

  return (
    <section className="products-page">
      <div className="page-title">
        <div>
          <h1>محصولات</h1>
          <p className="muted">
            کاتالوگ کامل با موجودی زندهٔ هر برند — ثبت محصول جدید از بخش «انبار و موجودی» انجام
            می‌شود.
          </p>
        </div>
        <div className="page-title-actions">
          <span className="count">{products.length} محصول</span>
          <button
            className="keyword-regenerate"
            disabled={keywordBusy}
            onClick={async () => {
              if (!window.confirm('کلیدواژه‌های همه محصولات بازسازی شود؟')) return;
              setKeywordBusy(true);
              try {
                await api('/products/seo-keywords/regenerate', { method: 'POST' });
                setMessage('کلیدواژه‌های محصولات بازسازی شد.');
                await load();
              } catch (error) {
                setMessage((error as Error).message);
              } finally {
                setKeywordBusy(false);
              }
            }}
          >
            {keywordBusy ? 'در حال ساخت…' : 'بازسازی کلیدواژه‌ها'}
          </button>
          <button
            className="products-backup-export"
            disabled={backupBusy}
            onClick={async () => {
              setBackupBusy(true);
              try {
                await downloadFile(
                  '/products/backup/export',
                  `salimvand-products-backup-${new Date().toISOString().slice(0, 10)}.zip`,
                );
              } catch (error) {
                setMessage((error as Error).message);
              } finally {
                setBackupBusy(false);
              }
            }}
          >
            {backupBusy ? 'در حال ساخت…' : 'پشتیبان‌گیری کامل (ZIP)'}
          </button>
          <button
            className="products-backup-restore"
            disabled={restoreBusy}
            onClick={() => restoreInputRef.current?.click()}
          >
            {restoreBusy ? 'در حال بازگردانی…' : 'بازگردانی از پشتیبان…'}
          </button>
          <input
            ref={restoreInputRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              if (
                !window.confirm(
                  'بازگردانی از فایل پشتیبان؟\nهیچ داده‌ای حذف نمی‌شود — محصولات موجود بر اساس کد به‌روزرسانی می‌شوند و محصولات غایب با همان کد قبلی دوباره ساخته می‌شوند.\nتصاویر موجود در فایل ZIP نیز در پوشهٔ آپلودها بازیابی می‌شوند.',
                )
              )
                return;
              setRestoreBusy(true);
              try {
                const form = new FormData();
                form.append('file', file);
                const result = await api<{
                  data: {
                    productsCreated: number;
                    productsUpdated: number;
                    itemsCreated: number;
                    itemsUpdated: number;
                    imagesWritten: number;
                    errors: string[];
                  };
                }>('/products/backup/import', { method: 'POST', body: form });
                const summary = result.data;
                const parts = [
                  `${summary.productsCreated.toLocaleString('fa-IR')} محصول جدید`,
                  `${summary.productsUpdated.toLocaleString('fa-IR')} محصول به‌روزرسانی‌شده`,
                  `${(summary.itemsCreated + summary.itemsUpdated).toLocaleString('fa-IR')} قلم انبار`,
                  `${summary.imagesWritten.toLocaleString('fa-IR')} تصویر`,
                ];
                setMessage(
                  `بازگردانی انجام شد — ${parts.join('، ')}` +
                    (summary.errors.length
                      ? ` (${summary.errors.length.toLocaleString('fa-IR')} خطا: ${summary.errors.slice(0, 3).join('؛ ')}${summary.errors.length > 3 ? '…' : ''})`
                      : ''),
                );
                await load();
              } catch (error) {
                setMessage((error as Error).message);
              } finally {
                setRestoreBusy(false);
              }
            }}
          />
        </div>
      </div>

      <div className="product-filter-toolbar">
        <div className="search-field product-search-field">
          <span className="search-icon">⌕</span>
          <input
            placeholder="جست‌وجوی نام، کد یا شماره فنی…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          {filter && (
            <button
              type="button"
              className="search-clear"
              onClick={() => setFilter('')}
              aria-label="پاک کردن جست‌وجو"
            >
              ✕
            </button>
          )}
        </div>
        <div className="toolbar-filter-row">
          <label
            className={`toolbar-pill${categoryFilter ? ' is-active' : ''}`}
            aria-label="فیلتر دسته‌بندی"
          >
            <span className="tp-lead" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
              </svg>
            </span>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              aria-label="فیلتر دسته‌بندی"
            >
              <option value="">همه دسته‌ها</option>
              {[...new Set(products.map((product) => product.category?.name).filter(Boolean))].map(
                (category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ),
              )}
            </select>
          </label>
          <label
            className={`toolbar-pill${brandFilter ? ' is-active' : ''}`}
            aria-label="فیلتر برند"
          >
            <span className="tp-lead" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="8" r="6" />
                <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
              </svg>
            </span>
            <select
              value={brandFilter}
              onChange={(event) => setBrandFilter(event.target.value)}
              aria-label="فیلتر برند"
            >
              <option value="">همه برندها</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.name}>
                  {brand.name}
                </option>
              ))}
            </select>
          </label>
          <label
            className={`toolbar-pill${vehicleFilter ? ' is-active' : ''}`}
            aria-label="فیلتر خودرو"
          >
            <span className="tp-lead" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
                <circle cx="7" cy="17" r="2" />
                <path d="M9 17h6" />
                <circle cx="17" cy="17" r="2" />
              </svg>
            </span>
            <select
              value={vehicleFilter}
              onChange={(event) => setVehicleFilter(event.target.value)}
              aria-label="فیلتر خودرو"
            >
              <option value="">همه خودروها</option>
              {vehicleOptions.map((vehicle) => (
                <option key={vehicle} value={vehicle}>
                  {vehicle}
                </option>
              ))}
            </select>
          </label>
          <div
            className={`toolbar-pill${statusFilter ? ' is-active' : ''}`}
            aria-label="فیلتر وضعیت"
          >
            <span className="tp-lead" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </span>
            <div className="tp-options" role="tablist" aria-label="وضعیت محصول">
              {(
                [
                  { id: '', label: 'همه' },
                  { id: 'active', label: 'فعال' },
                  { id: 'hidden', label: 'مخفی' },
                ] as const
              ).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={statusFilter === entry.id}
                  className={statusFilter === entry.id ? 'active' : ''}
                  onClick={() => setStatusFilter(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
          {(filter || categoryFilter || brandFilter || vehicleFilter || statusFilter) && (
            <button
              type="button"
              className="pill"
              onClick={() => {
                setFilter('');
                setCategoryFilter('');
                setBrandFilter('');
                setVehicleFilter('');
                setStatusFilter('');
              }}
            >
              × پاک کردن فیلترها
            </button>
          )}
        </div>
      </div>

      {message && <div className="notice">{message}</div>}

      <div className="product-list product-list-table">
        <div className="product-list-head" aria-hidden="true">
          <span>محصول</span>
          <span>وضعیت و دسته</span>
          <span>برندها و موجودی</span>
          <span>عملیات</span>
        </div>
        {visible.map((product) => (
          <article
            className={`product-list-card product-row${totalStock(product) === 0 ? ' is-out' : ''}`}
            key={product.id}
          >
            <div className="product-cell product-main-cell">
              <span className="product-thumb">
                {product.images?.[0] ? (
                  <MediaImage
                    src={product.images[0].path}
                    alt={product.images[0].alt ?? product.name}
                  />
                ) : (
                  <span>قطعه</span>
                )}
              </span>
              <div className="plc-info">
                <b>{product.name}</b>
                <small dir="ltr">
                  {product.code}
                  {product.partNumber ? ` · ${product.partNumber}` : ''}
                </small>
              </div>
            </div>
            <div className="product-cell product-status-cell">
              <div className="plc-chips">
                {product.category?.name && <span className="chip">{product.category.name}</span>}
                <button
                  type="button"
                  className={`catalog-switch ${product.status === 'active' ? 'on' : ''}`}
                  role="switch"
                  aria-checked={product.status === 'active'}
                  title="نمایش محصول برای کاربران عمومی سایت"
                  onClick={async () => {
                    try {
                      await api(`/products/${product.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({
                          status: product.status === 'active' ? 'hidden' : 'active',
                        }),
                      });
                      setMessage(
                        product.status === 'active'
                          ? 'نمایش محصول در سایت غیرفعال شد.'
                          : 'نمایش محصول در سایت فعال شد.',
                      );
                      await load();
                    } catch (error) {
                      setMessage((error as Error).message);
                    }
                  }}
                >
                  <span /> {product.status === 'active' ? 'نمایش در سایت' : 'مخفی از سایت'}
                </button>
                {vehicleOptions.length > 0 && product.compatibilities?.length ? (
                  <span className="chip vehicle-chip">
                    {product.compatibilities.length.toLocaleString('fa-IR')} خودرو
                  </span>
                ) : null}
              </div>
            </div>
            <div className="product-cell product-stock-cell">
              {product.inventoryItems?.length ? (
                product.inventoryItems.map((entry) => (
                  <div className="plc-brand" key={entry.id}>
                    <span
                      className="brand-name"
                      title={entry.location ? locationChip(entry.location) : undefined}
                    >
                      {entry.brand?.name ?? 'بدون برند'} · {formatRial(Number(entry.salePrice))}
                      {entry.location ? <small> · {locationChip(entry.location)}</small> : null}
                    </span>
                    <StockStepper
                      itemId={entry.id}
                      quantity={entry.quantity}
                      onMessage={setMessage}
                      onSaved={() => void load()}
                    />
                  </div>
                ))
              ) : (
                <span className="muted">قلم انباری ثبت نشده</span>
              )}
              <span className="plc-total">
                جمع قطعات: <b>{totalStock(product).toLocaleString('fa-IR')}</b>
              </span>
            </div>
            <div className="product-cell product-actions-cell">
              <button className="row-action" onClick={() => openEditor(product.id)}>
                ویرایش
              </button>
              <a
                className="row-action"
                href={`${publicSiteUrl}/product/${encodeURIComponent(product.slug)}`}
                target="_blank"
                rel="noreferrer"
              >
                سایت
              </a>
              <button
                className="row-action"
                title="ساخت برچسب برای این محصول"
                onClick={() => {
                  window.location.hash = hashForPage('labels', { product: product.id });
                }}
              >
                برچسب
              </button>
              <button
                className="row-action danger-text"
                onClick={async () => {
                  if (!window.confirm('محصول حذف نرم شود؟ از سایت پنهان می‌شود.')) return;
                  try {
                    await api(`/products/${product.id}`, { method: 'DELETE' });
                    setMessage('محصول حذف نرم شد.');
                    await load();
                  } catch (error) {
                    setMessage((error as Error).message);
                  }
                }}
              >
                حذف
              </button>
            </div>
          </article>
        ))}
        {!visible.length && <p className="muted">محصولی یافت نشد.</p>}
      </div>

      {draft && (
        <ProductEditor
          key={draft.id}
          product={draft}
          tab={tab}
          setTab={setTab}
          onClose={() => setDraft(null)}
          onMessage={setMessage}
          onRefresh={() => void refresh(draft.id)}
          categories={categories}
          brands={brands}
          locations={locations}
          vehicles={vehicles}
        />
      )}
    </section>
  );
}

function paramsFromHash(hash: string): Record<string, string> {
  const query = hash.split('?')[1] ?? '';
  return Object.fromEntries(new URLSearchParams(query));
}

type EditorProps = {
  product: ProductDetail;
  tab: Tab;
  setTab: (tab: Tab) => void;
  onClose: () => void;
  onMessage: (text: string) => void;
  onRefresh: () => void;
  categories: Category[];
  brands: Brand[];
  locations: Location[];
  vehicles: VehicleMake[];
};

function ProductEditor({
  product,
  tab,
  setTab,
  onClose,
  onMessage,
  onRefresh,
  categories,
  brands,
  locations: initialLocations,
  vehicles,
}: EditorProps) {
  const [locations, setLocations] = useState<Location[]>(initialLocations);
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
    barcode: createEan13(String(Date.now()).slice(-9)),
    salePrice: '',
    purchasePrice: '',
    minStock: '',
    locationId: '',
    initialQuantity: '',
  });
  /** Inline edits for existing inventory items (price/minStock/shelf). */
  const [itemEdits, setItemEdits] = useState<
    Record<
      string,
      { salePrice: string; purchasePrice: string; minStock: string; locationId: string }
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
          barcode: item.barcode,
          salePrice: Number(item.salePrice) || 0,
          purchasePrice: Number(item.purchasePrice) || 0,
          minStock: item.minStock ? Number(item.minStock) : undefined,
          locationId: item.locationId || undefined,
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
          locationId: edit.locationId || null,
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
      locationId: entry.location?.id ?? '',
    };
  const setItemEdit = (
    entry: NonNullable<ProductDetail['inventoryItems']>[number],
    changes: Partial<{
      salePrice: string;
      purchasePrice: string;
      minStock: string;
      locationId: string;
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
  const footerLabel: Record<Tab, string> = {
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
            <button
              type="button"
              className="button-primary editor-save"
              disabled={busy}
              title={footerLabel[tab]}
              onClick={() => void saveAndClose()}
            >
              {busy ? 'در حال ذخیره…' : '✓ ذخیره'}
            </button>
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
                          قفسه
                          <select
                            value={edit.locationId}
                            onChange={(event) =>
                              setItemEdit(entry, { locationId: event.target.value })
                            }
                          >
                            <option value="">بدون قفسه</option>
                            {locations.length ? (
                              locations.map((location) => (
                                <option value={location.id} key={location.id}>
                                  {locationLabel(location)}
                                </option>
                              ))
                            ) : (
                              <option disabled>در حال بارگذاری قفسه‌ها...</option>
                            )}
                          </select>
                          {!locations.length && <small className="muted">قفسه‌ای یافت نشد — از تب انبار → قفسه‌ها، قفسه بسازید</small>}
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
                    onChange={(event) => setItem({ ...item, locationId: event.target.value })}
                  >
                    <option value="">بدون قفسه</option>
                    {locations.length ? (
                      locations.map((location) => (
                        <option value={location.id} key={location.id}>
                          {locationLabel(location)}
                        </option>
                      ))
                    ) : (
                      <option disabled>در حال بارگذاری قفسه‌ها...</option>
                    )}
                  </select>
                  {!locations.length && <small className="muted">قفسه‌ای یافت نشد — از تب انبار → قفسه‌ها، قفسه بسازید</small>}
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
