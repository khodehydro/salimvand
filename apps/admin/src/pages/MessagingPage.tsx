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
  { id: 'config', label: 'پیکربندی' },
  { id: 'sms', label: 'پیامک‌ها' },
  { id: 'channels', label: 'تلگرام و بله' },
  { id: 'send', label: 'ارسال آزمایشی' },
  { id: 'queue', label: 'صف و خطاها' },
] as const;
type Tab = (typeof tabs)[number]['id'];

type MessagingConfig = {
  sms?: { apiKey?: string; lineNumber?: string };
  telegram?: { botToken?: string; chatId?: string; passwordRecoveryChatId?: string; apiBase?: string; proxySecret?: string };
  bale?: { botToken?: string; chatId?: string; botId?: string; apiAccessKey?: string };
};
type MessagingDraft = {
  smsApiKey: string;
  smsLineNumber: string;
  telegramBotToken: string;
  telegramChatId: string;
  telegramPasswordRecoveryChatId: string;
  telegramApiBase: string;
  telegramProxySecret: string;
  baleBotToken: string;
  baleBotId: string;
  baleApiAccessKey: string;
  baleChatId: string;
};
const emptyDraft: MessagingDraft = {
  smsApiKey: '',
  smsLineNumber: '',
  telegramBotToken: '',
  telegramChatId: '',
  telegramPasswordRecoveryChatId: '',
  telegramApiBase: '',
  telegramProxySecret: '',
  baleBotToken: '',
  baleBotId: '',
  baleApiAccessKey: '',
  baleChatId: '',
};

const channelLabels: Record<string, string> = { sms: 'پیامک', telegram: 'تلگرام', bale: 'بله' };
const time = (value: string) => new Date(value).toLocaleString('fa-IR');

