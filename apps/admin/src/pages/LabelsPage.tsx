import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { paramsFromHash } from '../lib/admin-route';
import { FaNumberInput } from '../components/FaNumberInput';
import {
  LABEL_CSS,
  STORE_SITE,
  barcodeTypes,
  buildSheetHTML,
  ean13FromSku,
  labelSizes,
  labelStyles,
  persianDigits,
  renderLabelHTML,
  renderShelfLabelHTML,
  type BarcodeType,
  type LabelOptions,
  type LabelSize,
  type LabelStyle,
  type ShelfLabelOptions,
} from '../lib/labels';

type LabelItem = {
  id: string;
  productId: string;
  barcode: string;
  name: string;
  sku: string;
  brand: string;
  category: string;
  vehicles: string;
  quantity: number;
};

/** mm → CSS reference pixels (1mm = 96/25.4px) for the zoom box sizing. */
const MM_PX = 96 / 25.4;
const SIZE_MM: Record<LabelSize, { w: number; h: number }> = {
  '50x30': { w: 50, h: 30 },
  '60x40': { w: 60, h: 40 },
  '40x60': { w: 40, h: 60 },
  '38x22': { w: 38, h: 22 },
};

const ZOOMS = [2, 3, 4] as const;

/** Two tabs on the labels page: barcoded product labels and shelf/placement
 * labels printed from the locations tree created in «انبار و موجودی». */
const labelTabs = [
  { id: 'products', label: 'برچسب محصولات', hint: 'بارکد قابل اسکن برای هر کالای انبار' },
  { id: 'shelves', label: 'برچسب قفسه‌ها', hint: 'نام و کد قفسه‌ها — چاپ و نصب روی قفسه' },
] as const;
type LabelTab = (typeof labelTabs)[number]['id'];

/** Raw location node from GET /locations — a two-level tree (warehouses hold
 * shelves); legacy flat locations appear as shelves without a warehouse. */
type LocationNode = {
  id: string;
  name: string;
  code: string;
  type: string;
  parent?: { name: string } | null;
  children?: LocationNode[];
  _count?: { items: number };
};

/** A labelable shelf: any non-warehouse location, flattened with its owning
 * warehouse name so the label and the batch list can show «انبار · قفسه». */
type ShelfRow = { id: string; name: string; code: string; warehouse: string; items: number };

