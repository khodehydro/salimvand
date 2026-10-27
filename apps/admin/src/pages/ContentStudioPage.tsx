import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_STUDIO_SETTINGS,
  STUDIO_FORMATS,
  formatPersianNumber,
  formatRial,
  parseStudioSettings,
  studioFolder,
  studioFrames,
  studioPrice,
  type StudioFilter,
  type StudioFormat,
  type StudioOptions,
  type StudioSettings,
  type StudioSnapshot,
} from '@salimvand/shared';
import { api } from '../lib/api';
import './content-studio.css';
const PREFS = 'salimvand.content-studio.preferences.v1';
const initial = () => {
  try {
    return parseStudioSettings(JSON.parse(localStorage.getItem(PREFS) || 'null'));
  } catch {
    return parseStudioSettings(null);
  }
};
const abortError = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';
export default function ContentStudioPage() {
  const [settings, setSettings] = useState<StudioSettings>(initial);
  const [options, setOptions] = useState<StudioOptions | null>(null);
  const [filter, setFilter] = useState({
    categoryId: '',
    vehicleMakeId: '',
    vehicleModelId: '',
    brandId: '',
    q: '',
    inStock: false,
  });
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [order, setOrder] = useState<string[]>([]),
    [chosen, setChosen] = useState<string[]>([]);
  const [variants, setVariants] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0),
    [optionReload, setOptionReload] = useState(0);
  const [previewIndex, setPreviewIndex] = useState(0),
    [previewFormat, setPreviewFormat] = useState<StudioFormat>('portrait');
  const [previewBusy, setPreviewBusy] = useState(false),
    [previewError, setPreviewError] = useState(''),
    [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState({ done: 0, total: 0 });
  const preview = useRef<HTMLDivElement>(null),
    exportAbort = useRef<AbortController>(),
    exporting = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      exportAbort.current?.abort();
    };
  }, []);
  const update = <K extends keyof StudioSettings>(key: K, value: StudioSettings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
    setNotice('');
  };
  useEffect(() => {
    const controller = new AbortController();
    api<{ data: StudioOptions }>('/content-studio/options', { signal: controller.signal })
      .then((r) => {
        if (!controller.signal.aborted) setOptions(r.data);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [optionReload]);
  const request = useMemo<StudioFilter>(
    () => ({
      ...Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== '')),
      showPrices: settings.showPrices,
    }),
    [filter, settings.showPrices],
  );
  const requestKey = JSON.stringify(request);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      void api<{ data: StudioSnapshot }>('/content-studio/snapshot', {
        method: 'POST',
        body: JSON.stringify(request),
        signal: controller.signal,
      })
        .then((r) => {
          if (controller.signal.aborted) return;
          setSnapshot(r.data);
          setLoadedKey(requestKey);
          setOrder(r.data.products.map((p) => p.id));
          setChosen(r.data.products.map((p) => p.id));
          setVariants({});
          setPreviewIndex(0);
        })
        .catch((e: Error) => {
          if (!controller.signal.aborted) {
            setSnapshot(null);
            setError(e.message);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, reload]); // requestKey is the full serialized request; avoids identity-driven refetches.
  const category = options?.categories.find((c) => c.id === filter.categoryId)?.name;
  const makes = [
    ...new Map(
      (options?.vehicles || []).filter((v) => v.make.id).map((v) => [v.make.id!, v.make]),
    ).values(),
  ];
  const make = makes.find((m) => m.id === filter.vehicleMakeId);
  const vehicle = options?.vehicles.find((v) => v.id === filter.vehicleModelId);
  const autoTitle =
    category ||
    (vehicle
      ? `قطعات ${vehicle.make.name} ${vehicle.name}`
      : make
        ? `قطعات ${make.name}`
        : 'منتخب قطعات خودرو');
  const resolvedSettings = useMemo(
    () =>
      parseStudioSettings({
        ...settings,
        title: settings.title.trim() || (settings.mode === 'single' ? '' : autoTitle),
      }),
    [settings, autoTitle],
  );
  const ready = !!snapshot && loadedKey === requestKey && !loading;
  const selected = useMemo(() => {
    if (!snapshot) return [];
    const byId = new Map(snapshot.products.map((p) => [p.id, p])),
      included = new Set(chosen);
    return order.filter((id) => included.has(id) && byId.has(id)).map((id) => byId.get(id)!);
  }, [snapshot, order, chosen]);
  const frames = useMemo(
    () => studioFrames(selected, resolvedSettings),
    [selected, resolvedSettings],
  );
  const frameIndex = Math.min(previewIndex, Math.max(0, frames.length - 1));
  const format = settings.formats.includes(previewFormat) ? previewFormat : settings.formats[0];
  useEffect(() => {
    if (!ready || !snapshot || !frames.length) {
      preview.current?.replaceChildren();
      setPreviewBusy(false);
      setPreviewError('');
      setWarnings([]);
      return;
    }
    const controller = new AbortController();
    let renderer: import('../lib/content-studio/render').StudioRenderer | undefined,
      canvas: HTMLCanvasElement | undefined;
    setPreviewBusy(true);
    setPreviewError('');
    setWarnings([]);
    const timer = setTimeout(() => {
      void import('../lib/content-studio/render')
        .then(async ({ StudioRenderer }) => {
          if (controller.signal.aborted) return;
          renderer = new StudioRenderer(controller.signal);
          canvas = await renderer.render(
            frames[frameIndex],
            format,
            snapshot,
            resolvedSettings,
            variants,
          );
          if (!controller.signal.aborted) {
            canvas.setAttribute('role', 'img');
            canvas.setAttribute('aria-label', `پیش‌نمایش تصویر ${frameIndex + 1}`);
            preview.current?.replaceChildren(canvas);
            setWarnings([...renderer.warnings]);
          }
        })
        .catch((e: Error) => {
          if (!controller.signal.aborted) setPreviewError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreviewBusy(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
      renderer?.dispose();
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, [ready, frames, frameIndex, format, snapshot, resolvedSettings, variants]);
  const save = () => {
    try {
      localStorage.setItem(PREFS, JSON.stringify(parseStudioSettings(settings)));
      setNotice('تنظیمات طرح در همین مرورگر ذخیره شد؛ محصولات و قیمت‌ها ذخیره نمی‌شوند.');
    } catch {
      setError('ذخیره در مرورگر در دسترس نیست');
    }
  };
  const move = (id: string, delta: number) =>
    setOrder((list) => {
      const result = [...list],
        from = result.indexOf(id),
        to = from + delta;
      if (from >= 0 && to >= 0 && to < list.length)
        [result[from], result[to]] = [result[to], result[from]];
      return result;
    });
  const generate = async () => {
    if (exporting.current || !ready || !selected.length || !snapshot) return;
    exporting.current = true;
    const controller = new AbortController();
    exportAbort.current = controller;
    setBusy(true);
    setError('');
    setNotice('');
    setProgress({ done: 0, total: frames.length * settings.formats.length });
    try {
      // Refresh at export time. Never silently export a deleted/hidden product or stale brand choice.
      const fresh = await api<{ data: StudioSnapshot }>('/content-studio/snapshot', {
        method: 'POST',
        body: JSON.stringify({ ...request, productIds: selected.map((p) => p.id) }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const byId = new Map(fresh.data.products.map((p) => [p.id, p]));
      if (byId.size !== selected.length || selected.some((p) => !byId.has(p.id)))
        throw new Error('بعضی محصولات حذف، مخفی یا ناموجود شده‌اند؛ فهرست را دوباره دریافت کنید.');
      const output = { ...fresh.data, products: selected.map((p) => byId.get(p.id)!) };
      const { exportStudio, saveStudioBlob } = await import('../lib/content-studio/export');
      const result = await exportStudio(
        output,
        resolvedSettings,
        variants,
        category || autoTitle,
        controller.signal,
        (done, total) => {
          if (mounted.current) setProgress({ done, total });
        },
      );
      if (controller.signal.aborted || !mounted.current) return;
      saveStudioBlob(result.blob, result.filename);
      setSnapshot((s) =>
        s
          ? {
              ...s,
              capturedAt: fresh.data.capturedAt,
              branding: fresh.data.branding,
              products: s.products.map((p) => byId.get(p.id) || p),
            }
          : s,
      );
      setNotice(
        `فایل ZIP ساخته شد؛ دانلود مرورگر را بررسی کنید.${result.warnings.length ? ' بعضی تصاویر با جای‌نگهدار ساخته شدند.' : ''}`,
      );
    } catch (e) {
      if (mounted.current) {
        if (controller.signal.aborted || abortError(e))
          setNotice('عملیات لغو شد؛ فایل ناقص دانلود نمی‌شود.');
        else setError(e instanceof Error ? e.message : 'ساخت خروجی انجام نشد');
      }
    } finally {
      exporting.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const booleanFields: [
    keyof Pick<
      StudioSettings,
      | 'cover'
      | 'showCode'
      | 'showBrands'
      | 'showAvailability'
      | 'showVehicles'
      | 'showContacts'
      | 'showAddress'
      | 'showDate'
      | 'allowMissingImages'
      | 'trimImages'
    >,
    string,
  ][] = [
    ['cover', 'جلد شاخص در ابتدای مجموعه'],
    ['showCode', 'کد محصول'],
    ['showBrands', 'برند محصول'],
    ['showAvailability', 'موجودی دوحالته'],
    ['showVehicles', 'نام خودروها و سازگاری محصول'],
    ['showContacts', 'تلفن، سایت و کانال‌ها'],
    ['showAddress', 'آدرس فروشگاه'],
    ['showDate', 'تاریخ دریافت قیمت و اطلاعات'],
    ['trimImages', 'یکسان‌سازی کادر عکس‌ها و حذف حاشیهٔ اضافی، فقط در خروجی'],
    ['allowMissingImages', 'اجازهٔ خروجی با جای‌نگهدارِ تصاویر ناموجود'],
  ];
  return (
    <section className="content-studio" aria-label="استودیوی تولید محتوا">
      <header className="cs-hero">
        <div>
          <span className="cs-eyebrow">CONTENT STUDIO</span>
          <h1>از کاتالوگ، تا محتوای آمادهٔ انتشار.</h1>
          <p>
            طرح‌های یکپارچه برای اینستاگرام و تیک‌تاک؛ با عکس واقعی، اطلاعات زنده و هویت فروشگاه.
          </p>
        </div>
        <span className="cs-hero-badge">عکس · بدون انتشار خودکار</span>
      </header>
      {error && (
        <div className="cs-message cs-error" role="alert">
          {error}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setReload((n) => n + 1);
              setOptionReload((n) => n + 1);
            }}
          >
            تلاش دوباره
          </button>
        </div>
      )}
      {notice && (
        <p className="cs-message" role="status">
          {notice}
        </p>
      )}
      <div className="cs-workspace">
        <div className="cs-controls">
          <fieldset className="cs-panel" disabled={busy}>
            <legend>
              <b>۱</b> چه محصولاتی؟
            </legend>
            <label>
              دسته‌بندی و زیرشاخه‌ها
              <select
                value={filter.categoryId}
                onChange={(e) => setFilter((f) => ({ ...f, categoryId: e.target.value }))}
              >
                <option value="">همهٔ دسته‌بندی‌ها</option>
                {options?.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parentId ? '↳ ' : ''}
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              خانواده / سازندهٔ خودرو
              <select
                value={filter.vehicleMakeId}
                onChange={(e) =>
                  setFilter((f) => ({ ...f, vehicleMakeId: e.target.value, vehicleModelId: '' }))
                }
              >
                <option value="">همهٔ خانواده‌ها</option>
                {makes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              گروه خودرویی
              <select
                value={filter.vehicleModelId}
                onChange={(e) => setFilter((f) => ({ ...f, vehicleModelId: e.target.value }))}
              >
                <option value="">همهٔ خودروها</option>
                {options?.vehicles
                  .filter((v) => !filter.vehicleMakeId || v.make.id === filter.vehicleMakeId)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.make.name} · {v.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              برند قطعه
              <select
                value={filter.brandId}
                onChange={(e) => setFilter((f) => ({ ...f, brandId: e.target.value }))}
              >
                <option value="">همهٔ برندها</option>
                {options?.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              جست‌وجوی نام، کد یا شمارهٔ فنی
              <input
                value={filter.q}
                maxLength={100}
                onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
                placeholder="مثلاً آبگیر یا کد محصول"
              />
            </label>
            <label className="cs-check">
              <input
                type="checkbox"
                checked={filter.inStock}
                onChange={(e) => setFilter((f) => ({ ...f, inStock: e.target.checked }))}
              />
              فقط محصولات موجود
            </label>
            <p className="cs-hint">
              فیلترهای دسته، خودرو و برند با هم ترکیب می‌شوند. هر خروجی حداکثر ۳۰۰ محصول دارد.
            </p>
          </fieldset>
          <fieldset className="cs-panel" disabled={busy}>
            <legend>
              <b>۲</b> قالب و اندازه
            </legend>
            <div className="cs-presets">
              <button
                type="button"
                onClick={() =>
                  setSettings((s) => ({ ...s, mode: 'carousel', formats: ['portrait'] }))
                }
              >
                پست چنداسلایدی
              </button>
              <button
                type="button"
                onClick={() => setSettings((s) => ({ ...s, mode: 'single', formats: ['story'] }))}
              >
                استوری تک‌محصول
              </button>
              <button
                type="button"
                onClick={() => setSettings((s) => ({ ...s, mode: 'carousel', formats: ['story'] }))}
              >
                استوری دسته / خودرو
              </button>
            </div>
            <label>
              نوع چیدمان
              <select
                value={settings.mode}
                onChange={(e) => update('mode', e.target.value as StudioSettings['mode'])}
              >
                <option value="carousel">جلد + فهرست محصولات</option>
                <option value="single">یک تصویر مستقل برای هر محصول</option>
              </select>
            </label>
            <label>
              تعداد اقلام در هر صفحه
              <select
                value={settings.perPage}
                disabled={settings.mode === 'single'}
                onChange={(e) =>
                  update('perPage', Number(e.target.value) as StudioSettings['perPage'])
                }
              >
                {[3, 4, 6].map((n) => (
                  <option key={n} value={n}>
                    {formatPersianNumber(n)} محصول
                  </option>
                ))}
              </select>
            </label>
            <div className="cs-sizes">
              {Object.entries(STUDIO_FORMATS).map(([key, size]) => (
                <label className="cs-check" key={key}>
                  <input
                    type="checkbox"
                    checked={settings.formats.includes(key as StudioFormat)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...settings.formats, key as StudioFormat]
                        : settings.formats.filter((f) => f !== key);
                      if (next.length) update('formats', next);
                    }}
                  />
                  {size.label}
                  <small dir="ltr">
                    {size.width} × {size.height}
                  </small>
                </label>
              ))}
            </div>
            <p className="cs-hint">
              قاب ۹:۱۶ برای استوری و پست تصویری تیک‌تاک است؛ خروجی ویدئو نیست. برای مجموعه‌های بزرگ،
              تصاویر را در چند پست منتشر کنید.
            </p>
          </fieldset>
          <fieldset className="cs-panel" disabled={busy}>
            <legend>
              <b>۳</b> متن و هویت طرح
            </legend>
            <label>
              عنوان مجموعه
              <input
                value={settings.title}
                placeholder={autoTitle}
                maxLength={96}
                onChange={(e) => update('title', e.target.value)}
              />
            </label>
            <label>
              زیرعنوان
              <input
                value={settings.subtitle}
                maxLength={160}
                onChange={(e) => update('subtitle', e.target.value)}
              />
            </label>
            <label>
              متن دعوت به ارتباط
              <input
                value={settings.cta}
                maxLength={96}
                onChange={(e) => update('cta', e.target.value)}
              />
            </label>
            <label>
              نام انگلیسی خودروهای تحت پوشش
              <textarea
                dir="ltr"
                value={settings.vehicles}
                maxLength={240}
                rows={3}
                onChange={(e) => update('vehicles', e.target.value)}
              />
            </label>
            <label>
              رنگ تأکیدی
              <select
                value={settings.accent}
                onChange={(e) => update('accent', e.target.value as StudioSettings['accent'])}
              >
                <option value="green">سبز</option>
                <option value="gold">طلایی</option>
                <option value="blue">آبی</option>
              </select>
            </label>
            <p className="cs-hint">
              پایهٔ همهٔ قالب‌ها سرمه‌ای تیره و سفید است. لوگو و تماس‌ها از تنظیمات فعلی فروشگاه
              می‌آیند؛ خودروهای انگلیسی را متناسب با فروشگاه ویرایش کنید.
            </p>
          </fieldset>
          <fieldset className="cs-panel" disabled={busy}>
            <legend>
              <b>۴</b> جزئیات خروجی
            </legend>
            <label className="cs-price-switch">
              <input
                type="checkbox"
                checked={settings.showPrices}
                onChange={(e) => update('showPrices', e.target.checked)}
              />
              نمایش قیمت فروش در تصاویر
            </label>
            <p className="cs-hint">
              {settings.showPrices
                ? 'انتخاب صریح مدیر: قیمت فروش به ریال در فایل منتشر می‌شود، حتی اگر قیمت سایت مخفی باشد. قیمت خرید هرگز خوانده نمی‌شود.'
                : 'در همهٔ تصاویر «استعلام قیمت» نمایش داده می‌شود و API هیچ مبلغی برنمی‌گرداند.'}
            </p>
            {booleanFields.map(([key, label]) => (
              <label className="cs-check" key={key}>
                <input
                  type="checkbox"
                  checked={settings[key]}
                  disabled={key === 'cover' && settings.mode === 'single'}
                  onChange={(e) => update(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
            <div className="cs-actions">
              <button type="button" onClick={save}>
                ذخیرهٔ تنظیمات طرح
              </button>
              <button
                type="button"
                onClick={() => setSettings(parseStudioSettings(DEFAULT_STUDIO_SETTINGS))}
              >
                بازنشانی طرح
              </button>
            </div>
          </fieldset>
        </div>
        <div className="cs-output">
          <section className="cs-panel cs-preview-panel">
            <div className="cs-section-title">
              <div>
                <span className="cs-eyebrow">LIVE PREVIEW</span>
                <h2>پیش‌نمایش خروجی واقعی</h2>
              </div>
              <select
                aria-label="اندازهٔ پیش‌نمایش"
                value={format}
                onChange={(e) => setPreviewFormat(e.target.value as StudioFormat)}
              >
                {settings.formats.map((f) => (
                  <option key={f} value={f}>
                    {STUDIO_FORMATS[f].label}
                  </option>
                ))}
              </select>
            </div>
            <div
              className={`cs-preview-stage ${format === 'story' ? 'vertical' : ''}`}
              aria-busy={previewBusy || !ready}
            >
              <div ref={preview} className="cs-canvas" />
              {(loading || previewBusy || !ready) && !error && (
                <div className="cs-preview-loading" role="status">
                  در حال آماده‌سازی پیش‌نمایش…
                </div>
              )}
              {ready && !frames.length && <p>برای دیدن طرح، حداقل یک محصول را انتخاب کنید.</p>}
              {previewError && (
                <p role="alert" className="cs-error">
                  {previewError}
                </p>
              )}
            </div>
            <div className="cs-preview-nav">
              <button
                type="button"
                disabled={busy || !frameIndex}
                onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
              >
                تصویر قبل
              </button>
              <span>
                تصویر {formatPersianNumber(frames.length ? frameIndex + 1 : 0)} از{' '}
                {formatPersianNumber(frames.length)}
              </span>
              <button
                type="button"
                disabled={busy || frameIndex >= frames.length - 1}
                onClick={() => setPreviewIndex((i) => i + 1)}
              >
                تصویر بعد
              </button>
            </div>
            {warnings.length > 0 && (
              <div className="cs-warning" role="status">
                {warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </div>
            )}
            {snapshot && !snapshot.branding.logo && (
              <p className="cs-hint">
                لوگوی فروشگاه تنظیم نشده؛ فعلاً نام فروشگاه نمایش داده می‌شود. لوگو را در تنظیمات
                فروشگاه ثبت کنید.
              </p>
            )}
            <p className="cs-hint">
              تلفن و کانال خالی در تنظیمات، در تصویر نمایش داده نمی‌شود. قاب استوری حاشیهٔ امن بالا
              و پایین دارد؛ قبل از انتشار، پوشانده‌نشدن اطلاعات با رابط کلاینت را بررسی کنید.
            </p>
          </section>
          <section className="cs-panel cs-download">
            <div>
              <h2>خروجی شماره‌گذاری‌شده</h2>
              <p>
                {formatPersianNumber(selected.length)} محصول ·{' '}
                {formatPersianNumber(frames.length * settings.formats.length)} تصویر · پوشهٔ{' '}
                <b>{studioFolder(category || autoTitle)}</b>
              </p>
            </div>
            {busy ? (
              <>
                <progress max={Math.max(1, progress.total)} value={progress.done} />
                <p role="status">
                  ساخت تصویر {formatPersianNumber(progress.done)} از{' '}
                  {formatPersianNumber(progress.total)} — این صفحه را باز نگه دارید.
                </p>
                <button type="button" onClick={() => exportAbort.current?.abort()}>
                  لغو ساخت
                </button>
              </>
            ) : (
              <button
                type="button"
                className="cs-generate"
                disabled={!ready || !selected.length || !!previewError}
                onClick={() => void generate()}
              >
                ساخت و دانلود همهٔ تصاویر ZIP
              </button>
            )}
            <p className="cs-hint">
              اطلاعات هنگام خروجی دوباره دریافت می‌شوند. تصاویر مرحله‌ای در مرورگر ساخته می‌شوند؛
              هیچ پیامی خودکار منتشر نمی‌شود و تصاویر اصلی محصولات تغییر نمی‌کنند.
            </p>
          </section>
          <section className="cs-panel">
            <div className="cs-section-title">
              <h2>انتخاب و ترتیب محصولات</h2>
              <div className="cs-actions">
                <button
                  type="button"
                  disabled={busy || !ready}
                  onClick={() => setChosen([...order])}
                >
                  انتخاب همه
                </button>
                <button type="button" disabled={busy || !ready} onClick={() => setChosen([])}>
                  پاک کردن انتخاب
                </button>
                <button
                  type="button"
                  disabled={busy || loading}
                  onClick={() => setReload((n) => n + 1)}
                >
                  دریافت دوباره
                </button>
              </div>
            </div>
            <p className="cs-hint">
              ترتیب این فهرست، ترتیب تصاویر است. برند «خودکار» کمترین قیمت فروش مثبتِ برندهای موجود
              را ترجیح می‌دهد و برای چند برند برچسب «از» می‌زند؛ بدون قیمت معتبر، «استعلام» درج
              می‌شود.
            </p>
            {ready && snapshot && (
              <div className="cs-products">
                {order.map((id, index) => {
                  const p = snapshot.products.find((p) => p.id === id)!;
                  const price = studioPrice(p, variants[id]);
                  return (
                    <div key={id} className={`cs-product ${chosen.includes(id) ? '' : 'excluded'}`}>
                      <input
                        type="checkbox"
                        aria-label={`انتخاب ${p.name}`}
                        disabled={busy}
                        checked={chosen.includes(id)}
                        onChange={(e) =>
                          setChosen((ids) =>
                            e.target.checked ? [...ids, id] : ids.filter((v) => v !== id),
                          )
                        }
                      />
                      {p.image ? (
                        <img src={p.image} alt="" width={52} height={52} loading="lazy" />
                      ) : (
                        <span className="cs-no-image">بدون عکس</span>
                      )}
                      <div className="cs-product-copy">
                        <b>{p.name}</b>
                        <small>
                          {p.code} ·{' '}
                          {settings.showPrices && price.price
                            ? `${price.from ? 'از ' : ''}${formatRial(price.price)}`
                            : 'استعلام قیمت'}
                        </small>
                      </div>
                      <select
                        aria-label={`برند ${p.name}`}
                        disabled={busy || !p.variants.length}
                        value={variants[id] || ''}
                        onChange={(e) => setVariants((v) => ({ ...v, [id]: e.target.value }))}
                      >
                        <option value="">خودکار / شروع قیمت</option>
                        {p.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                            {v.available ? '' : ' · ناموجود'}
                          </option>
                        ))}
                      </select>
                      <div className="cs-reorder">
                        <button
                          type="button"
                          disabled={busy || index === 0}
                          aria-label={`انتقال ${p.name} به قبل`}
                          onClick={() => move(id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={busy || index === order.length - 1}
                          aria-label={`انتقال ${p.name} به بعد`}
                          onClick={() => move(id, 1)}
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  );
                })}
                {!snapshot.products.length && <p>محصولی با این فیلترها پیدا نشد.</p>}
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
