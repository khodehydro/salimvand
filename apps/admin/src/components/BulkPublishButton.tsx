import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';

type Option = { id: string; name: string };
type Props = {
  categories: Option[];
  brands: Option[];
  vehicles: Array<{ id: string; name: string; models: Option[] }>;
};
type Platform = 'telegram' | 'bale';
type Filters = {
  mode: 'all' | 'vehicles' | 'categories' | 'brands' | 'combined';
  vehicleModelIds?: string[];
  categoryIds?: string[];
  brandIds?: string[];
  match: 'and' | 'or';
  inStockOnly: boolean;
  withImageOnly: boolean;
};
type Campaign = {
  id: string;
  createdAt: number;
  total: number;
  batches: number;
  batchSize: number;
  state: string;
  cancelRequested: boolean;
  error?: string;
  platforms: Platform[];
  filters: Filters;
  progress: {
    status: 'queued' | 'running' | 'waiting' | 'completed' | 'cancelled';
    cursor: number;
    sent: Record<Platform, number>;
    failed: Record<Platform, number>;
    skipped: Record<Platform, number>;
    nextBatchAt?: number;
    issues: Array<{ productId: string; code: string; platform: Platform; reason: string }>;
  };
};
const endpoint = '/notifications/bulk-publish';
const number = (value: number) => value.toLocaleString('fa-IR');
const channelName = (platform: Platform) => (platform === 'telegram' ? 'تلگرام' : 'بله');
const modeNames = {
  all: 'همهٔ محصولات',
  vehicles: 'بر اساس خودرو',
  categories: 'بر اساس دسته‌بندی',
  brands: 'بر اساس برند',
  combined: 'ترکیب گروه‌ها',
};
const finished = (job: Campaign) =>
  ['completed', 'cancelled'].includes(job.progress.status) ||
  ['failed', 'completed'].includes(job.state);

function MultiPick({
  label,
  options,
  values,
  onChange,
}: {
  label: string;
  options: Option[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const visible = options.filter((option) => option.name.includes(search.trim()));
  return (
    <fieldset className="bulk-pick">
      <legend>
        {label} — {number(values.length)} انتخاب
      </legend>
      <input
        aria-label={`جست‌وجوی ${label}`}
        placeholder="جست‌وجو…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="bulk-pick-options">
        {visible.map((option) => (
          <label key={option.id}>
            <input
              type="checkbox"
              checked={values.includes(option.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...values, option.id]
                    : values.filter((id) => id !== option.id),
                )
              }
            />
            {option.name}
          </label>
        ))}
        {!visible.length && <span className="muted">موردی پیدا نشد.</span>}
      </div>
    </fieldset>
  );
}

export function BulkPublishButton(props: Props) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button onClick={() => setOpen(true)}>انتشار گروهی</button>
      {open && <BulkPublishDialog {...props} onClose={close} />}
    </>
  );
}

