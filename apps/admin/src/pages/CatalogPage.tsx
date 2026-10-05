import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatJalaliDate, formatPersianNumber, formatRial } from '@salimvand/shared';
import { api, downloadFile } from '../lib/api';
import { hashForPage, paramsFromHash } from '../lib/admin-route';
import type {
  Brand,
  Category,
  InventoryLine,
  Location,
  ProductDetail,
  ProductRow,
  Supplier,
  VehicleMake,
} from '../lib/catalog-types';
import {
  aggregateProduct,
  emptyFilters,
  filterOptions,
  lineTone,
  matchesCatalogFilters,
  priceOf,
  sortOptions,
  sortProducts,
  stockToneLabel,
  type CatalogFilters,
  type CatalogSort,
  type PriceRange,
} from '../lib/catalog-list';
import { basketLabel, locationChip, locationLabel } from '../lib/location-label';
import { publicSiteUrl } from '../lib/public-site';
import { BulkPricePanel } from '../components/BulkPricePanel';
import { InventoryItemCard, type ItemCardLine } from '../components/InventoryItemCard';
import { PlacementManager } from '../components/PlacementManager';
import { ProductCreateModal } from '../components/ProductCreateModal';
import { ProductEditor, type ProductEditorTab } from '../components/ProductEditor';
import { SupplierBadge } from '../components/SupplierBadge';
import { StockStepper } from '../components/StockStepper';
import { MediaImage } from '../components/MediaImage';

// The scanner pulls in the html5-qrcode library — load it only when the
// unified list is on screen and the browser is asked for it.
const BarcodeScanner = lazy(() =>
  import('../components/BarcodeScanner').then((module) => ({ default: module.BarcodeScanner })),
);

/**
 * «محصولات و انبار» — ONE page, ONE list. The catalogue and the warehouse
 * used to be two tabs of two different screens; operators had to hunt for
 * the same part twice and the numbers (price, shelf, quantity) were hidden
 * one level too deep. Here every product is a row of a real columnar table
 * and each of its stock lines (محصول × برند) is a sub-row underneath, with
 * the same columns — price, quantity, shelf and basket are always visible.
 *
 * Sections, top to bottom: headline + actions · KPIs · filters/sort ·
 * bulk-price band · the unified list. Everything else (product form, editor,
 * item card, shelf manager) opens as a floating dialog over the list.
 */

const priceRange = (range: PriceRange, emptyLabel = 'ثبت نشده'): string => {
  if (range.min === null || range.max === null) return emptyLabel;
  return range.min === range.max
    ? formatRial(range.min)
    : `${formatRial(range.min)} – ${formatRial(range.max)}`;
};

const iconPaths: Record<string, ReactNode> = {
  category: (
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  ),
  brand: (
    <>
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
    </>
  ),
  vehicle: (
    <>
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
      <circle cx="7" cy="17" r="2" />
      <path d="M9 17h6" />
      <circle cx="17" cy="17" r="2" />
    </>
  ),
  placement: (
    <>
      <path d="M3 7h18v13H3z" />
      <path d="M3 7l2-4h14l2 4M8 12h8" />
    </>
  ),
  status: (
    <>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  sort: <path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" />,
};

const ToolbarIcon = ({ name }: { name: keyof typeof iconPaths }) => (
  <span className="tp-lead" aria-hidden="true">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name]}
    </svg>
  </span>
);

const chipList = (values: string[], emptyLabel: string, className = 'cl-chip') => {
  if (!values.length) return <span className="cl-dash">{emptyLabel}</span>;
  const shown = values.slice(0, 3);
  return (
    <>
      {shown.map((value) => (
        <span className={className} key={value}>
          {value}
        </span>
      ))}
      {values.length > shown.length && (
        <span className={`${className} is-more`} title={values.join('، ')}>
          +{formatPersianNumber(values.length - shown.length)}
        </span>
      )}
    </>
  );
};