export function MessagingPage() {
  const [tab, setTab] = useState<Tab>('config');
  const [smsRows, setSmsRows] = useState<SmsRow[]>([]);
  const [channelRows, setChannelRows] = useState<ChannelRow[]>([]);
  const [failed, setFailed] = useState<FailedJob[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [message, setMessage] = useState('');
  const [channel, setChannel] = useState('sms');
  const [mobile, setMobile] = useState('');
  const [text, setText] = useState('فاکتور {invoice_number} به مبلغ {amount} ریال — {link}');
  const [busy, setBusy] = useState(false);
  const [messaging, setMessaging] = useState<MessagingConfig>({});
  const [draft, setDraft] = useState<MessagingDraft>(emptyDraft);

  const loadConfig = () => {
    void api<{ data: Record<string, unknown> }>('/settings')
      .then((result) => {
        const config = (result.data['integrations.messaging'] ?? {}) as MessagingConfig;
        setMessaging(config);
        setDraft({
          smsApiKey: '',
          smsLineNumber: config.sms?.lineNumber ?? '',
          telegramBotToken: '',
          telegramChatId: config.telegram?.chatId ?? '',
          telegramPasswordRecoveryChatId: config.telegram?.passwordRecoveryChatId ?? '',
          telegramApiBase: config.telegram?.apiBase ?? '',
          telegramProxySecret: '',
          baleBotToken: '',
          baleBotId: config.bale?.botId ?? '',
          baleApiAccessKey: '',
          baleChatId: config.bale?.chatId ?? '',
        });
      })
      .catch(() => undefined);
  };

  const updateDraft = (key: keyof MessagingDraft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const saveConfig = async () => {
    setBusy(true);
    setMessage('');
    try {
      const payload: MessagingConfig = {
        sms: { lineNumber: draft.smsLineNumber.trim() || undefined },
        telegram: {
          chatId: draft.telegramChatId.trim() || undefined,
          passwordRecoveryChatId: draft.telegramPasswordRecoveryChatId.trim() || undefined,
          apiBase: draft.telegramApiBase.trim() || undefined,
        },
        bale: {
          chatId: draft.baleChatId.trim() || undefined,
          botId: draft.baleBotId.trim() || undefined,
        },
      };
      // Secrets are only sent when the operator typed a fresh value; an empty
      // field keeps the stored credential (the server merges masked values).
      if (draft.smsApiKey.trim()) payload.sms!.apiKey = draft.smsApiKey.trim();
      if (draft.telegramBotToken.trim()) payload.telegram!.botToken = draft.telegramBotToken.trim();
      if (draft.telegramProxySecret.trim())
        payload.telegram!.proxySecret = draft.telegramProxySecret.trim();
      if (draft.baleBotToken.trim()) payload.bale!.botToken = draft.baleBotToken.trim();
      if (draft.baleApiAccessKey.trim()) payload.bale!.apiAccessKey = draft.baleApiAccessKey.trim();
      await api('/settings', {
        method: 'PUT',
        body: JSON.stringify({ 'integrations.messaging': payload }),
      });
      setMessage('پیکربندی ذخیره شد؛ برای اطمینان از تب «ارسال آزمایشی» استفاده کنید.');
      load();
      loadConfig();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
    loadConfig();
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
                  : 'از تب «پیکربندی» یا متغیرهای ‎.env تنظیم کنید'}
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

      {tab === 'config' && (
        <div className="form-grid messaging-config">
          <p className="muted messaging-wide">
            این مقادیر در دیتابیس ذخیره می‌شوند و بر متغیرهای ‎.env اولویت دارند؛ برای تغییرشان
            نیازی به ورود به سرور نیست. فیلدهای محرمانه فقط به‌صورت ماسک‌شده نمایش داده می‌شوند —
            برای تغییر، مقدار جدید را کامل وارد کنید؛ فیلد خالی یعنی مقدار فعلی حفظ شود.
          </p>
          <fieldset>
            <legend>پیامک (sms.ir)</legend>
            <label>
              کلید API — از پنل کاربری sms.ir «تنظیمات ← کلید API»
              <input
                dir="ltr"
                type="password"
                value={draft.smsApiKey}
                placeholder={messaging.sms?.apiKey || 'مثال: a1b2c3d4...'}
                onChange={(event) => updateDraft('smsApiKey', event.target.value)}
              />
            </label>
            <label>
              شمارهٔ خط ارسال (برای متد «ارسال گروهی»)
              <input
                dir="ltr"
                value={draft.smsLineNumber}
                placeholder="مثال: 30005157000000"
                onChange={(event) => updateDraft('smsLineNumber', event.target.value)}
              />
            </label>
          </fieldset>
          <fieldset>
            <legend>ربات تلگرام</legend>
            <label>
              توکن ربات — از @BotFather
              <input
                dir="ltr"
                type="password"
                value={draft.telegramBotToken}
                placeholder={messaging.telegram?.botToken || 'مثال: 123456:ABC-...'}
                onChange={(event) => updateDraft('telegramBotToken', event.target.value)}
              />
            </label>
            <label>
              شناسهٔ چت/کانال مقصد اعلان‌ها
              <input
                dir="ltr"
                value={draft.telegramChatId}
                placeholder="مثال: -1001234567890"
                onChange={(event) => updateDraft('telegramChatId', event.target.value)}
              />
            </label>
            <label>
              شناسهٔ عددی مدیر برای بازیابی رمز
              <input dir="ltr" inputMode="numeric" value={draft.telegramPasswordRecoveryChatId} placeholder="مثال: 8686398534" onChange={(event) => updateDraft('telegramPasswordRecoveryChatId', event.target.value)} />
              <small className="field-hint">لینک فراموشی رمز فقط به این شناسه ارسال می‌شود.</small>
            </label>
            <label>
              آدرس تلگرام — وورکر کلادفلر (برای انتشار در کانال)
              <input
                dir="ltr"
                value={draft.telegramApiBase}
                placeholder={
                  messaging.telegram?.apiBase || 'https://salimvand-telegram-proxy….workers.dev'
                }
                onChange={(event) => updateDraft('telegramApiBase', event.target.value)}
              />
            </label>
            <label>
              رمز پروکسی وورکر (باید با رمز خود وورکر یکی باشد)
              <input
                dir="ltr"
                type="password"
                value={draft.telegramProxySecret}
                placeholder={messaging.telegram?.proxySecret || 'رمز مشترک'}
                onChange={(event) => updateDraft('telegramProxySecret', event.target.value)}
              />
            </label>
          </fieldset>
          <fieldset>
            <legend>ربات بله</legend>
            <label>
              توکن ربات بله
              <input
                dir="ltr"
                type="password"
                value={draft.baleBotToken}
                placeholder={messaging.bale?.botToken || 'مثال: 123456:ABC-...'}
                onChange={(event) => updateDraft('baleBotToken', event.target.value)}
              />
            </label>
            <label>
              شناسهٔ عددی ربات بله (bot_id)
              <input
                dir="ltr"
                value={draft.baleBotId}
                placeholder="مثال: 123456789"
                onChange={(event) => updateDraft('baleBotId', event.target.value)}
              />
            </label>
            <label>
              API Access Key سرویس سفیر بله
              <input
                dir="ltr"
                type="password"
                value={draft.baleApiAccessKey}
                placeholder={messaging.bale?.apiAccessKey || 'از business.bale.ai'}
                onChange={(event) => updateDraft('baleApiAccessKey', event.target.value)}
              />
            </label>
            <label>
              شناسهٔ چت/کانال مقصد برای اعلان‌های قدیمی
              <input
                dir="ltr"
                value={draft.baleChatId}
                placeholder="اختیاری؛ برای تست یا اعلان کانال"
                onChange={(event) => updateDraft('baleChatId', event.target.value)}
              />
            </label>
          </fieldset>
          <div className="messaging-wide">
            <button className="button-primary" disabled={busy} onClick={() => void saveConfig()}>
              {busy ? 'در حال ذخیره…' : 'ذخیرهٔ پیکربندی'}
            </button>
          </div>
          <p className="muted messaging-wide">
            پس از ذخیره، بدون ری‌استارت سرویس‌ها اعمال می‌شود؛ وضعیت هر کانال در کارت‌های بالای همین
            صفحه («پیکربندی شده / نشده») قابل بررسی است. ثبت webhook ربات‌ها همچنان یک‌بار از طریق
            مستندات (بخش پیام‌رسانی) انجام می‌شود.
          </p>
        </div>
      )}

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