function BulkPublishDialog({
  categories,
  brands,
  vehicles,
  onClose,
}: Props & { onClose: () => void }) {
  const [mode, setMode] = useState<Filters['mode']>('all');
  const [vehicleIds, setVehicleIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [brandIds, setBrandIds] = useState<string[]>([]);
  const [match, setMatch] = useState<'and' | 'or'>('and');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [withImageOnly, setWithImageOnly] = useState(false);
  const [platforms, setPlatforms] = useState<Platform[]>(['telegram', 'bale']);
  const [preview, setPreview] = useState<{ count: number; batches: number } | null>(null);
  const [jobs, setJobs] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pollError, setPollError] = useState('');
  const attempt = useRef<{ key: string; id: string }>();
  const busyRef = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const filters: Filters = useMemo(
    () => ({
      mode,
      match,
      inStockOnly,
      withImageOnly,
      ...(['vehicles', 'combined'].includes(mode) ? { vehicleModelIds: vehicleIds } : {}),
      ...(['categories', 'combined'].includes(mode) ? { categoryIds } : {}),
      ...(['brands', 'combined'].includes(mode) ? { brandIds } : {}),
    }),
    [mode, match, inStockOnly, withImageOnly, vehicleIds, categoryIds, brandIds],
  );
  const key = JSON.stringify({ filters, platforms });
  useEffect(() => {
    setPreview(null);
    setMessage('');
  }, [key]);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await api<{ data: Campaign[] }>(endpoint);
        if (alive) {
          setJobs(response.data);
          setSelectedId((current) => current || response.data[0]?.id || '');
          setPollError('');
        }
      } catch (error) {
        if (alive) setPollError((error as Error).message);
      } finally {
        if (alive) timer = setTimeout(() => void poll(), 5000);
      }
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
      );
      if (!elements?.length) return;
      const first = elements[0],
        last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('keydown', keyboard);
      previous?.focus();
    };
  }, [onClose]);

  const work = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const start = () =>
    work(async () => {
      if (!preview?.count || !platforms.length) return;
      if (
        !window.confirm(
          `انتشار ${number(preview.count)} محصول در ${number(preview.batches)} مرحله در ${platforms.map(channelName).join(' و ')} شروع شود؟`,
        )
      )
        return;
      if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      const result = await api<{ data: Campaign }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ ...filters, platforms, requestId: attempt.current.id }),
      });
      setJobs((current) => [result.data, ...current.filter((job) => job.id !== result.data.id)]);
      setSelectedId(result.data.id);
      setPreview(null);
      attempt.current = undefined;
      setMessage('در صف قرار گرفت؛ بستن این پنجره یا مرورگر انتشار را متوقف نمی‌کند.');
    });
  const selected = jobs.find((job) => job.id === selectedId);
  const status =
    selected &&
    (selected.state === 'failed'
      ? 'اجرای صف ناموفق'
      : selected.cancelRequested && !finished(selected)
        ? 'در حال توقف'
        : {
            queued: 'در صف',
            running: 'در حال انتشار',
            waiting: 'مکث بین مراحل',
            completed: 'پایان‌یافته',
            cancelled: 'متوقف‌شده',
          }[selected.progress.status]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="editor bulk-publish-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-publish-title"
        ref={dialog}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="editor-head">
          <h2 id="bulk-publish-title">انتشار گروهی محصولات</h2>
          <button className="close" aria-label="بستن انتشار گروهی" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="editor-body">
          <p className="notice">
            هر مرحله حداکثر ۱۰ محصول، به‌ترتیب و بدون ارسال هم‌زمان؛ بین مراحل ۳۰ ثانیه مکث می‌شود.
            مثلاً ۲۰۰ محصول در ۲۰ مرحله منتشر می‌شود.
          </p>
          <fieldset disabled={busy} className="bulk-form">
            <label>
              نوع انتشار
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as Filters['mode'])}
              >
                {Object.entries(modeNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              فقط محصولات فعال و حذف‌نشده منتشر می‌شوند. هر محصول، حتی با چند سازگاری، در هر کانال
              یک‌بار ارسال می‌شود.
            </p>
            {['vehicles', 'combined'].includes(mode) && (
              <MultiPick
                label="خودروها"
                options={vehicles.flatMap((make) =>
                  make.models.map((model) => ({
                    id: model.id,
                    name: `${make.name} ${model.name}`,
                  })),
                )}
                values={vehicleIds}
                onChange={setVehicleIds}
              />
            )}
            {['categories', 'combined'].includes(mode) && (
              <>
                <MultiPick
                  label="دسته‌بندی‌ها"
                  options={categories}
                  values={categoryIds}
                  onChange={setCategoryIds}
                />
                <small className="muted">
                  فقط دسته‌های انتخاب‌شده؛ زیر‌دسته‌ها را در صورت نیاز جداگانه انتخاب کنید.
                </small>
              </>
            )}
            {['brands', 'combined'].includes(mode) && (
              <MultiPick label="برندها" options={brands} values={brandIds} onChange={setBrandIds} />
            )}
            {mode === 'combined' && (
              <label>
                نحوهٔ ترکیب گروه‌ها
                <select
                  value={match}
                  onChange={(event) => setMatch(event.target.value as 'and' | 'or')}
                >
                  <option value="and">اشتراک — محصول باید در همهٔ گروه‌های انتخاب‌شده باشد</option>
                  <option value="or">اجتماع — کافی است محصول در یکی از گروه‌ها باشد</option>
                </select>
              </label>
            )}
            {mode !== 'all' && (
              <small className="muted">
                در هر فهرست، انتخاب چند مورد به معنی «یکی از این موارد» است.
              </small>
            )}
            <div className="bulk-checks">
              <label>
                <input
                  type="checkbox"
                  checked={inStockOnly}
                  onChange={(event) => setInStockOnly(event.target.checked)}
                />
                فقط محصولات دارای موجودی
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={withImageOnly}
                  onChange={(event) => setWithImageOnly(event.target.checked)}
                />
                فقط محصولات دارای تصویر
              </label>
            </div>
            <fieldset className="bulk-checks">
              <legend>کانال‌های مقصد</legend>
              {(['telegram', 'bale'] as Platform[]).map((platform) => (
                <label key={platform}>
                  <input
                    type="checkbox"
                    checked={platforms.includes(platform)}
                    onChange={(event) =>
                      setPlatforms(
                        event.target.checked
                          ? [...platforms, platform]
                          : platforms.filter((value) => value !== platform),
                      )
                    }
                  />
                  {channelName(platform)}
                </label>
              ))}
            </fieldset>
          </fieldset>
          <div className="bulk-actions">
            <button
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  setPreview(null);
                  const result = await api<{ data: { count: number; batches: number } }>(
                    `${endpoint}/preview`,
                    { method: 'POST', body: JSON.stringify(filters) },
                  );
                  setPreview(result.data);
                })
              }
            >
              محاسبهٔ تعداد محصولات
            </button>
            <button
              className="button-primary"
              disabled={busy || !preview?.count || !platforms.length}
              onClick={() => void start()}
            >
              {busy ? 'در حال انجام…' : 'شروع انتشار گروهی'}
            </button>
          </div>
          {preview && (
            <p role="status">
              {number(preview.count)} محصول — {number(preview.batches)} مرحلهٔ حداکثر ۱۰تایی
            </p>
          )}
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          {pollError && (
            <p className="notice" role="alert">
              دریافت وضعیت: {pollError}
            </p>
          )}
          <hr />
          <h3>وضعیت و سابقهٔ انتشار گروهی</h3>
          <p className="muted">
            تمام نوبت‌ها در یک صف اجرا می‌شوند. اجرای مجدد یک گروه، انتشار جدید محسوب می‌شود؛
            ارسال‌های موفق خودکار تکرار نمی‌شوند.
          </p>
          {!!jobs.length && (
            <label>
              نوبت انتشار
              <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {new Date(job.createdAt).toLocaleString('fa-IR')} —{' '}
                    {modeNames[job.filters.mode]} — {number(job.total)} محصول
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected ? (
            <section className="bulk-progress" aria-label="پیشرفت انتشار">
              <strong>{status}</strong>
              <p>
                {number(selected.progress.cursor)} از {number(selected.total)} محصول پردازش شده —{' '}
                {number(
                  Math.min(
                    selected.batches,
                    selected.progress.cursor >= selected.total
                      ? selected.batches
                      : Math.floor(selected.progress.cursor / selected.batchSize) + 1,
                  ),
                )}{' '}
                از {number(selected.batches)} مرحله
              </p>
              <progress
                max={selected.total || 1}
                value={selected.progress.cursor}
                aria-label="پیشرفت محصولات"
              />
              {selected.platforms.map((platform) => (
                <p key={platform}>
                  {channelName(platform)}: {number(selected.progress.sent[platform])} موفق،{' '}
                  {number(selected.progress.failed[platform])} ناموفق،{' '}
                  {number(selected.progress.skipped[platform])} ردشده
                </p>
              ))}
              {selected.progress.nextBatchAt && (
                <p>
                  مرحلهٔ بعد از{' '}
                  {new Date(selected.progress.nextBatchAt).toLocaleTimeString('fa-IR')}
                </p>
              )}
              {selected.error && <p role="alert">{selected.error}</p>}
              {!finished(selected) && (
                <button
                  disabled={busy || selected.cancelRequested}
                  onClick={() =>
                    void work(async () => {
                      if (
                        !window.confirm('ادامهٔ این نوبت متوقف شود؟ ارسال جاری ممکن است کامل شود.')
                      )
                        return;
                      const result = await api<{ data: Campaign }>(
                        `${endpoint}/${selected.id}/cancel`,
                        { method: 'POST' },
                      );
                      setJobs((current) =>
                        current.map((job) => (job.id === selected.id ? result.data : job)),
                      );
                    })
                  }
                >
                  توقف ادامهٔ انتشار
                </button>
              )}
              {!!selected.progress.issues.length && (
                <details>
                  <summary>آخرین خطاها و موارد ردشده (حداکثر ۱۰۰ مورد)</summary>
                  <ul>
                    {selected.progress.issues.map((issue, index) => (
                      <li key={`${issue.productId}-${issue.platform}-${index}`}>
                        <code>{issue.code}</code> — {channelName(issue.platform)}: {issue.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          ) : (
            <p className="muted">هنوز نوبتی ثبت نشده است.</p>
          )}
        </div>
      </div>
    </div>
  );
}
