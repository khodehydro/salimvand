import { FormEvent, useEffect, useState } from 'react';
import { extractMapEmbedUrl } from '@salimvand/shared';
import { api } from '../lib/api';
import { isValidIranMobile } from '../lib/invoice-math';
import { MediaPicker, type PickerItem } from '../components/MediaPicker';

type BackupJob = {
  id: string;
  status: string;
  file?: string | null;
  sizeBytes?: string | number;
  encrypted: boolean;
  startedAt: string;
  finishedAt?: string | null;
  error?: string | null;
};
type Settings = {
  'store.profile'?: {
    name?: string;
    phones?: string;
    address?: string;
    open?: string;
    close?: string;
    mapUrl?: string;
    mapCode?: string;
    /** 'embed' = iframe pasted by the operator, 'coords' = automatic map
     * built from navLat/navLng (always renders, even where Google is slow). */
    mapSource?: 'embed' | 'coords';
    logoUrl?: string;
    faviconUrl?: string;
    shippingMethods?: string;
    navLat?: string;
    navLng?: string;
    navApp?: string;
    instagram?: string;
    header?: {
      tagline?: string;
      cta?: string;
      navCatalog?: string;
      navVideo?: string;
      navContact?: string;
    };
  };
  'store.trust_video'?: string;
  'sms.templates'?: { invoice?: string; paid?: string; autoSend?: boolean };
  'integrations.telegram'?: { link?: string };
  'integrations.bale'?: { link?: string };
  'inventory.default_min_stock'?: number;
  'backup.schedule'?: { enabled?: boolean };
};
const initial: Settings = {
  'store.profile': {
    name: '',
    phones: '',
    address: '',
    open: '09:00',
    close: '20:00',
    mapUrl: '',
    mapCode: '',
    mapSource: 'embed',
    logoUrl: '',
    faviconUrl: '',
    shippingMethods: '',
    navLat: '',
    navLng: '',
    navApp: 'both',
    instagram: '',
    header: { tagline: '', cta: '', navCatalog: '', navVideo: '', navContact: '' },
  },
  'store.trust_video': '',
  'sms.templates': { invoice: '', paid: '', autoSend: true },
  'integrations.telegram': { link: '' },
  'integrations.bale': { link: '' },
  'inventory.default_min_stock': 3,
  'backup.schedule': { enabled: true },
};
export function SettingsPage() {
  const [testChannel, setTestChannel] = useState('sms');
  const [testMobile, setTestMobile] = useState('');
  const [testMessage, setTestMessage] = useState('پیام آزمایشی فروشگاه سلیم‌وند');
  const [testSending, setTestSending] = useState(false);
  const [backupJobs, setBackupJobs] = useState<BackupJob[]>([]);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupStatus, setBackupStatus] = useState<{
    status: string;
    createdAt: string;
    file: string;
    encrypted: boolean;
  } | null>(null);
  const [settings, setSettings] = useState<Settings>(initial);
  // Settings are grouped into focused tabs so a first-time operator lands on
  // one clear task at a time instead of a wall of mixed fields.
  const [tab, setTab] = useState<'store' | 'map' | 'contact' | 'system'>('store');
  // Which site asset the media picker is choosing for ('logo' | 'favicon').
  const [pickerFor, setPickerFor] = useState<'logo' | 'favicon' | null>(null);
  const [integrationHealth, setIntegrationHealth] = useState<{
    channels: {
      sms: { configured: boolean; provider: string | null };
      telegram: { configured: boolean; provider: string };
      bale: { configured: boolean; provider: string };
    };
    queue: { waiting: number; active: number; completed: number; failed: number };
  } | null>(null);
  const [queue, setQueue] = useState<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  } | null>(null);
  const [failedJobs, setFailedJobs] = useState<
    Array<{
      id: string;
      type: string;
      mobile: string | null;
      failedReason: string;
      attemptsMade: number;
    }>
  >([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void api<{ data: Settings }>('/settings')
      .then((result) => setSettings({ ...initial, ...result.data }))
      .catch((error: Error) => setMessage(error.message))
      .finally(() => setLoading(false));
    void api<{ data: typeof integrationHealth }>('/notifications/health')
      .then((result) => {
        setIntegrationHealth(result.data);
        setQueue(result.data!.queue);
      })
      .catch(() => undefined);
    void api<{ data: typeof backupStatus }>('/settings/backup/status')
      .then((result) => setBackupStatus(result.data))
      .catch(() => undefined);
    void api<{ data: BackupJob[] }>('/settings/backup/jobs')
      .then((result) => setBackupJobs(result.data))
      .catch(() => undefined);
    void api<{ data: typeof failedJobs }>('/notifications/failed')
      .then((result) => setFailedJobs(result.data))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!backupJobs.some((job) => job.status === 'running')) return;
    const timer = window.setInterval(() => {
      void Promise.all([
        api<{ data: BackupJob[] }>('/settings/backup/jobs'),
        api<{ data: typeof backupStatus }>('/settings/backup/status'),
      ])
        .then(([jobs, status]) => {
          setBackupJobs(jobs.data);
          setBackupStatus(status.data);
        })
        .catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [backupJobs]);
  const updateProfile = (key: keyof NonNullable<Settings['store.profile']>, value: string) =>
    setSettings((current) => ({
      ...current,
      'store.profile': { ...current['store.profile'], [key]: value },
    }));
  const updateHeaderText = (
    key: keyof NonNullable<NonNullable<Settings['store.profile']>['header']>,
    value: string,
  ) =>
    setSettings((current) => ({
      ...current,
      'store.profile': {
        ...current['store.profile'],
        header: { ...(current['store.profile']?.header ?? {}), [key]: value },
      },
    }));
  const sendTest = async () => {
    if (!testMessage.trim() || (testChannel === 'sms' && !isValidIranMobile(testMobile)))
      return setMessage('برای تست، متن و مقصد معتبر وارد کنید.');
    setTestSending(true);
    try {
      await api('/notifications/test', {
        method: 'POST',
        body: JSON.stringify({
          channel: testChannel,
          mobile: testChannel === 'sms' ? testMobile : undefined,
          message: testMessage,
        }),
      });
      setMessage('پیام آزمایشی در صف ارسال قرار گرفت.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setTestSending(false);
    }
  };
  const runBackup = async () => {
    setBackupRunning(true);
    try {
      const result = await api<{ data: { jobId: string; status: string } }>(
        '/settings/backup/run',
        { method: 'PUT' },
      );
      setBackupJobs((current) => [
        {
          id: result.data.jobId,
          status: result.data.status,
          encrypted: true,
          startedAt: new Date().toISOString(),
        },
        ...current,
      ]);
      setMessage('پشتیبان‌گیری در سرور آغاز شد؛ نتیجه در تاریخچه ثبت می‌شود.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBackupRunning(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify(settings) });
      setMessage('تنظیمات با موفقیت ذخیره شد.');
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  // Mirrors the website's fullMapUrl(): accepts the full iframe code, a bare
  // embed URL or a bare Google Maps pb code, exactly like the storefront.
  const mapInput = () =>
    (settings['store.profile']?.mapUrl ?? '').trim() ||
    (settings['store.profile']?.mapCode ?? '').trim();
  const mapResolvedUrl = () =>
    extractMapEmbedUrl(
      settings['store.profile']?.mapUrl ?? '',
      settings['store.profile']?.mapCode ?? '',
    ) ||
    'https://www.openstreetmap.org/export/embed.html?bbox=46.06%2C36.94%2C46.16%2C37.00&layer=mapnik&marker=36.9692%2C46.1027';
  const mapIsEmbeddable = () => !mapInput() || Boolean(mapResolvedUrl().match(/^https?:\/\//));
  // Automatic OpenStreetMap embed centered on the store coordinates — used
  // when the operator picks «نقشهٔ خودکار» (Google embeds do not load for
  // every visitor, coordinates always render).
  const autoMapUrl = () => {
    const lat = Number(settings['store.profile']?.navLat ?? '');
    const lng = Number(settings['store.profile']?.navLng ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !lat || !lng) return '';
    return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.012}%2C${lat - 0.008}%2C${lng + 0.012}%2C${lat + 0.008}&layer=mapnik&marker=${lat}%2C${lng}`;
  };
  const mapSource = () => (settings['store.profile']?.mapSource ?? 'embed') as 'embed' | 'coords';
  const activeMapUrl = () =>
    mapSource() === 'coords' ? autoMapUrl() || mapResolvedUrl() : mapResolvedUrl();

  const [assetBusy, setAssetBusy] = useState<'logo' | 'favicon' | null>(null);
  const uploadSiteAsset = async (kind: 'logo' | 'favicon', file: File | null) => {
    if (!file) return setMessage('ابتدا یک فایل تصویر انتخاب کنید.');
    setAssetBusy(kind);
    try {
      const data = new FormData();
      data.append('file', file);
      const result = await api<{ data: { path: string } }>(`/media/settings/${kind}/upload`, {
        method: 'POST',
        body: data,
      });
      updateProfile(kind === 'logo' ? 'logoUrl' : 'faviconUrl', result.data.path);
      setMessage('فایل آپلود شد — برای اعمال روی سایت، تنظیمات را ذخیره کنید.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setAssetBusy(null);
    }
  };
  const clearSiteAsset = (kind: 'logo' | 'favicon') => {
    updateProfile(kind === 'logo' ? 'logoUrl' : 'faviconUrl', '');
    setMessage('برای حذف کامل، تنظیمات را ذخیره کنید.');
  };

  if (loading)
    return (
      <section>
        <div className="skeleton-block" />
        <div className="skeleton-block" />
      </section>
    );

  const tabs = [
    {
      id: 'store',
      label: 'اطلاعات فروشگاه',
      hint: 'نام، تماس‌ها، ساعت کاری، لوگو و متن‌های سایت',
    },
    {
      id: 'map',
      label: 'نقشه و مسیریابی',
      hint: 'نقشهٔ بخش تماس سایت و دکمهٔ مسیریابی موبایل',
    },
    {
      id: 'contact',
      label: 'ارتباطات و پیامک',
      hint: 'تلگرام، بله، قالب پیامک‌ها و تست ارسال',
    },
    {
      id: 'system',
      label: 'سیستم و پشتیبان',
      hint: 'آستانهٔ انبار، پشتیبان‌گیری و صف پیام‌ها',
    },
  ] as const;
  const activeTab = tabs.find((item) => item.id === tab) ?? tabs[0];

  return (
    <section className="settings-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">مدیریت</span>
          <h1>تنظیمات سیستم</h1>
          <p className="muted">{activeTab.hint}</p>
        </div>
        <button className="button-primary" form="settings-form">
          ✓ ذخیره تنظیمات
        </button>
      </div>
      {message && <div className="notice">{message}</div>}
      <nav className="settings-tabs" aria-label="بخش‌های تنظیمات">
        {tabs.map((item) => (
          <button
            type="button"
            key={item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? 'true' : undefined}
          >
            <b>{item.label}</b>
            <small>{item.hint}</small>
          </button>
        ))}
      </nav>
      <form id="settings-form" className="settings-grid" onSubmit={submit}>
        {tab === 'store' && (
          <>
            <fieldset>
              <legend>مشخصات فروشگاه</legend>
              <div className="two-fields">
                <label>
                  نام فروشگاه
                  <input
                    value={settings['store.profile']?.name ?? ''}
                    onChange={(e) => updateProfile('name', e.target.value)}
                  />
                </label>
                <label>
                  شماره‌های تماس (با «،» جدا کنید)
                  <input
                    value={settings['store.profile']?.phones ?? ''}
                    onChange={(e) => updateProfile('phones', e.target.value)}
                    placeholder="۰۹۱۲...، ۰۴۴..."
                  />
                </label>
              </div>
              <label>
                آدرس
                <input
                  value={settings['store.profile']?.address ?? ''}
                  onChange={(e) => updateProfile('address', e.target.value)}
                />
              </label>
              <div className="two-fields">
                <label>
                  شروع کار
                  <input
                    type="time"
                    value={settings['store.profile']?.open ?? ''}
                    onChange={(e) => updateProfile('open', e.target.value)}
                  />
                </label>
                <label>
                  پایان کار
                  <input
                    type="time"
                    value={settings['store.profile']?.close ?? ''}
                    onChange={(e) => updateProfile('close', e.target.value)}
                  />
                </label>
              </div>
              <div className="two-fields">
                <label>
                  روش‌های ارسال شهرستان (با «،» جدا کنید)
                  <input
                    value={settings['store.profile']?.shippingMethods ?? ''}
                    onChange={(e) => updateProfile('shippingMethods', e.target.value)}
                    placeholder="باربری، پست پیشتاز، اتوبار"
                  />
                </label>
                <label>
                  اینستاگرام
                  <input
                    dir="ltr"
                    value={settings['store.profile']?.instagram ?? ''}
                    onChange={(e) => updateProfile('instagram', e.target.value)}
                    placeholder="https://instagram.com/..."
                  />
                </label>
              </div>
              <div className="header-texts">
                <small>متن‌های هدر سایت — خالی بماند، پیش‌فرض استفاده می‌شود</small>
                <div className="two-fields">
                  <label>
                    زیرنویس لوگو
                    <input
                      value={settings['store.profile']?.header?.tagline ?? ''}
                      onChange={(e) => updateHeaderText('tagline', e.target.value)}
                      placeholder="قطعات یدکی خودرو"
                    />
                  </label>
                  <label>
                    متن دکمهٔ هدر
                    <input
                      value={settings['store.profile']?.header?.cta ?? ''}
                      onChange={(e) => updateHeaderText('cta', e.target.value)}
                      placeholder="تماس سریع"
                    />
                  </label>
                </div>
                <div className="two-fields">
                  <label>
                    منو: کاتالوگ
                    <input
                      value={settings['store.profile']?.header?.navCatalog ?? ''}
                      onChange={(e) => updateHeaderText('navCatalog', e.target.value)}
                      placeholder="کاتالوگ"
                    />
                  </label>
                  <label>
                    منو: ویدئو
                    <input
                      value={settings['store.profile']?.header?.navVideo ?? ''}
                      onChange={(e) => updateHeaderText('navVideo', e.target.value)}
                      placeholder="ویدئوی فروشگاه"
                    />
                  </label>
                </div>
                <div className="two-fields">
                  <label>
                    منو: تماس
                    <input
                      value={settings['store.profile']?.header?.navContact ?? ''}
                      onChange={(e) => updateHeaderText('navContact', e.target.value)}
                      placeholder="تماس"
                    />
                  </label>
                  <label>
                    ویدئوی معرفی فروشگاه (شناسه یا لینک آپارات)
                    <input
                      dir="ltr"
                      value={settings['store.trust_video'] ?? ''}
                      onChange={(e) =>
                        setSettings((current) => ({
                          ...current,
                          'store.trust_video': e.target.value,
                        }))
                      }
                      placeholder="https://www.aparat.com/v/AbCdEf123 یا فقط AbCdEf123"
                    />
                  </label>
                </div>
              </div>
            </fieldset>
            <fieldset>
              <legend>لوگو و آیکون سایت</legend>
              <div className="site-assets">
                <div className="asset-field">
                  <small>لوگوی سایت (هدر صفحهٔ اصلی و صفحات محصول)</small>
                  <div className="asset-preview">
                    {settings['store.profile']?.logoUrl ? (
                      <img src={settings['store.profile'].logoUrl} alt="لوگوی سایت" />
                    ) : (
                      <span>س</span>
                    )}
                  </div>
                  <div className="asset-actions">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => void uploadSiteAsset('logo', e.target.files?.[0] ?? null)}
                    />
                    <button
                      type="button"
                      className="outline"
                      disabled={assetBusy === 'logo'}
                      onClick={() => setPickerFor('logo')}
                    >
                      انتخاب از رسانه‌ها
                    </button>
                    {settings['store.profile']?.logoUrl && (
                      <button
                        type="button"
                        className="asset-clear outline"
                        onClick={() => clearSiteAsset('logo')}
                      >
                        حذف
                      </button>
                    )}
                  </div>
                </div>
                <div className="asset-field">
                  <small>آیکون سایت (نشانک تب مرورگر)</small>
                  <div className="asset-preview asset-preview-sq">
                    {settings['store.profile']?.faviconUrl ? (
                      <img src={settings['store.profile'].faviconUrl} alt="آیکون سایت" />
                    ) : (
                      <span>س</span>
                    )}
                  </div>
                  <div className="asset-actions">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/x-icon"
                      onChange={(e) => void uploadSiteAsset('favicon', e.target.files?.[0] ?? null)}
                    />
                    <button
                      type="button"
                      className="outline"
                      disabled={assetBusy === 'favicon'}
                      onClick={() => setPickerFor('favicon')}
                    >
                      انتخاب از رسانه‌ها
                    </button>
                    {settings['store.profile']?.faviconUrl && (
                      <button
                        type="button"
                        className="asset-clear outline"
                        onClick={() => clearSiteAsset('favicon')}
                      >
                        حذف
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <p className="settings-help">
                فرمت‌های مجاز: PNG، JPG، WebP و ICO — حداکثر ۹۰۰ کیلوبایت. لوگو به‌صورت مربعی در هدر
                نمایش داده می‌شود؛ آیکون مربعی ۶۴×۶۴ یا فایل ico بهترین نتیجه را می‌دهد.
              </p>
              <div className="site-visibility">
                <small>پس از ذخیره، این اطلاعات در سایت عمومی دیده می‌شود:</small>
                <ul>
                  <li>
                    تلفن‌ها در دکمهٔ «تماس سریع»، بخش تماس و صفحهٔ هر محصول:{' '}
                    <b dir="ltr">{settings['store.profile']?.phones || 'ثبت نشده'}</b>
                  </li>
                  <li>آدرس و نقشه در بخش «تماس و آدرس» صفحهٔ اصلی و صفحات دسته‌بندی و خودرو</li>
                  <li>لوگو در هدر سایت و آیکون در تب مرورگر (پس از آپلود و ذخیره)</li>
                  <li>
                    روش‌های ارسال در بخش تماس:{' '}
                    <b>{settings['store.profile']?.shippingMethods || 'باربری و پست پیشتاز'}</b>
                  </li>
                  <li>
                    ساعات کاری:{' '}
                    <b>
                      {settings['store.profile']?.open || '—'} تا{' '}
                      {settings['store.profile']?.close || '—'}
                    </b>
                  </li>
                  <li>
                    تلگرام و بله در دکمه‌های تماس و فوتر سایت — در صورت خالی بودن، دکمه‌ها پنهان
                    می‌شوند
                  </li>
                  <li>ویدئوی آپارات در کارت ویدئوی صفحهٔ اصلی و صفحهٔ هر محصول</li>
                </ul>
              </div>
            </fieldset>
          </>
        )}

        {tab === 'map' && (
          <fieldset>
            <legend>نقشه و مسیریابی</legend>
            <div className="map-source-row" role="radiogroup" aria-label="منبع نقشهٔ سایت">
              <label className={mapSource() === 'embed' ? 'active' : ''}>
                <input
                  type="radio"
                  name="mapSource"
                  checked={mapSource() === 'embed'}
                  onChange={() => updateProfile('mapSource', 'embed')}
                />
                <span>
                  <b>کد iframe نقشه</b>
                  <small>کد جاسازی گوگل‌مپ یا هر سرویس دیگر را خودتان وارد می‌کنید</small>
                </span>
              </label>
              <label className={mapSource() === 'coords' ? 'active' : ''}>
                <input
                  type="radio"
                  name="mapSource"
                  checked={mapSource() === 'coords'}
                  onChange={() => updateProfile('mapSource', 'coords')}
                />
                <span>
                  <b>نقشهٔ خودکار از مختصات</b>
                  <small>
                    همیشه نمایش داده می‌شود؛ مناسب وقتی iframe گوگل‌مپ برای بازدیدکننده باز نمی‌شود
                  </small>
                </span>
              </label>
            </div>
            {mapSource() === 'embed' && (
              <>
                <label className="wide-row">
                  کد یا لینک iframe نقشه (گوگل‌مپ یا هر سرویس دیگر)
                  <textarea
                    dir="ltr"
                    rows={3}
                    value={settings['store.profile']?.mapUrl ?? ''}
                    onChange={(e) => updateProfile('mapUrl', e.target.value)}
                    placeholder={`<iframe src="https://www.google.com/maps/embed?pb=..." ...></iframe>`}
                  />
                </label>
                {!mapIsEmbeddable() && (
                  <p className="settings-help map-warn">
                    این لینک برای جاسازی مناسب نیست — لینک‌های اشتراکی گوگل‌مپ (maps.app.goo.gl یا
                    /maps/place) داخل سایت باز نمی‌شوند. در گوگل‌مپ روی «اشتراک‌گذاری ← Embed a map»
                    کلیک کنید و کل کد iframe را همین‌جا بچسبانید.
                  </p>
                )}
              </>
            )}
            {mapSource() === 'coords' && (
              <p className="settings-help">
                نقشه از مختصات همین صفحه ساخته می‌شود
                {autoMapUrl() ? '' : ' — مختصات را در پایین همین بخش وارد کنید'}.
              </p>
            )}
            <div className="map-preview">
              <small>
                پیش‌نمایش نقشهٔ سایت — پس از ذخیره، همین نقشه در بخش «تماس و آدرس» صفحهٔ اصلی و
                صفحات عمومی نمایش داده می‌شود.
              </small>
              <div className="map-preview-frame">
                <iframe
                  title="پیش‌نمایش نقشه"
                  src={activeMapUrl()}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            </div>
            <div className="header-texts">
              <small>
                مسیریابی موبایل — دکمهٔ «مسیریابی» کنار دکمهٔ تماس سریع نسخهٔ موبایل سایت
              </small>
              <div className="two-fields">
                <label>
                  عرض جغرافیایی فروشگاه (Latitude)
                  <input
                    dir="ltr"
                    value={settings['store.profile']?.navLat ?? ''}
                    onChange={(e) => updateProfile('navLat', e.target.value)}
                    placeholder="36.9692"
                  />
                </label>
                <label>
                  طول جغرافیایی فروشگاه (Longitude)
                  <input
                    dir="ltr"
                    value={settings['store.profile']?.navLng ?? ''}
                    onChange={(e) => updateProfile('navLng', e.target.value)}
                    placeholder="46.1027"
                  />
                </label>
              </div>
              <label>
                برنامهٔ مسیریابی
                <select
                  value={settings['store.profile']?.navApp ?? 'both'}
                  onChange={(e) => updateProfile('navApp', e.target.value)}
                >
                  <option value="both">هر دو — بازدیدکننده انتخاب کند (نشان / بلد)</option>
                  <option value="neshan">فقط نشان</option>
                  <option value="balad">فقط بلد</option>
                </select>
              </label>
              <small>
                مختصات را از گوگل‌مپ کپی کنید: روی موقعیت فروشگاه راست‌کلیک → عدد اول Latitude و عدد
                دوم Longitude است. سفر به‌صورت خودکار از موقعیت فعلی بازدیدکننده شروع می‌شود؛ اگر
                مختصات خالی باشد دکمهٔ مسیریابی نمایش داده نمی‌شود.
              </small>
            </div>
          </fieldset>
        )}

        {tab === 'contact' && (
          <>
            <fieldset>
              <legend>پیام‌رسان‌ها</legend>
              <div className="two-fields">
                <label>
                  لینک تلگرام
                  <input
                    dir="ltr"
                    value={settings['integrations.telegram']?.link ?? ''}
                    onChange={(e) =>
                      setSettings((current) => ({
                        ...current,
                        'integrations.telegram': { link: e.target.value },
                      }))
                    }
                    placeholder="https://t.me/..."
                  />
                </label>
                <label>
                  لینک کانال بله
                  <input
                    dir="ltr"
                    value={settings['integrations.bale']?.link ?? ''}
                    onChange={(e) =>
                      setSettings((current) => ({
                        ...current,
                        'integrations.bale': { link: e.target.value },
                      }))
                    }
                    placeholder="https://ble.ir/..."
                  />
                </label>
              </div>
              <p className="settings-help">
                لینک تلگرام و بله در دکمه‌های تماس و فوتر سایت نمایش داده می‌شود؛ توکن ربات و chat
                id فقط در Environment سرور نگهداری می‌شود.
              </p>
            </fieldset>
            <fieldset>
              <legend>قالب پیامک</legend>
              <label>
                قالب فاکتور
                <textarea
                  value={settings['sms.templates']?.invoice ?? ''}
                  onChange={(e) =>
                    setSettings((current) => ({
                      ...current,
                      'sms.templates': { ...current['sms.templates'], invoice: e.target.value },
                    }))
                  }
                  placeholder="{نام}، فاکتور {شماره}: {لینک}"
                  rows={3}
                />
              </label>
              <label>
                قالب پیامک پرداخت
                <textarea
                  rows={3}
                  value={settings['sms.templates']?.paid ?? ''}
                  onChange={(e) =>
                    setSettings((current) => ({
                      ...current,
                      'sms.templates': { ...current['sms.templates'], paid: e.target.value },
                    }))
                  }
                  placeholder="پرداخت فاکتور {invoice_number} ثبت شد. مبلغ: {amount} ریال"
                />
              </label>
              <p className="settings-help">
                متغیرهای قابل استفاده: <code dir="ltr">{'{customer_name}'}</code>{' '}
                <code dir="ltr">{'{invoice_number}'}</code> <code dir="ltr">{'{amount}'}</code>{' '}
                <code dir="ltr">{'{link}'}</code>
              </p>
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={settings['sms.templates']?.autoSend ?? false}
                  onChange={(e) =>
                    setSettings((current) => ({
                      ...current,
                      'sms.templates': { ...current['sms.templates'], autoSend: e.target.checked },
                    }))
                  }
                />{' '}
                ارسال خودکار لینک فاکتور
              </label>
            </fieldset>
            <fieldset>
              <legend>ارسال پیام آزمایشی</legend>
              <div className="two-fields">
                <label>
                  provider
                  <select value={testChannel} onChange={(e) => setTestChannel(e.target.value)}>
                    <option value="sms">پیامک</option>
                    <option value="telegram">تلگرام</option>
                    <option value="bale">بله</option>
                  </select>
                </label>
                {testChannel === 'sms' && (
                  <label>
                    شماره مقصد
                    <input
                      dir="ltr"
                      placeholder="09123456789"
                      value={testMobile}
                      onChange={(e) => setTestMobile(e.target.value)}
                    />
                  </label>
                )}
              </div>
              <label>
                متن پیام
                <textarea
                  rows={3}
                  maxLength={500}
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="outline"
                disabled={testSending}
                onClick={() => void sendTest()}
              >
                {testSending ? 'در حال ارسال...' : 'قرار دادن در صف تست'}
              </button>
              <p className="settings-help">
                برای Telegram و Bale پیام به chat id تنظیم‌شده در Environment ارسال می‌شود.
              </p>
            </fieldset>
            <fieldset>
              <legend>صف پیام‌رسانی</legend>
              <div className="queue-stats">
                در انتظار: {queue?.waiting ?? '—'} · فعال: {queue?.active ?? '—'} · انجام‌شده:{' '}
                {queue?.completed ?? '—'} · ناموفق: {queue?.failed ?? '—'}
              </div>
              {failedJobs.length ? (
                failedJobs.map((job) => (
                  <div className="queue-job" key={job.id}>
                    <span>
                      {job.type} · {job.mobile ?? 'بدون شماره'}
                      <small>
                        {job.failedReason} · تلاش {job.attemptsMade}
                      </small>
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await api(`/notifications/failed/${job.id}/retry`, { method: 'POST' });
                          setFailedJobs((current) => current.filter((item) => item.id !== job.id));
                          setMessage('ارسال مجدد در صف قرار گرفت.');
                        } catch (error) {
                          setMessage((error as Error).message);
                        }
                      }}
                    >
                      تلاش مجدد
                    </button>
                  </div>
                ))
              ) : (
                <p className="settings-help">پیام ناموفقی در صف وجود ندارد.</p>
              )}
            </fieldset>
            <fieldset>
              <legend>سلامت یکپارچه‌سازی‌ها</legend>
              <div className="integration-health">
                {(['sms', 'telegram', 'bale'] as const).map((channel) => {
                  const item = integrationHealth?.channels[channel];
                  return (
                    <div key={channel}>
                      <span>
                        {channel === 'sms' ? 'پیامک' : channel === 'telegram' ? 'تلگرام' : 'بله'}
                      </span>
                      <b className={item?.configured ? 'status-chip' : 'low-stock'}>
                        {item?.configured ? 'پیکربندی شده' : 'تنظیم نشده'}
                      </b>
                      <small>{item?.provider ?? '—'}</small>
                    </div>
                  );
                })}
              </div>
              <p className="settings-help">
                وضعیت بالا بدون نمایش کلیدها و اطلاعات محرمانه گزارش می‌شود.
              </p>
            </fieldset>
          </>
        )}

        {tab === 'system' && (
          <fieldset>
            <legend>انبار و پشتیبان‌گیری</legend>
            <label>
              آستانهٔ پیش‌فرض کمبود
              <input
                type="number"
                min="0"
                value={settings['inventory.default_min_stock'] ?? 0}
                onChange={(e) =>
                  setSettings((current) => ({
                    ...current,
                    'inventory.default_min_stock': Number(e.target.value),
                  }))
                }
              />
            </label>
            {backupStatus ? (
              <div className="backup-status">
                <b className={backupStatus.status === 'success' ? 'status-chip' : 'low-stock'}>
                  {backupStatus.status === 'success' ? 'آخرین Backup موفق' : 'آخرین Backup ناموفق'}
                </b>
                <span>{new Date(backupStatus.createdAt).toLocaleString('fa-IR')}</span>
                <small>
                  {backupStatus.file || 'فایل ثبت نشده'} ·{' '}
                  {backupStatus.encrypted ? 'رمزنگاری‌شده' : 'بدون رمزنگاری'}
                </small>
              </div>
            ) : (
              <p className="settings-help">هنوز وضعیت Backup ثبت نشده است.</p>
            )}
            <button
              type="button"
              className="outline"
              disabled={backupRunning || backupJobs.some((job) => job.status === 'running')}
              onClick={() => void runBackup()}
            >
              {backupRunning ? 'در حال آغاز…' : 'اجرای پشتیبان‌گیری اکنون'}
            </button>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={settings['backup.schedule']?.enabled ?? false}
                onChange={(e) =>
                  setSettings((current) => ({
                    ...current,
                    'backup.schedule': { enabled: e.target.checked },
                  }))
                }
              />{' '}
              پشتیبان‌گیری روزانه
            </label>
            {backupJobs.length > 0 && (
              <div className="backup-jobs">
                <h3>تاریخچه اجرا</h3>
                {backupJobs.slice(0, 5).map((job) => (
                  <div key={job.id}>
                    <span>
                      <b>
                        {job.status === 'success'
                          ? 'موفق'
                          : job.status === 'running'
                            ? 'در حال اجرا'
                            : 'ناموفق'}
                      </b>
                      <small>{new Date(job.startedAt).toLocaleString('fa-IR')}</small>
                    </span>
                    <code>{job.file || job.error || `#${job.id}`}</code>
                  </div>
                ))}
              </div>
            )}
            <p className="settings-help">
              فایل‌های پشتیبان پس از انتقال امن به مقصد خارجی از VPS حذف می‌شوند.
            </p>
          </fieldset>
        )}

        <div className="settings-save-bar">
          <span>تغییرات پس از فشردن دکمهٔ ذخیره روی سایت اعمال می‌شود.</span>
          <button type="submit" className="button-primary">
            ✓ ذخیره تنظیمات
          </button>
        </div>
      </form>
      <MediaPicker
        open={pickerFor !== null}
        title={
          pickerFor === 'logo' ? 'انتخاب لوگوی سایت از رسانه‌ها' : 'انتخاب آیکون سایت از رسانه‌ها'
        }
        onClose={() => setPickerFor(null)}
        onSelect={(item: PickerItem) => {
          if (!item.path.startsWith('/uploads/'))
            return setMessage('این رسانه برای استفاده در سایت مناسب نیست.');
          updateProfile(pickerFor === 'logo' ? 'logoUrl' : 'faviconUrl', item.path);
          setMessage('انتخاب شد — برای اعمال روی سایت، تنظیمات را ذخیره کنید.');
        }}
      />
    </section>
  );
}
