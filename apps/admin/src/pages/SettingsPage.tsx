import { FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { isValidIranMobile } from '../lib/invoice-math';

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
    instagram?: string;
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
    instagram: '',
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
  if (loading)
    return (
      <section>
        <div className="skeleton-block" />
        <div className="skeleton-block" />
      </section>
    );
  return (
    <section className="settings-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">مدیریت</span>
          <h1>تنظیمات سیستم</h1>
          <p className="muted">اطلاعات فروشگاه، ارتباطات و سیاست‌های عملیاتی.</p>
        </div>
        <button className="button-primary" form="settings-form">
          ذخیره تنظیمات
        </button>
      </div>
      {message && <div className="notice">{message}</div>}
      <form id="settings-form" className="settings-grid" onSubmit={submit}>
        <fieldset>
          <legend>اطلاعات فروشگاه</legend>
          <label>
            نام فروشگاه
            <input
              value={settings['store.profile']?.name ?? ''}
              onChange={(e) => updateProfile('name', e.target.value)}
            />
          </label>
          <label>
            شماره‌های تماس
            <input
              value={settings['store.profile']?.phones ?? ''}
              onChange={(e) => updateProfile('phones', e.target.value)}
              placeholder="۰۹۱۲...، ۰۴۴..."
            />
          </label>
          <label>
            آدرس
            <input
              value={settings['store.profile']?.address ?? ''}
              onChange={(e) => updateProfile('address', e.target.value)}
            />
          </label>
          <label>
            لینک نقشه (Embed)
            <input
              dir="ltr"
              value={settings['store.profile']?.mapUrl ?? ''}
              onChange={(e) => updateProfile('mapUrl', e.target.value)}
              placeholder="https://www.openstreetmap.org/export/embed.html?bbox=..."
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
        </fieldset>
        <fieldset>
          <legend>پیامک و ارتباطات</legend>
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
          <label>
            شناسه ویدئوی آپارات
            <input
              value={settings['store.trust_video'] ?? ''}
              onChange={(e) =>
                setSettings((current) => ({ ...current, 'store.trust_video': e.target.value }))
              }
            />
          </label>
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
          <p className="settings-help">
            لینک تلگرام و بله در فوتر سایت عمومی و صفحهٔ تماس نمایش داده می‌شود؛ توکن ربات و chat id
            فقط در Environment سرور نگهداری می‌شود.
          </p>
        </fieldset>
        <fieldset>
          <legend>انبار و پشتیبان‌گیری</legend>
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
            disabled={backupRunning || backupJobs.some((job) => job.status === 'running')}
            onClick={() => void runBackup()}
          >
            {backupRunning ? 'در حال آغاز…' : 'اجرای پشتیبان‌گیری اکنون'}
          </button>
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
          <p className="settings-help">
            فایل‌های پشتیبان پس از انتقال امن به مقصد خارجی از VPS حذف می‌شوند.
          </p>
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
        <fieldset>
          <legend>ارسال پیام آزمایشی</legend>
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
          <label>
            متن پیام
            <textarea
              rows={3}
              maxLength={500}
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
            />
          </label>
          <button type="button" disabled={testSending} onClick={() => void sendTest()}>
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
      </form>
    </section>
  );
}