export function CatalogPage({
  canManageProducts,
  canManagePlacements,
  canExportReports,
  canAdjustStock,
}: {
  /** From `catalogCapabilities(role)` — mirrors what the API actually allows. */
  canManageProducts: boolean;
  canManagePlacements: boolean;
  canExportReports: boolean;
  canAdjustStock: boolean;
}) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [vehicles, setVehicles] = useState<VehicleMake[]>([]);
  const [filters, setFilters] = useState<CatalogFilters>(emptyFilters);
  const [sort, setSort] = useState<CatalogSort>('newest');
  const [collapsedRows, setCollapsedRows] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  // Floating dialogs over the list — never inline blocks at the end of the page.
  const [draft, setDraft] = useState<ProductDetail | null>(null);
  const [tab, setTab] = useState<ProductEditorTab>('basic');
  const [createOpen, setCreateOpen] = useState(false);
  const [placementOpen, setPlacementOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [detail, setDetail] = useState<ItemCardLine | null>(null);
  const [keywordBusy, setKeywordBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

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

  /** Optimistic shell from the list row: the editor opens INSTANTLY and the
   *  detail GET overwrites it on arrival. A failed detail GET keeps the shell
   *  open with the exact reason in the notice strip. */
  const rowToDraft = (row: ProductRow): ProductDetail => {
    const categoryId = categories.find((entry) => entry.name === row.category?.name)?.id;
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      slug: row.slug,
      status: row.status,
      priceDisplay: 'inherit',
      description: null,
      partNumber: row.partNumber ?? null,
      supplierId: row.supplier?.id ?? null,
      supplier: row.supplier ?? null,
      aparatVideoId: null,
      seoTitle: null,
      seoDescription: null,
      seoKeywords: row.seoKeywords ?? [],
      ...(categoryId ? { category: { id: categoryId, name: row.category?.name ?? '' } } : {}),
      images: (row.images ?? []).map((image, index) => ({
        id: `row-${index}`,
        path: image.path,
        alt: image.alt ?? null,
        isPrimary: image.isPrimary ?? index === 0,
        sort: index,
      })),
      compatibilities: [],
      inventoryItems: [],
      partial: true,
    };
  };

  const openEditor = (id: string, startTab: ProductEditorTab = 'basic') => {
    const row = products.find((entry) => entry.id === id);
    if (row) {
      setTab(startTab);
      setDraft(rowToDraft(row));
    }
    void refresh(id)
      .then((fresh) => {
        setTab(startTab);
        setDraft(fresh);
      })
      .catch((error: Error) =>
        setMessage(
          row
            ? `ویرایشگر با اطلاعات لیست باز شد؛ دریافت کامل اطلاعات محصول ناموفق بود: ${error.message}`
            : `باز کردن ویرایشگر محصول ناموفق بود: ${error.message}`,
        ),
      );
  };

  const openItemCard = async (line: InventoryLine, product: ProductRow) => {
    setDetail({
      ...line,
      product: {
        id: product.id,
        name: product.name,
        code: product.code,
        images: product.images ?? [],
      },
    });
  };

  const loadReferenceData = () => {
    void api<{ data: Category[] }>('/categories')
      .then((result) => setCategories(result.data))
      .catch(() => undefined);
    void api<{ data: Brand[] }>('/brands')
      .then((result) => setBrands(result.data))
      .catch(() => undefined);
    void api<{ data: Supplier[] }>('/suppliers')
      .then((result) => setSuppliers(result.data))
      .catch(() => undefined);
    void api<{ data: VehicleMake[] }>('/vehicles/tree')
      .then((result) => setVehicles(result.data))
      .catch(() => undefined);
  };

  const loadLocations = () =>
    api<{ data: Location[] }>('/locations')
      // انبار › قفسه › سبد — depth first, then the human code order
      // (۱.۱ … ۱۰.۱ … ۲۰.۷) inside each level.
      .then((result) =>
        setLocations(
          [...result.data].sort(
            (a, b) =>
              locationDepth(a) - locationDepth(b) ||
              a.code.localeCompare(b.code, 'en', { numeric: true }),
          ),
        ),
      )
      .catch(() => undefined);

  useEffect(() => {
    void load();
    loadReferenceData();
    void loadLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep links: #/products?edit=<id> (editor), ?product=<id> (alias) and
  // ?item=<id> (item card) keep working from the palette and old links. Each
  // hash value is consumed ONCE, so refreshing the list never re-opens an
  // editor the operator just closed.
  const productsRef = useRef<ProductRow[]>(products);
  productsRef.current = products;
  const handledHashRef = useRef('');
  useEffect(() => {
    const openFromHash = () => {
      const hash = window.location.hash;
      if (!hash.includes('?') || handledHashRef.current === hash) return;
      handledHashRef.current = hash;
      const params = paramsFromHash(hash);
      const openEditorRef = (id: string, startTab: ProductEditorTab) => {
        const row = productsRef.current.find((entry) => entry.id === id);
        if (row) {
          setTab(startTab);
          setDraft(rowToDraft(row));
        }
        void refresh(id)
          .then((fresh) => {
            setTab(startTab);
            setDraft(fresh);
          })
          .catch((error: Error) => setMessage((error as Error).message));
      };
      if (params.edit) openEditorRef(params.edit, (params.tab as ProductEditorTab) ?? 'basic');
      else if (params.product) openEditorRef(params.product, 'basic');
      if (params.item) {
        void api<{ data: ItemCardLine }>(`/inventory/items/${params.item}`)
          .then((result) => setDetail(result.data))
          .catch(() => undefined);
      }
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    const filtered = products.filter((product) => matchesCatalogFilters(product, filters));
    return sortProducts(filtered, sort).map((product) => ({
      product,
      aggregate: aggregateProduct(product),
    }));
  }, [products, filters, sort]);

  const options = useMemo(() => filterOptions(products), [products]);

  const totals = useMemo(() => {
    const lines = products.flatMap((product) => product.inventoryItems ?? []);
    const stockValue = lines.reduce(
      (sum, line) => sum + line.quantity * priceOf(line.purchasePrice),
      0,
    );
    const saleValue = lines.reduce((sum, line) => sum + line.quantity * priceOf(line.salePrice), 0);
    return {
      products: products.length,
      lines: lines.length,
      pieces: lines.reduce((sum, line) => sum + line.quantity, 0),
      stockValue,
      saleValue,
      lowOrOut: lines.filter((line) => lineTone(line) !== 'ok').length,
    };
  }, [products]);

  const toggleRow = (id: string) =>
    setCollapsedRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const patchFilter = (patch: Partial<CatalogFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));
  const filtersActive = Object.entries(filters).some(([key, value]) => key !== 'query' && value);

  const toggleStatus = async (product: ProductRow) => {
    try {
      await api(`/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: product.status === 'active' ? 'hidden' : 'active' }),
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
  };

  const removeProduct = async (product: ProductRow) => {
    if (!window.confirm(`محصول «${product.name}» حذف نرم شود؟ از سایت پنهان می‌شود.`)) return;
    try {
      await api(`/products/${product.id}`, { method: 'DELETE' });
      setMessage('محصول حذف نرم شد.');
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const removeLine = async (line: InventoryLine, product: ProductRow) => {
    if (
      !window.confirm(
        `قلم «${product.name}» (${line.brand?.name ?? 'بدون برند'}) از انبار حذف شود؟`,
      )
    )
      return;
    try {
      await api(`/inventory/items/${line.id}`, { method: 'DELETE' });
      setMessage('قلم از لیست انبار حذف شد');
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const publish = async (product: ProductRow) => {
    setMessage('در حال انتشار در کانال‌ها...');
    try {
      const result = await api<{
        data: {
          telegram: { ok: boolean; skipped?: boolean; reason?: string };
          bale: { ok: boolean; skipped?: boolean; reason?: string };
        };
      }>(`/products/${product.id}/publish`, { method: 'POST' });
      const label = (name: string, channel: { ok: boolean; skipped?: boolean; reason?: string }) =>
        channel.skipped
          ? `${name}: پیکربندی نشده`
          : channel.ok
            ? `${name}: ارسال شد ✓`
            : `${name}: خطا — ${channel.reason}`;
      setMessage(
        `انتشار «${product.name}» — ${label('تلگرام', result.data.telegram)} · ${label(
          'بله',
          result.data.bale,
        )}`,
      );
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const lookupBarcode = async (code: string) => {
    if (!code.trim()) return;
    try {
      const result = await api<{ data: ItemCardLine }>(
        `/inventory/barcode/${encodeURIComponent(code.trim())}`,
      );
      setDetail(result.data);
      setMessage(`قلم ${result.data.product?.name ?? ''} پیدا شد`);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const regenerateKeywords = async () => {
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
  };

  const exportBackup = async () => {
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
  };

  const restoreBackup = async (file: File) => {
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
            ? ` (${summary.errors.length.toLocaleString('fa-IR')} خطا: ${summary.errors
                .slice(0, 3)
                .join('؛ ')}${summary.errors.length > 3 ? '…' : ''})`
            : ''),
      );
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setRestoreBusy(false);
    }
  };

  const exportCsv = () =>
    void downloadFile('/reports/inventory/export', 'salimvand-inventory.csv').catch(
      (error: Error) => setMessage(error.message),
    );
  const exportAccounting = () =>
    void downloadFile(
      '/reports/inventory/accounting-export',
      'salimvand-products-accounting.xlsx',
    ).catch((error: Error) => setMessage(error.message));

  return (
    <section className="catalog-page">
      <div className="page-title">
        <div>
          <h1>محصولات و انبار</h1>
          <p className="muted">
            یک لیست واحد: هر محصول یک سطر و هر قلم (محصول × برند) یک زیرسطر با قیمت، تعداد، قفسه و
            سبد. برای دیدن همهٔ ستون‌ها روی ویرایش هر محصول بزنید — همه‌چیز در همین صفحه است.
          </p>
        </div>
        <div className="page-title-actions">
          <span className="count">
            {formatPersianNumber(totals.products)} محصول · {formatPersianNumber(totals.lines)} قلم
          </span>
          {canManageProducts && (
            <button className="button-primary" onClick={() => setCreateOpen(true)}>
              ＋ ثبت محصول
            </button>
          )}
          <button className="outline" onClick={() => setPlacementOpen(true)}>
            قفسه‌ها و سبدها
          </button>
          {canManageProducts && (
            <>
              <button
                className="keyword-regenerate"
                disabled={keywordBusy}
                onClick={() => void regenerateKeywords()}
              >
                {keywordBusy ? 'در حال ساخت…' : 'بازسازی کلیدواژه‌ها'}
              </button>
              <button
                className="products-backup-export"
                disabled={backupBusy}
                onClick={() => void exportBackup()}
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
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void restoreBackup(file);
                }}
              />
            </>
          )}
        </div>
      </div>

      {/* بخش ۱ — نمای کلی انبار */}
      <div className="inventory-kpis" aria-label="خلاصه موجودی">
        <article className="inventory-kpi">
          <span className="kpi-icon">▱</span>
          <div>
            <small>اقلام فعال</small>
            <strong>{formatPersianNumber(totals.lines)}</strong>
            <em>در {formatPersianNumber(totals.products)} محصول</em>
          </div>
        </article>
        <article className="inventory-kpi">
          <span className="kpi-icon">▣</span>
          <div>
            <small>ارزش انبار (خرید)</small>
            <strong>{formatRial(totals.stockValue)}</strong>
            <em>{formatPersianNumber(totals.pieces)} قطعه در انبار</em>
          </div>
        </article>
        <article className="inventory-kpi inventory-kpi-sale-value">
          <span className="kpi-icon">◈</span>
          <div>
            <small>ارزش انبار (فروش)</small>
            <strong>{formatRial(totals.saleValue)}</strong>
            <em>بر پایه قیمت فروش</em>
          </div>
        </article>
        <article className="inventory-kpi inventory-kpi-alert">
          <span className="kpi-icon">△</span>
          <div>
            <small>کم‌موجود یا ناموجود</small>
            <strong>{formatPersianNumber(totals.lowOrOut)}</strong>
            <em>نیاز به سفارش</em>
          </div>
        </article>
      </div>

      {/* بخش ۲ — جست‌وجو، فیلترها و ابزارها */}
      <div className="product-filter-toolbar">
        <div className="search-field product-search-field">
          <span className="search-icon">⌕</span>
          <input
            placeholder="نام، کد، بارکد، برند، شماره فنی یا قفسه…"
            aria-label="جست‌وجو در محصولات و انبار"
            value={filters.query}
            onChange={(event) => patchFilter({ query: event.target.value })}
          />
          {filters.query && (
            <button
              type="button"
              className="search-clear"
              onClick={() => patchFilter({ query: '' })}
              aria-label="پاک کردن جست‌وجو"
            >
              ✕
            </button>
          )}
        </div>
        <div className="toolbar-filter-row">
          <div
            className={`toolbar-pill${filters.stock ? ' is-active' : ''}`}
            aria-label="نمایش اقلام"
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
                <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                <path d="M3.3 7l8.7 5 8.7-5" />
                <path d="M12 22V12" />
              </svg>
            </span>
            <div className="tp-options" role="tablist" aria-label="نمایش اقلام">
              {(
                [
                  { id: '', label: 'همه' },
                  { id: 'low', label: 'کم‌موجود' },
                  { id: 'out', label: 'ناموجود' },
                ] as const
              ).map((entry) => (
                <button
                  key={entry.id || 'all'}
                  type="button"
                  role="tab"
                  aria-selected={filters.stock === entry.id}
                  className={filters.stock === entry.id ? 'active' : ''}
                  onClick={() => patchFilter({ stock: entry.id })}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
          <label
            className={`toolbar-pill${filters.category ? ' is-active' : ''}`}
            aria-label="فیلتر دسته‌بندی"
          >
            <ToolbarIcon name="category" />
            <select
              value={filters.category}
              onChange={(event) => patchFilter({ category: event.target.value })}
              aria-label="فیلتر دسته‌بندی"
            >
              <option value="">همه دسته‌ها</option>
              {options.categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label
            className={`toolbar-pill${filters.brand ? ' is-active' : ''}`}
            aria-label="فیلتر برند"
          >
            <ToolbarIcon name="brand" />
            <select
              value={filters.brand}
              onChange={(event) => patchFilter({ brand: event.target.value })}
              aria-label="فیلتر برند"
            >
              <option value="">همه برندها</option>
              {options.brands.map((brand) => (
                <option key={brand} value={brand}>
                  {brand}
                </option>
              ))}
            </select>
          </label>
          <label
            className={`toolbar-pill${filters.vehicle ? ' is-active' : ''}`}
            aria-label="فیلتر خودرو"
          >
            <ToolbarIcon name="vehicle" />
            <select
              value={filters.vehicle}
              onChange={(event) => patchFilter({ vehicle: event.target.value })}
              aria-label="فیلتر خودرو"
            >
              <option value="">همه خودروها</option>
              {options.vehicles.map((vehicle) => (
                <option key={vehicle} value={vehicle}>
                  {vehicle}
                </option>
              ))}
            </select>
          </label>
          <label
            className={`toolbar-pill${filters.placement ? ' is-active' : ''}`}
            aria-label="فیلتر قفسه یا سبد"
          >
            <ToolbarIcon name="placement" />
            <select
              value={filters.placement}
              onChange={(event) => patchFilter({ placement: event.target.value })}
              aria-label="فیلتر قفسه یا سبد"
            >
              <option value="">همه قفسه‌ها و سبدها</option>
              {options.placements.map((placement) => (
                <option key={placement} value={placement}>
                  {placement}
                </option>
              ))}
            </select>
          </label>
          <div
            className={`toolbar-pill${filters.status ? ' is-active' : ''}`}
            aria-label="فیلتر وضعیت سایت"
          >
            <ToolbarIcon name="status" />
            <div className="tp-options" role="tablist" aria-label="وضعیت نمایش در سایت">
              {(
                [
                  { id: '', label: 'همه' },
                  { id: 'active', label: 'فعال' },
                  { id: 'hidden', label: 'مخفی' },
                ] as const
              ).map((entry) => (
                <button
                  key={entry.id || 'any'}
                  type="button"
                  role="tab"
                  aria-selected={filters.status === entry.id}
                  className={filters.status === entry.id ? 'active' : ''}
                  onClick={() => patchFilter({ status: entry.id })}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
          <label className="toolbar-pill" aria-label="ترتیب نمایش">
            <ToolbarIcon name="sort" />
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as CatalogSort)}
              aria-label="ترتیب نمایش"
            >
              {sortOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {(filtersActive || filters.query) && (
            <button type="button" className="pill" onClick={() => setFilters(emptyFilters)}>
              × پاک کردن فیلترها
            </button>
          )}
          {canAdjustStock && (
            <button type="button" className="pill" onClick={() => setBulkOpen((open) => !open)}>
              {bulkOpen ? 'بستن تغییر گروهی قیمت' : 'تغییر گروهی قیمت'}
            </button>
          )}
          {canExportReports && (
            <>
              <button type="button" className="pill" onClick={exportCsv}>
                خروجی CSV
              </button>
              <button type="button" className="pill" onClick={exportAccounting}>
                خروجی حسابداری
              </button>
            </>
          )}
          <Suspense fallback={<span className="muted">آماده‌سازی اسکنر…</span>}>
            <BarcodeScanner
              onCode={(code) => {
                patchFilter({ query: code });
                void lookupBarcode(code);
              }}
            />
          </Suspense>
        </div>
        <p className="stock-search-meta" aria-live="polite">
          {filters.query
            ? `${formatPersianNumber(rows.length)} محصول برای «${filters.query}»`
            : `${formatPersianNumber(rows.length)} محصول در این نما`}
        </p>
      </div>

      {bulkOpen && canAdjustStock && (
        <BulkPricePanel
          brands={brands}
          categories={categories}
          onDone={load}
          onMessage={setMessage}
        />
      )}

      {message && (
        <div className="notice" role="status">
          {message}
          <button
            type="button"
            className="search-clear"
            aria-label="بستن پیام"
            onClick={() => setMessage('')}
          >
            ✕
          </button>
        </div>
      )}

      {/* بخش ۳ — لیست واحد: سطر محصول + زیرسطرِ قلم‌ها با ستون‌های واقعی */}
      <div className="cl-table" role="table" aria-label="فهرست محصولات و اقلام انبار">
        <div className="cl-head" role="row">
          <span role="columnheader">محصول</span>
          <span role="columnheader">برند / بارکد</span>
          <span role="columnheader" className="cl-col-buy">
            قیمت خرید
          </span>
          <span role="columnheader">قیمت فروش</span>
          <span role="columnheader">تعداد</span>
          <span role="columnheader">قفسه</span>
          <span role="columnheader" className="cl-col-basket">
            سبد
          </span>
          <span role="columnheader">وضعیت</span>
          <span role="columnheader" className="cl-col-actions">
            عملیات
          </span>
        </div>

        {rows.map(({ product, aggregate }) => {
          const lines = product.inventoryItems ?? [];
          const collapsed = collapsedRows.has(product.id);
          return (
            <article className="cl-card" key={product.id}>
              <div className="cl-row" role="row">
                <div className="cl-cell cl-product" role="cell" data-label="محصول">
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
                  <span className="cl-info">
                    <b title={product.name}>{product.name}</b>
                    <small dir="ltr">
                      {product.code}
                      {product.partNumber ? ` · ${product.partNumber}` : ''}
                    </small>
                    <span className="cl-chips">
                      {product.category?.name && (
                        <span className="chip">{product.category.name}</span>
                      )}
                      {aggregate.vehicles.length > 0 && (
                        <span className="chip vehicle-chip">
                          {formatPersianNumber(aggregate.vehicles.length)} خودرو
                        </span>
                      )}
                      {lines.length > 0 && (
                        <button
                          type="button"
                          className="cl-collapse"
                          aria-expanded={!collapsed}
                          onClick={() => toggleRow(product.id)}
                        >
                          {collapsed ? '▸' : '▾'} {formatPersianNumber(lines.length)} قلم
                        </button>
                      )}
                      {!lines.length && <span className="chip is-warn">بدون قلم انبار</span>}
                    </span>
                  </span>
                </div>

                <div className="cl-cell" role="cell" data-label="برند / بارکد">
                  {chipList(
                    lines.map((line) => line.brand?.name ?? 'بدون برند'),
                    'بدون قلم',
                    'cl-chip brand',
                  )}
                </div>

                <div className="cl-cell cl-num cl-col-buy" role="cell" data-label="قیمت خرید">
                  {priceRange(aggregate.purchase)}
                </div>

                <div className="cl-cell cl-num cl-price" role="cell" data-label="قیمت فروش">
                  {priceRange(aggregate.sale, 'قیمت ثبت نشده')}
                </div>

                <div className="cl-cell cl-qty" role="cell" data-label="تعداد">
                  <b>{formatPersianNumber(aggregate.totalQuantity)}</b>
                  <small>قطعه در {formatPersianNumber(aggregate.lines)} قلم</small>
                  {aggregate.lines > 0 && aggregate.tone !== 'ok' && (
                    <span className={`cl-tone is-${aggregate.tone}`}>
                      {aggregate.tone === 'out'
                        ? 'ناموجود'
                        : `${formatPersianNumber(aggregate.lowLines + aggregate.outLines)} قلم کم‌موجود`}
                    </span>
                  )}
                </div>

                <div className="cl-cell cl-place" role="cell" data-label="قفسه">
                  {chipList(aggregate.shelfLabels, 'تعیین نشده', 'place-chip')}
                </div>

                <div className="cl-cell cl-place cl-col-basket" role="cell" data-label="سبد">
                  {chipList(aggregate.basketLabels, '—', 'place-chip is-basket')}
                </div>

                <div className="cl-cell cl-status" role="cell" data-label="وضعیت">
                  {canManageProducts ? (
                    <button
                      type="button"
                      className={`catalog-switch ${product.status === 'active' ? 'on' : ''}`}
                      role="switch"
                      aria-checked={product.status === 'active'}
                      title="نمایش محصول برای کاربران عمومی سایت"
                      onClick={() => void toggleStatus(product)}
                    >
                      <span aria-hidden="true" className="sw-track" />
                      <span className="cl-switch-text">
                        {product.status === 'active' ? 'فعال' : 'غیرفعال'}
                      </span>
                    </button>
                  ) : (
                    <span className={`cl-tone ${product.status === 'active' ? 'is-ok' : ''}`}>
                      {product.status === 'active' ? 'فعال' : 'مخفی'}
                    </span>
                  )}
                  {aggregate.lines === 0 && <span className="cl-tone is-out">بدون قلم</span>}
                </div>

                <div className="cl-cell cl-actions cl-col-actions" role="cell" data-label="عملیات">
                  {canManageProducts ? (
                    <>
                      <button className="row-action" onClick={() => openEditor(product.id)}>
                        ویرایش
                      </button>
                      <button
                        className="row-action"
                        onClick={() => openEditor(product.id, 'items')}
                        title="افزودن قلم/برند، قیمت و موجودی"
                      >
                        ＋ قلم
                      </button>
                    </>
                  ) : (
                    canAdjustStock && (
                      <button
                        className="row-action"
                        onClick={() => openEditor(product.id, 'items')}
                        title="افزودن قلم/برند، قیمت و موجودی"
                      >
                        ＋ قلم
                      </button>
                    )
                  )}
                  <button
                    className="row-action"
                    onClick={() => {
                      window.location.hash = hashForPage('labels', { product: product.id });
                    }}
                  >
                    برچسب
                  </button>
                  <a
                    className="row-action"
                    href={`${publicSiteUrl}/product/${encodeURIComponent(product.slug)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    سایت
                  </a>
                  <button className="row-action" onClick={() => void publish(product)}>
                    انتشار
                  </button>
                  {canManageProducts && (
                    <button
                      className="row-action danger-text"
                      onClick={() => void removeProduct(product)}
                    >
                      حذف
                    </button>
                  )}
                </div>
              </div>

              {!collapsed && (
                <div className="cl-lines" role="rowgroup" aria-label={`اقلام ${product.name}`}>
                  {lines.length ? (
                    lines.map((line) => {
                      const tone = lineTone(line);
                      const sale = priceOf(line.salePrice);
                      return (
                        <div className="cl-line" role="row" key={line.id}>
                          <span className="cl-line-lead" aria-hidden="true">
                            ↳
                          </span>
                          <span
                            className="cl-cell cl-line-brand"
                            role="cell"
                            data-label="برند / بارکد"
                          >
                            <b>{line.brand?.name ?? 'بدون برند'}</b>
                            {line.barcode && <code dir="ltr">{line.barcode}</code>}
                            {line.supplier?.name && <SupplierBadge name={line.supplier.name} />}
                          </span>
                          <span
                            className="cl-cell cl-num cl-col-buy"
                            role="cell"
                            data-label="قیمت خرید"
                          >
                            {priceOf(line.purchasePrice) > 0 ? (
                              formatRial(priceOf(line.purchasePrice))
                            ) : (
                              <span className="cl-dash">ثبت نشده</span>
                            )}
                          </span>
                          <span
                            className="cl-cell cl-num cl-price"
                            role="cell"
                            data-label="قیمت فروش"
                          >
                            {sale > 0 ? (
                              formatRial(sale)
                            ) : (
                              <span className="cl-dash">ثبت نشده</span>
                            )}
                            {line.priceUpdatedAt && (
                              <small className="cl-date">
                                از {formatJalaliDate(line.priceUpdatedAt)}
                              </small>
                            )}
                          </span>
                          <span className="cl-cell cl-qty" role="cell" data-label="تعداد">
                            <StockStepper
                              itemId={line.id}
                              quantity={line.quantity}
                              onMessage={setMessage}
                              onSaved={() => void load()}
                            />
                            {line.minStock != null && line.minStock > 0 && (
                              <small>حداقل {formatPersianNumber(line.minStock)}</small>
                            )}
                          </span>
                          <span className="cl-cell cl-place" role="cell" data-label="قفسه">
                            {line.location ? (
                              <span className="place-chip" title={locationLabel(line.location)}>
                                {locationChip(line.location)}
                              </span>
                            ) : (
                              <span className="cl-dash">تعیین نشده</span>
                            )}
                          </span>
                          <span
                            className="cl-cell cl-place cl-col-basket"
                            role="cell"
                            data-label="سبد"
                          >
                            {line.basket ? (
                              <span className="place-chip is-basket">
                                {basketLabel(line.basket)}
                              </span>
                            ) : (
                              <span className="cl-dash">روی قفسه</span>
                            )}
                          </span>
                          <span className="cl-cell cl-status" role="cell" data-label="وضعیت">
                            <span className={`cl-tone is-${tone}`}>{stockToneLabel[tone]}</span>
                          </span>
                          <span
                            className="cl-cell cl-actions cl-col-actions"
                            role="cell"
                            data-label="عملیات"
                          >
                            <button
                              className="row-action"
                              onClick={() => void openItemCard(line, product)}
                            >
                              کارت قلم
                            </button>
                            <button
                              className="row-action"
                              onClick={() => {
                                window.location.hash = hashForPage('labels', { item: line.id });
                              }}
                            >
                              برچسب
                            </button>
                            {canAdjustStock && (
                              <button
                                className="row-action danger-text"
                                onClick={() => void removeLine(line, product)}
                              >
                                حذف قلم
                              </button>
                            )}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <div className="cl-line is-empty">
                      <p className="muted">
                        برای این محصول هنوز قلم انباری (برند، قیمت، قفسه) ثبت نشده است.
                      </p>
                      {(canManageProducts || canAdjustStock) && (
                        <button
                          className="button-primary"
                          onClick={() => openEditor(product.id, 'items')}
                        >
                          افزودن قلم و قیمت
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
        {!rows.length && <p className="muted cl-empty">محصولی یافت نشد.</p>}
      </div>

      {createOpen && canManageProducts && (
        <ProductCreateModal
          open
          onClose={() => setCreateOpen(false)}
          onCreated={(createdMessage) => {
            setMessage(createdMessage);
            void load();
          }}
          categories={categories}
          brands={brands}
          locations={locations}
          vehicles={vehicles}
          suppliers={suppliers}
        />
      )}

      {draft && (
        <ProductEditor
          key={draft.partial ? `${draft.id}|partial` : draft.id}
          product={draft}
          tab={tab}
          setTab={setTab}
          onClose={() => setDraft(null)}
          onMessage={setMessage}
          onRefresh={() => void refresh(draft.id)}
          categories={categories}
          brands={brands}
          suppliers={suppliers}
          locations={locations}
          vehicles={vehicles}
          canEditProductFields={canManageProducts}
        />
      )}

      {detail && (
        <InventoryItemCard
          item={detail}
          locations={locations}
          suppliers={suppliers}
          onClose={() => setDetail(null)}
          onMessage={setMessage}
          onChanged={() => load()}
        />
      )}

      {placementOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setPlacementOpen(false)}>
          <div
            className="editor placement-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="قفسه‌ها و سبدها"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="editor-head">
              <h2>قفسه‌ها و سبدها</h2>
              <button className="close" onClick={() => setPlacementOpen(false)} aria-label="بستن">
                ✕
              </button>
            </div>
            <div className="editor-body">
              <PlacementManager
                locations={locations}
                canEdit={canManagePlacements}
                onMessage={setMessage}
                onRefresh={async () => {
                  await loadLocations();
                  await load();
                }}
                onClose={() => setPlacementOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** Depth in the placement tree: انبار = 0، قفسه = 1، سبد = 2. */
function locationDepth(location: { type: string }): number {
  return location.type === 'warehouse' ? 0 : location.type === 'basket' ? 2 : 1;
}