export function LabelsPage() {
  const [tab, setTab] = useState<LabelTab>('products');
  const [items, setItems] = useState<LabelItem[]>([]);
  const [message, setMessage] = useState('');
  /** Site identity from settings: logo + store name go on every label. */
  const [logoUrl, setLogoUrl] = useState('');
  const [storeName, setStoreName] = useState('');
  const [labelHeader, setLabelHeader] = useState(
    () => localStorage.getItem('salimvand.labelHeader') || 'فروشگاه سلیم وند',
  );
  const [labelFooter, setLabelFooter] = useState(
    () => localStorage.getItem('salimvand.labelFooter') || 'اصالت کالا',
  );
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState('');

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [code, setCode] = useState('');
  const [category, setCategory] = useState('');
  const [cars, setCars] = useState('');

  const [size, setSize] = useState<LabelSize>('40x60');
  const [style, setStyle] = useState<LabelStyle>('brand');
  const [barcodeType, setBarcodeType] = useState<BarcodeType>('ean13');
  const [zoom, setZoom] = useState<number>(3);
  const [showSku, setShowSku] = useState(true);
  const [showMeta, setShowMeta] = useState(false);
  const [showFoot, setShowFoot] = useState(true);
  const [count, setCount] = useState('18');
  // — تب برچسب قفسه‌ها —
  const [shelves, setShelves] = useState<ShelfRow[]>([]);
  const [shelfFilter, setShelfFilter] = useState('');
  const [selectedShelfId, setSelectedShelfId] = useState('');
  const [shelfName, setShelfName] = useState('');
  const [shelfWarehouse, setShelfWarehouse] = useState('');
  const [shelfSize, setShelfSize] = useState<LabelSize>('50x30');
  const [shelfStyle, setShelfStyle] = useState<LabelStyle>('brand');
  /** Batch selection for «یک برچسب برای هر قفسه» — starts with every shelf. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Keeps the hashchange listener fresh without re-subscribing per keystroke.
  const itemsRef = useRef<LabelItem[]>([]);
  const typeRef = useRef<BarcodeType>('ean13');
  itemsRef.current = items;
  typeRef.current = barcodeType;

  useEffect(() => {
    // Site logo and store name (from تنظیمات) replace the «س» mark and the
    // hard-coded store name on the label header.
    void api<{ data: Record<string, { name?: string; logoUrl?: string }> }>('/settings')
      .then((result) => {
        const profile = result.data['store.profile'];
        if (profile?.logoUrl) setLogoUrl(profile.logoUrl);
        if (profile?.name) setStoreName(profile.name);
      })
      .catch(() => undefined);
    api<{ data: LabelItem[] }>('/inventory/labels')
      .then((result) => {
        setItems(result.data);
        // Deep links: #/labels?item=<inventoryItemId> from the inventory
        // rows, or #/labels?product=<productId> from the products list.
        const params = paramsFromHash(window.location.hash);
        const initial =
          result.data.find((item) => item.id === params.item) ??
          result.data.find((item) => item.productId === params.product) ??
          result.data[0];
        if (initial) loadItem(initial, 'ean13');
      })
      .catch((error: Error) => setMessage(error.message));
    // Shelf labels read the same locations tree as «انبار و موجودی»: warehouses
    // group their shelves; every non-warehouse location becomes a labelable
    // shelf row carrying its warehouse name for the label chip.
    api<{ data: LocationNode[] }>('/locations')
      .then((result) => {
        const rows: ShelfRow[] = [];
        const walk = (nodes: LocationNode[], warehouse: string) => {
          for (const node of nodes) {
            if (node.type === 'warehouse') walk(node.children ?? [], node.name);
            else {
              rows.push({
                id: node.id,
                name: node.name,
                code: node.code,
                warehouse,
                items: node._count?.items ?? 0,
              });
              walk(node.children ?? [], warehouse);
            }
          }
        };
        walk(result.data, '');
        // Real warehouses first (alphabetically), legacy warehouse-less
        // shelves last — so the first preview and the first optgroup are a
        // proper shelf, not pre-grouping leftovers. numeric:true keeps the
        // shelf.row codes in human order (۱.۱ … ۲.۷ … ۱۰.۱ … ۲۰.۷).
        rows.sort(
          (a, b) =>
            Number(Boolean(b.warehouse)) - Number(Boolean(a.warehouse)) ||
            a.warehouse.localeCompare(b.warehouse, 'fa') ||
            a.code.localeCompare(b.code, 'en', { numeric: true }),
        );
        setShelves(rows);
        setPicked(new Set(rows.map((row) => row.id)));
        if (rows[0]) loadShelf(rows[0]);
      })
      .catch(() => undefined);
    const onHash = () => {
      const params = paramsFromHash(window.location.hash);
      const found =
        itemsRef.current.find((item) => item.id === params.item) ??
        itemsRef.current.find((item) => item.productId === params.product);
      if (found) loadItem(found, typeRef.current);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Fills every editable field from an inventory row — the one-click start. */
  const loadItem = (item: LabelItem, type: BarcodeType) => {
    setSelectedId(item.id);
    setName(item.name);
    setSku(item.sku);
    setCategory(item.category);
    setCars(item.vehicles);
    // EAN-13 prefers the real, scannable barcode of the inventory item;
    // Code 128 encodes the internal product code exactly.
    setCode(type === 'ean13' ? item.barcode || ean13FromSku(item.sku) : item.sku);
  };

  /** Fills the shelf-label fields from a location row — same one-click start. */
  const loadShelf = (row: ShelfRow) => {
    setSelectedShelfId(row.id);
    setShelfName(row.name);
    setShelfWarehouse(row.warehouse);
  };

  const filtered = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    if (!query) return items;
    return items.filter(
      (item) =>
        item.name.toLocaleLowerCase().includes(query) ||
        item.sku.toLocaleLowerCase().includes(query) ||
        item.barcode.includes(query),
    );
  }, [items, filter]);

  const options: LabelOptions = {
    name,
    sku,
    code,
    category,
    cars,
    size,
    style,
    type: barcodeType,
    showSku,
    showMeta,
    showFoot,
    storeName: labelHeader || storeName || undefined,
    footerText: labelFooter || undefined,
    logoUrl: logoUrl || undefined,
  };
  const currentHTML = renderLabelHTML(options);
  const selected = items.find((item) => item.id === selectedId);

  const printCount = Math.max(1, Math.min(200, Number(count) || 1));
  const printSheet = () => {
    const sheet = buildSheetHTML(Array.from({ length: printCount }, () => currentHTML));
    const frame = iframeRef.current;
    if (!frame) return;
    frame.srcdoc = sheet;
  };

  /* ——— تب برچسب قفسه‌ها ——— */
  const filteredShelves = useMemo(() => {
    const query = shelfFilter.trim().toLocaleLowerCase('fa');
    if (!query) return shelves;
    return shelves.filter(
      (row) =>
        row.name.toLocaleLowerCase('fa').includes(query) ||
        row.code.toLocaleLowerCase('en').includes(query) ||
        row.warehouse.toLocaleLowerCase('fa').includes(query),
    );
  }, [shelves, shelfFilter]);

  /** Shelves grouped by warehouse for the select and the batch checklist. */
  const shelfGroups = useMemo(() => {
    const map = new Map<string, ShelfRow[]>();
    for (const row of filteredShelves) {
      const key = row.warehouse || 'قفسه‌های بدون انبار';
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
    return [...map.entries()];
  }, [filteredShelves]);

  const selectedShelf = shelves.find((row) => row.id === selectedShelfId);
  const shelfOptions: ShelfLabelOptions = {
    name: shelfName,
    warehouse: shelfWarehouse,
    size: shelfSize,
    style: shelfStyle,
    storeName: labelHeader || storeName || undefined,
    logoUrl: logoUrl || undefined,
  };
  const currentShelfHTML = renderShelfLabelHTML(shelfOptions);

  /** One label per picked shelf — هر آدرس یک قفسه است، پس خروجی کلی یعنی
   * یک برچسب از هر قفسهٔ انتخابی، بدون نسخه‌های تکراری. */
  const pickedShelves = useMemo(
    () => shelves.filter((row) => picked.has(row.id)),
    [shelves, picked],
  );
  const printShelfBatch = () => {
    if (!pickedShelves.length) return;
    const sheet = buildSheetHTML(
      pickedShelves.map((row) =>
        renderShelfLabelHTML({
          ...shelfOptions,
          name: row.name,
          warehouse: row.warehouse,
        }),
      ),
    );
    const frame = iframeRef.current;
    if (!frame) return;
    frame.srcdoc = sheet;
  };
  const togglePicked = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sizeHint = labelSizes.find((entry) => entry.id === size)?.hint ?? '';
  const mm = SIZE_MM[size];

  return (
    <section className="labels-page">
      {/* برگهٔ چاپ در iframe مخفی: فونت و @page خودش را دارد و چاپ دقیقاً
          همان چیزی است که در پیش‌نمایش دیده می‌شود. */}
      <style>{LABEL_CSS}</style>
      <iframe
        ref={iframeRef}
        title="برگهٔ چاپ برچسب"
        className="lbl-print-frame"
        aria-hidden="true"
        tabIndex={-1}
      />

      <div className="page-title">
        <div>
          <h1>{tab === 'shelves' ? 'برچسب قفسه‌ها' : 'برچسب محصولات'}</h1>
          <p className="muted">
            {tab === 'shelves'
              ? 'برچسب نام هر قفسه بر اساس انبارها و قفسه‌های تعریف‌شده — چاپ کنید و روی قفسه نصب کنید.'
              : 'برچسب آماده برای هر کالای انبار — با بارکد قابل اسکن، در سه اندازه و سه سبک؛ انتخاب محصول، تعداد و چاپ برگهٔ A4.'}
          </p>
        </div>
        <div className="page-h-tools">
          {tab === 'shelves' ? (
            <>
              <span className="count">{persianDigits(shelves.length)} قفسه</span>
              <button
                className="button-primary"
                onClick={printShelfBatch}
                disabled={!pickedShelves.length}
              >
                ⎙ خروجی PDF قفسه‌ها ({persianDigits(pickedShelves.length)} قفسه)
              </button>
            </>
          ) : (
            <>
              <span className="count">{persianDigits(items.length)} کالا</span>
              <button className="button-primary" onClick={printSheet}>
                ⎙ چاپ برگهٔ A4 ({persianDigits(printCount)} برچسب)
              </button>
            </>
          )}
        </div>
      </div>

      <nav className="settings-tabs lbl-page-tabs" aria-label="بخش‌های برچسب">
        {labelTabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={tab === entry.id ? 'active' : ''}
            onClick={() => setTab(entry.id)}
          >
            <b>{entry.label}</b>
            <small>{entry.hint}</small>
          </button>
        ))}
      </nav>

      {message && <div className="notice">{message}</div>}

      {tab === 'products' && (
        <div className="labels-layout">
          {/* ——— تنظیمات ——— */}
          <aside className="lbl-side">
            <div className="lbl-card">
              <div className="lbl-card-h">
                <h3>تنظیمات برچسب</h3>
                <small>زنده</small>
              </div>
              <div className="lbl-card-b">
                <div className="lbl-field">
                  <label>انتخاب محصول از انبار</label>
                  <input
                    placeholder="جست‌وجوی نام، کد یا بارکد…"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                  />
                  <select
                    value={selectedId}
                    onChange={(event) => {
                      const item = items.find((row) => row.id === event.target.value);
                      if (item) loadItem(item, barcodeType);
                    }}
                  >
                    {filtered.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} — {item.sku}
                      </option>
                    ))}
                    {!filtered.length && <option value="">موردی پیدا نشد</option>}
                  </select>
                  {selected && (
                    <small className="lbl-hint">
                      برند {selected.brand} · موجودی {persianDigits(selected.quantity)} عدد
                      {selected.barcode ? ` · بارکد ${selected.barcode}` : ''}
                    </small>
                  )}
                </div>

                <div className="lbl-field">
                  <label>نام محصول</label>
                  <input value={name} onChange={(event) => setName(event.target.value)} />
                </div>
                <div className="lbl-field">
                  <label>کد محصول (SKU)</label>
                  <input
                    dir="ltr"
                    className="lbl-latin"
                    value={sku}
                    onChange={(event) => {
                      setSku(event.target.value);
                      if (barcodeType === 'code128') setCode(event.target.value);
                    }}
                  />
                </div>
                <div className="lbl-field">
                  <label>شمارهٔ بارکد</label>
                  <input
                    dir="ltr"
                    className="lbl-latin"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                  <small className="lbl-hint">
                    {barcodeType === 'ean13'
                      ? 'EAN-13 با رقم کنترلی خودکار؛ به‌طور پیش‌فرض همان بارکد واقعی کالا.'
                      : 'Code 128 مستقیماً همین متن را کدگذاری می‌کند.'}
                  </small>
                </div>
                <div className="lbl-field">
                  <label>دستهٔ‌بندی</label>
                  <input value={category} onChange={(event) => setCategory(event.target.value)} />
                </div>
                <div className="lbl-field">
                  <label>خودروهای سازگار</label>
                  <input value={cars} onChange={(event) => setCars(event.target.value)} />
                </div>

                <hr className="lbl-hr" />

                <div className="lbl-field">
                  <label>اندازهٔ برچسب</label>
                  <div className="seg lbl-seg">
                    {labelSizes.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={size === entry.id ? 'on' : ''}
                        title={entry.hint}
                        onClick={() => setSize(entry.id)}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                  <small className="lbl-hint">{sizeHint}</small>
                </div>
                <div className="lbl-field">
                  <label>سبک چاپ</label>
                  <div className="seg lbl-seg">
                    {labelStyles.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={style === entry.id ? 'on' : ''}
                        onClick={() => setStyle(entry.id)}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="lbl-field">
                  <label>نوع بارکد</label>
                  <div className="seg lbl-seg">
                    {barcodeTypes.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={barcodeType === entry.id ? 'on' : ''}
                        onClick={() => {
                          setBarcodeType(entry.id);
                          // Keep the code input in sync with the new type.
                          setCode(
                            entry.id === 'ean13' ? selected?.barcode || ean13FromSku(sku) : sku,
                          );
                        }}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </div>

                <hr className="lbl-hr" />
                <div className="lbl-field">
                  <label>عنوان سربرگ برچسب</label>
                  <input
                    value={labelHeader}
                    onChange={(e) => {
                      setLabelHeader(e.target.value);
                      localStorage.setItem('salimvand.labelHeader', e.target.value);
                    }}
                    placeholder="فروشگاه سلیم وند"
                  />
                </div>
                <div className="lbl-field">
                  <label>متن پانویس برچسب</label>
                  <input
                    value={labelFooter}
                    onChange={(e) => {
                      setLabelFooter(e.target.value);
                      localStorage.setItem('salimvand.labelFooter', e.target.value);
                    }}
                    placeholder="اصالت کالا"
                  />
                </div>

                <label className="lbl-chk">
                  <input
                    type="checkbox"
                    checked={showSku}
                    onChange={(event) => setShowSku(event.target.checked)}
                  />
                  نمایش کد محصول (SKU)
                </label>
                <label className="lbl-chk">
                  <input
                    type="checkbox"
                    checked={showMeta}
                    onChange={(event) => setShowMeta(event.target.checked)}
                  />
                  نمایش دسته و خودروی سازگار
                </label>
                <label className="lbl-chk">
                  <input
                    type="checkbox"
                    checked={showFoot}
                    onChange={(event) => setShowFoot(event.target.checked)}
                  />
                  نمایش پانویس (گارانتی)
                </label>

                <div className="lbl-field">
                  <label>تعداد در برگهٔ چاپ</label>
                  <FaNumberInput
                    className="lbl-latin"
                    group={false}
                    value={count}
                    onChange={(plain) => setCount(plain)}
                  />
                  <small className="lbl-hint">
                    برگهٔ چاپ روی A4 با حاشیهٔ ۸ میلی‌متر و فاصلهٔ ۲ میلی‌متر چیده می‌شود؛ برای
                    چاپگر لیبل‌زن حرارتی سبک «تک‌رنگ» و اندازهٔ دقیق رول را انتخاب کنید. هنگام چاپ،
                    مقیاس را روی ۱۰۰٪ بگذارید.
                  </small>
                </div>
                <button className="button-primary lbl-print-inline" onClick={printSheet}>
                  ⎙ چاپ برگهٔ A4 ({persianDigits(printCount)} برچسب)
                </button>
              </div>
            </div>
          </aside>

          {/* ——— پیش‌نمایش ——— */}
          <main className="lbl-main">
            <div className="lbl-card">
              <div className="lbl-card-h">
                <h3>پیش‌نمایش زنده</h3>
                <div className="lbl-zoom-btns">
                  {ZOOMS.map((factor) => (
                    <button
                      key={factor}
                      type="button"
                      className={`lbl-zoom-btn${zoom === factor ? ' on' : ''}`}
                      onClick={() => setZoom(factor)}
                    >
                      {persianDigits(factor)}×
                    </button>
                  ))}
                </div>
              </div>
              <div className="lbl-card-b">
                <div className="lbl-stage">
                  <div className="lbl-zoomwrap">
                    <div
                      className="lbl-zoombox"
                      style={{
                        width: `${mm.w * MM_PX * zoom}px`,
                        height: `${mm.h * MM_PX * zoom}px`,
                      }}
                    >
                      <div
                        className="lbl-zoom"
                        style={{ transform: `scale(${zoom})` }}
                        dangerouslySetInnerHTML={{ __html: currentHTML }}
                      />
                    </div>
                    <small className="lbl-spec">
                      {labelSizes.find((entry) => entry.id === size)?.label} میلی‌متر · بزرگ‌نمایی{' '}
                      {persianDigits(zoom)}× · {barcodeType === 'ean13' ? 'EAN-13' : 'Code 128'} ·{' '}
                      {labelStyles.find((entry) => entry.id === style)?.label}
                    </small>
                  </div>
                </div>
              </div>
            </div>

            <div className="lbl-card">
              <div className="lbl-card-h">
                <h3>هر سه اندازه در مقیاس واقعی (۱:۱)</h3>
                <small>۵۰×۳۰ · ۶۰×۴۰ · ۳۸×۲۲ میلی‌متر</small>
              </div>
              <div className="lbl-card-b">
                <div className="lbl-stage">
                  {labelSizes.map((entry) => (
                    <div className="lbl-zoomwrap" key={entry.id}>
                      <div
                        dangerouslySetInnerHTML={{
                          __html: renderLabelHTML({ ...options, size: entry.id }),
                        }}
                      />
                      <small className="lbl-spec">{entry.label} میلی‌متر</small>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="lbl-card">
              <div className="lbl-card-h">
                <h3>سه سبک چاپ</h3>
                <small>برند · تک‌رنگ · ناوی</small>
              </div>
              <div className="lbl-card-b">
                <div className="lbl-stage">
                  {labelStyles.map((entry) => (
                    <div className="lbl-zoomwrap" key={entry.id}>
                      <div
                        dangerouslySetInnerHTML={{
                          __html: renderLabelHTML({ ...options, style: entry.id }),
                        }}
                      />
                      <small className="lbl-spec">{entry.label}</small>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <p className="lbl-foot-note">
              بارکد به‌صورت SVG برداری رسم می‌شود تا در چاپ لبه‌ها تیز بماند؛ در سبک «ناوی» بارکد
              روی کادر سفید می‌ماند تا اسکن‌پذیر بماند. آدرس <span dir="ltr">{STORE_SITE}</span> روی
              همهٔ برچسب‌ها درج می‌شود.
            </p>
          </main>
        </div>
      )}

      {tab === 'shelves' && (
        <div className="labels-layout">
          {/* ——— تنظیمات برچسب قفسه ——— */}
          <aside className="lbl-side">
            <div className="lbl-card">
              <div className="lbl-card-h">
                <h3>تنظیمات برچسب قفسه</h3>
                <small>زنده</small>
              </div>
              <div className="lbl-card-b">
                <div className="lbl-field">
                  <label>انتخاب قفسه از انبار</label>
                  <input
                    placeholder="جست‌وجوی نام، کد یا انبار…"
                    value={shelfFilter}
                    onChange={(event) => setShelfFilter(event.target.value)}
                  />
                  <select
                    value={selectedShelfId}
                    onChange={(event) => {
                      const row = shelves.find((entry) => entry.id === event.target.value);
                      if (row) loadShelf(row);
                    }}
                  >
                    {shelfGroups.map(([warehouse, rows]) => (
                      <optgroup key={warehouse} label={warehouse}>
                        {rows.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name} — {row.code}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    {!shelves.length && <option value="">قفسه‌ای ثبت نشده است</option>}
                  </select>
                  {selectedShelf && (
                    <small className="lbl-hint">
                      {selectedShelf.warehouse || 'بدون انبار'} ·{' '}
                      {persianDigits(selectedShelf.items)} کالا روی این قفسه
                    </small>
                  )}
                </div>

                <div className="lbl-field">
                  <label>نام قفسه</label>
                  <input value={shelfName} onChange={(event) => setShelfName(event.target.value)} />
                </div>
                <div className="lbl-field">
                  <label>انبار / گروه</label>
                  <input
                    value={shelfWarehouse}
                    onChange={(event) => setShelfWarehouse(event.target.value)}
                  />
                </div>

                <hr className="lbl-hr" />

                <div className="lbl-field">
                  <label>اندازهٔ برچسب</label>
                  <div className="seg lbl-seg">
                    {labelSizes.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        title={entry.hint}
                        className={shelfSize === entry.id ? 'on' : ''}
                        onClick={() => setShelfSize(entry.id)}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                  <small className="lbl-hint">
                    {labelSizes.find((entry) => entry.id === shelfSize)?.hint ?? ''}
                  </small>
                </div>
                <div className="lbl-field">
                  <label>سبک چاپ</label>
                  <div className="seg lbl-seg">
                    {labelStyles.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={shelfStyle === entry.id ? 'on' : ''}
                        onClick={() => setShelfStyle(entry.id)}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </div>

                <hr className="lbl-hr" />

                <div className="lbl-field">
                  <label>خروجی کلی — یک برچسب برای هر قفسه</label>
                  <div className="sl-pick-head">
                    <button
                      type="button"
                      onClick={() => setPicked(new Set(shelves.map((row) => row.id)))}
                    >
                      انتخاب همه
                    </button>
                    <button type="button" onClick={() => setPicked(new Set())}>
                      پاک کردن
                    </button>
                    <span>
                      {persianDigits(pickedShelves.length)} از {persianDigits(shelves.length)}
                    </span>
                  </div>
                  <div className="sl-pick-list">
                    {shelfGroups.map(([warehouse, rows]) => (
                      <div key={warehouse}>
                        <small className="sl-pick-group">{warehouse}</small>
                        {rows.map((row) => (
                          <label key={row.id} className="sl-pick-row">
                            <input
                              type="checkbox"
                              checked={picked.has(row.id)}
                              onChange={() => togglePicked(row.id)}
                            />
                            <span>{row.name}</span>
                            <b dir="ltr">{row.code}</b>
                          </label>
                        ))}
                      </div>
                    ))}
                    {!shelves.length && (
                      <small className="lbl-hint">
                        هنوز قفسه‌ای ثبت نشده؛ از «انبار و موجودی ← قفسه‌ها» اضافه کنید.
                      </small>
                    )}
                  </div>
                  <small className="lbl-hint">
                    هر قفسه فقط یک برچسب می‌گیرد (برخلاف کالاها، نسخهٔ تکراری ندارد)؛ برچسب‌ها از
                    نام و انبار خود قفسه‌ها ساخته می‌شوند.
                  </small>
                  <button
                    className="button-primary lbl-print-inline"
                    onClick={printShelfBatch}
                    disabled={!pickedShelves.length}
                  >
                    ⎙ خروجی PDF قفسه‌ها ({persianDigits(pickedShelves.length)} برچسب)
                  </button>
                </div>
              </div>
            </div>
          </aside>

          {/* ——— پیش‌نمایش برچسب قفسه ——— */}
          <main className="lbl-main">
            <div className="lbl-card">
              <div className="lbl-card-h">
                <h3>پیش‌نمایش زنده</h3>
                <div className="lbl-zoom-btns">
                  {ZOOMS.map((factor) => (
                    <button
                      key={factor}
                      type="button"
                      className={`lbl-zoom-btn${zoom === factor ? ' on' : ''}`}
                      onClick={() => setZoom(factor)}
                    >
                      {persianDigits(factor)}×
                    </button>
                  ))}
                </div>
              </div>
              <div className="lbl-card-b">
                <div className="lbl-stage">
                  <div className="lbl-zoomwrap">
                    <div
                      className="lbl-zoombox"
                      style={{
                        width: `${SIZE_MM[shelfSize].w * MM_PX * zoom}px`,
                        height: `${SIZE_MM[shelfSize].h * MM_PX * zoom}px`,
                      }}
                    >
                      <div
                        className="lbl-zoom"
                        style={{ transform: `scale(${zoom})` }}
                        dangerouslySetInnerHTML={{ __html: currentShelfHTML }}
                      />
                    </div>
                    <small className="lbl-spec">
                      {labelSizes.find((entry) => entry.id === shelfSize)?.label} میلی‌متر ·
                      بزرگ‌نمایی {persianDigits(zoom)}× ·{' '}
                      {labelStyles.find((entry) => entry.id === shelfStyle)?.label}
                    </small>
                  </div>
                </div>
              </div>
            </div>

            <div className="lbl-card">
              <div className="lbl-card-h">
                <h3>همهٔ اندازه‌ها در مقیاس واقعی (۱:۱)</h3>
                <small>۵۰×۳۰ · ۶۰×۴۰ · ۴۰×۶۰ · ۳۸×۲۲ میلی‌متر</small>
              </div>
              <div className="lbl-card-b">
                <div className="lbl-stage">
                  {labelSizes.map((entry) => (
                    <div className="lbl-zoomwrap" key={entry.id}>
                      <div
                        dangerouslySetInnerHTML={{
                          __html: renderShelfLabelHTML({ ...shelfOptions, size: entry.id }),
                        }}
                      />
                      <small className="lbl-spec">{entry.label} میلی‌متر</small>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="lbl-card">
              <div className="lbl-card-h">
                <h3>سه سبک چاپ</h3>
                <small>برند · تک‌رنگ · ناوی</small>
              </div>
              <div className="lbl-card-b">
                <div className="lbl-stage">
                  {labelStyles.map((entry) => (
                    <div className="lbl-zoomwrap" key={entry.id}>
                      <div
                        dangerouslySetInnerHTML={{
                          __html: renderShelfLabelHTML({ ...shelfOptions, style: entry.id }),
                        }}
                      />
                      <small className="lbl-spec">{entry.label}</small>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <p className="lbl-foot-note">
              برچسب قفسه از همان قفسه‌هایی ساخته می‌شود که در «انبار و موجودی ← قفسه‌ها» تعریف
              کرده‌اید — فقط نام قفسه و انبار آن، با درشت‌ترین فونت ممکن. آدرس{' '}
              <span dir="ltr">{STORE_SITE}</span> روی همهٔ برچسب‌ها درج می‌شود.
            </p>
          </main>
        </div>
      )}
    </section>
  );
}
