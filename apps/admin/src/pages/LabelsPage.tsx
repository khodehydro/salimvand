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
  type BarcodeType,
  type LabelOptions,
  type LabelSize,
  type LabelStyle,
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

export function LabelsPage() {
  const [items, setItems] = useState<LabelItem[]>([]);
  const [message, setMessage] = useState('');
  /** Site identity from settings: logo + store name go on every label. */
  const [logoUrl, setLogoUrl] = useState('');
  const [storeName, setStoreName] = useState('');
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
    storeName: storeName || undefined,
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
          <h1>برچسب محصولات</h1>
          <p className="muted">
            برچسب آماده برای هر کالای انبار — با بارکد قابل اسکن، در سه اندازه و سه سبک؛ انتخاب
            محصول، تعداد و چاپ برگهٔ A4.
          </p>
        </div>
        <div className="page-h-tools">
          <span className="count">{persianDigits(items.length)} کالا</span>
          <button className="button-primary" onClick={printSheet}>
            ⎙ چاپ برگهٔ A4 ({persianDigits(printCount)} برچسب)
          </button>
        </div>
      </div>

      {message && <div className="notice">{message}</div>}

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
                  برگهٔ چاپ روی A4 با حاشیهٔ ۸ میلی‌متر و فاصلهٔ ۲ میلی‌متر چیده می‌شود؛ برای چاپگر
                  لیبل‌زن حرارتی سبک «تک‌رنگ» و اندازهٔ دقیق رول را انتخاب کنید. هنگام چاپ، مقیاس را
                  روی ۱۰۰٪ بگذارید.
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
            بارکد به‌صورت SVG برداری رسم می‌شود تا در چاپ لبه‌ها تیز بماند؛ در سبک «ناوی» بارکد روی
            کادر سفید می‌ماند تا اسکن‌پذیر بماند. آدرس <span dir="ltr">{STORE_SITE}</span> روی همهٔ
            برچسب‌ها درج می‌شود.
          </p>
        </main>
      </div>
    </section>
  );
}
