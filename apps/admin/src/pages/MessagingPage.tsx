import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatPersianNumber } from '@salimvand/shared';

type SmsRow = {
  id: string;
  mobile: string | null;
  template: string;
  status: string;
  provider: string | null;
  error: string | null;
  createdAt: string;
};
type ChannelRow = {
  id: string;
  channel: string;
  status: string;
  preview: string;
  error: string | null;
  createdAt: string;
};
type FailedJob = {
  id: string;
  name: string;
  type: string;
  mobile: string | null;
  failedReason: string;
  attemptsMade: number;
};
type Health = {
  channels: Record<string, { configured: boolean; provider: string | null }>;
  queue: Record<string, number>;
};

const tabs = [
  { id: 'sms', label: 'پیامک‌ها' },
  { id: 'channels', label: 'تلگرام و بله' },
  { id: 'send', label: 'ارسال آزمایشی' },
  { id: 'queue', label: 'صف و خطاها' },
] as const;
type Tab = (typeof tabs)[number]['id'];

const channelLabels: Record<string, string> = { sms: 'پیامک', telegram: 'تلگرام', bale: 'بله' };
const time = (value: string) => new Date(value).toLocaleString('fa-IR');

export function MessagingPage() {
  const [tab, setTab] = useState<Tab>('sms');
  const [smsRows, setSmsRows] = useState<SmsRow[]>([]);
  const [channelRows, setChannelRows] = useState<ChannelRow[]>([]);
  const [failed, setFailed] = useState<FailedJob[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [message, setMessage] = useState('');
  const [channel, setChannel] = useState('sms');
  const [mobile, setMobile] = useState('');
  const [text, setText] = useState('فاکتور {invoice_number} به مبلغ {amount} ریال — {link}');
  const [busy, setBusy] = useState(false);

  const load = () => {
    void api<{ data: SmsRow[] }>('/notifications/sms/logs?limit=50')
      .then((result) => setSmsRows(result.data))
      .catch((error: Error) => setMessage(error.message));
    void api<{ data: ChannelRow[] }>('/notifications/telegram/logs?limit=50')
      .then((result) => setChannelRows(result.data))
      .catch((error: Error) => setMessage(error.message));
    void api<{ data: FailedJob[] }>('/notifications/failed')
      .then((result) => setFailed(result.data))
      .catch(() => undefined);
    void api<{ data: Health }>('/notifications/health')
      .then((result) => setHealth(result.data))
      .catch(() => undefined);
  };
  useEffect(() => {
    load();
  }, []);

  const send = async () => {
    if (channel === 'sms' && !/^09\d{9}$/.test(mobile))
      return setMessage('برای پیامک شمارهٔ معتبر (۰۹xxxxxxxxx) لازم است');
    setBusy(true);
    try {
      await api('/notifications/test', {
        method: 'POST',
        body: JSON.stringify({ channel, mobile: mobile || undefined, message: text }),
      });
      setMessage('پیام در صف ارسال قرار گرفت.');
      load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="products-page">
      <div className="page-title">
        <div>
          <h1>پیامک و کانال‌ها</h1>
          <p className="muted">گزارش ارسال پیامک، تلگرام و بله، صف پیام‌رسانی و سلامت providerها</p>
        </div>
        <button className="button-primary" onClick={load}>
          به‌روزرسانی
        </button>
      </div>
      {message && <div className="notice">{message}</div>}

      <div className="cards dashboard-cards">
        {health ? (
          Object.entries(health.channels).map(([key, state]) => (
            <article key={key}>
              <small>{channelLabels[key] ?? key}</small>
              <strong className={state.configured ? 'status-chip' : 'low-stock'}>
                {state.configured ? 'پیکربندی شده' : 'پیکربندی نشده'}
              </strong>
              <small>
                {state.provider
                  ? `provider: ${state.provider}`
                  : key === 'sms'
                    ? 'SMS_API_KEY و SMS_LINE_NUMBER در ‎.env تنظیم نشده است'
                    : 'متغیرهای Environment تنظیم نشده است'}
              </small>
            </article>
          ))
        ) : (
          <article>
            <small>سلامت یکپارچه‌سازی</small>
            <strong>—</strong>
          </article>
        )}
        <article>
          <small>صف پیام‌رسانی</small>
          <strong>
            {health
              ? new Intl.NumberFormat('fa-IR').format(
                  Object.values(health.queue).reduce((sum, value) => sum + value, 0),
                )
              : '—'}
          </strong>
          <small>
            {health
              ? Object.entries(health.queue)
                  .map(
                    ([state, count]) => `${state}: ${new Intl.NumberFormat('fa-IR').format(count)}`,
                  )
                  .join(' · ')
              : ''}
          </small>
        </article>
      </div>

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

      {tab === 'sms' && (
        <div className="product-table">
          <div className="table-head messaging-head">
            <span>شماره</span>
            <span>قالب</span>
            <span>وضعیت</span>
            <span>provider</span>
            <span>زمان</span>
          </div>
          {smsRows.length ? (
            smsRows.map((row) => (
              <div className="table-row messaging-head" key={row.id}>
                <code dir="ltr">{formatPersianNumber(row.mobile ?? '—')}</code>
                <span>{row.template}</span>
                <span className={row.status === 'sent' ? 'status-chip' : 'low-stock'}>
                  {row.status === 'sent'
                    ? 'ارسال شد'
                    : row.status === 'failed'
                      ? `ناموفق · ${row.error ?? ''}`
                      : 'در صف'}
                </span>
                <span>{row.provider ?? '—'}</span>
                <time>{time(row.createdAt)}</time>
              </div>
            ))
          ) : (
            <div className="table-row messaging-head">
              <span className="muted">هنوز پیامکی ارسال نشده است.</span>
            </div>
          )}
        </div>
      )}

      {tab === 'channels' && (
        <div className="product-table">
          <div className="table-head messaging-head">
            <span>کانال</span>
            <span>پیام</span>
            <span>وضعیت</span>
            <span>خطا</span>
            <span>زمان</span>
          </div>
          {channelRows.length ? (
            channelRows.map((row) => (
              <div className="table-row messaging-head" key={row.id}>
                <strong>{channelLabels[row.channel] ?? row.channel}</strong>
                <span>{row.preview}</span>
                <span className={row.status === 'sent' ? 'status-chip' : 'low-stock'}>
                  {row.status === 'sent' ? 'ارسال شد' : 'ناموفق'}
                </span>
                <span>{row.error ?? '—'}</span>
                <time>{time(row.createdAt)}</time>
              </div>
            ))
          ) : (
            <div className="table-row messaging-head">
              <span className="muted">پیامی در کانال‌ها ثبت نشده است.</span>
            </div>
          )}
        </div>
      )}

      {tab === 'send' && (
        <div className="form-grid">
          <label>
            کانال
            <select value={channel} onChange={(event) => setChannel(event.target.value)}>
              <option value="sms">پیامک</option>
              <option value="telegram">تلگرام</option>
              <option value="bale">بله</option>
            </select>
          </label>
          <label>
            شمارهٔ مقصد (فقط پیامک)
            <input
              dir="ltr"
              value={mobile}
              onChange={(event) => setMobile(event.target.value)}
              placeholder="09123456789"
            />
          </label>
          <label className="messaging-wide">
            متن پیام
            <textarea rows={4} value={text} onChange={(event) => setText(event.target.value)} />
          </label>
          <button disabled={busy} onClick={() => void send()}>
            {busy ? 'در حال ثبت…' : 'قرار دادن در صف'}
          </button>
          <p className="muted messaging-wide">
            متغیرهای قالب: <code dir="ltr">{'{invoice_number}'}</code>{' '}
            <code dir="ltr">{'{amount}'}</code> <code dir="ltr">{'{link}'}</code>{' '}
            <code dir="ltr">{'{store}'}</code>. قالب اصلی فاکتور در صفحهٔ تنظیمات ذخیره می‌شود و
            هنگام صدور فاکتور به‌جای متن پیش‌فرض استفاده می‌گردد.
          </p>
        </div>
      )}

      {tab === 'queue' && (
        <div className="product-table">
          <div className="table-head messaging-head">
            <span>نوع</span>
            <span>شماره</span>
            <span>دلیل</span>
            <span>تلاش</span>
            <span>عملیات</span>
          </div>
          {failed.length ? (
            failed.map((job) => (
              <div className="table-row messaging-head" key={job.id}>
                <strong>{job.type}</strong>
                <code dir="ltr">{formatPersianNumber(job.mobile ?? '—')}</code>
                <span>{job.failedReason}</span>
                <span>{new Intl.NumberFormat('fa-IR').format(job.attemptsMade)}</span>
                <span>
                  <button
                    className="row-action"
                    onClick={async () => {
                      try {
                        await api(`/notifications/failed/${job.id}/retry`, { method: 'POST' });
                        setMessage('تلاش مجدد در صف قرار گرفت.');
                        setFailed((current) => current.filter((entry) => entry.id !== job.id));
                      } catch (error) {
                        setMessage((error as Error).message);
                      }
                    }}
                  >
                    تلاش مجدد
                  </button>
                </span>
              </div>
            ))
          ) : (
            <div className="table-row messaging-head">
              <span className="muted">پیام ناموفقی در صف نیست.</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
