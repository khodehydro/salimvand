import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { formatPersianNumber } from '@salimvand/shared';
import { locationChip } from '../lib/location-label';
import { api } from '../lib/api';
import type { AdminPage } from '../lib/admin-route';
import { DonutChart } from '@salimvand/ui';
import {
  brandComposition,
  categoryComposition,
  debtReminderMessage,
  totalDebt,
} from '../lib/dashboard-metrics';
import type { ProfitTrend } from './DashboardCharts';
const DashboardCharts = {
  SalesChart: lazy(() =>
    import('./DashboardCharts').then((module) => ({ default: module.SalesChart })),
  ),
  InventoryChart: lazy(() =>
    import('./DashboardCharts').then((module) => ({ default: module.InventoryChart })),
  ),
  ProfitChart: lazy(() =>
    import('./DashboardCharts').then((module) => ({ default: module.ProfitChart })),
  ),
};

type Summary = {
  products: number;
  inventoryItems: number;
  lowStock: number;
  lowStockItems: Array<{
    id: string;
    quantity: number;
    minStock: number | null;
    product: { name: string; code: string };
    brand?: { name: string } | null;
    location?: { code: string; name: string; parent?: { name: string } | null } | null;
  }>;
  stockComposition: StockRow[];
  categoryComposition: Array<{
    quantity: number;
    product?: { category?: { name?: string } | null } | null;
  }>;
  unpaidInvoices?: number;
  productsWithoutImages?: number;
  productsWithoutPartNumber?: number;
  productsWithoutVehicles?: number;
  productsWithoutBrand?: number;
  inventoryWithoutLocation?: number;
  productsWithoutSalePrice?: number;
  pendingPurchases?: number;
  todaySales?: string;
  todayReceived?: string;
  todayInvoiceCount?: number;
  dueChecks?: Array<{ id: string; checkNumber?: string | null; bank?: string | null; amount: string; dueDate: string; invoice: { id: string; number: string; customerName?: string | null } }>;
  recentTransactions: Array<{
    id: string;
    type: string;
    quantityChange: number;
    quantityAfter?: number;
    createdAt: string;
    item?: { product?: { name: string }; brand?: { name: string } };
  }>;
};
type Trend = { date: string; revenue: string; paid: string; invoiceCount: number };
type Debtor = { id: string; name: string; mobile: string; debt: string; invoiceCount: number };
type StockRow = { quantity: number; minStock?: number | null; brand?: { name: string } | null };
type Health = {
  channels: Record<string, { configured: boolean; provider: string | null }>;
  queue: Record<string, number>;
};
type FailedNotification = { id: string; failedReason: string; type: string; attemptsMade: number };
/** GET /dashboard/system — server RAM/disk usage (managers only). */
type SystemStats = {
  memory: { total: number; used: number; free: number };
  disk: { total: number; used: number; free: number } | null;
  uptimeSeconds: number;
};
const channelLabels: Record<string, string> = {
  sms: 'پیامک فاکتور',
  telegram: 'ربات تلگرام',
  bale: 'بله',
};
type InventoryTrend = { date: string; inbound: number; outbound: number; returns: number };
const transactionLabels: Record<string, string> = {
  initial: 'موجودی اولیه',
  purchase: 'ورود کالا',
  sale: 'فروش',
  return: 'مرجوعی',
  adjustment: 'اصلاح موجودی',
  transfer: 'جابه‌جایی قفسه',
};
const faNum = (value: number | string) => new Intl.NumberFormat('fa-IR').format(Number(value));
const gigabytes = (bytes: number) => faNum(Math.round((bytes / 1024 ** 3) * 10) / 10);
const money = (value: number | string) => `${faNum(value)} ریال`;
/** Compact money for KPI values: ۴۸٫۶ میلیون ریال / ۱٫۲ میلیارد ریال */
const moneyCompact = (value: number) => {
  if (Math.abs(value) >= 1_000_000_000)
    return `${faNum(Math.round(value / 100_000_000) / 10)} میلیارد ریال`;
  if (Math.abs(value) >= 1_000_000) return `${faNum(Math.round(value / 100_000) / 10)} میلیون ریال`;
  return money(value);
};
const PERIODS: Array<{ days: 1 | 7 | 30 | 90; label: string }> = [
  { days: 1, label: 'امروز' },
  { days: 7, label: '۷ روز' },
  { days: 30, label: '۳۰ روز' },
  { days: 90, label: '۹۰ روز' },
];

function Ic({ name }: { name: 'money' | 'file' | 'users' | 'alert' | 'refresh' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {name === 'money' && (
        <>
          <path d="M12 2v20" />
          <path d="M17 6.5H9.75a3.75 3.75 0 0 0 0 7.5h4.5a3.75 3.75 0 0 1 0 7.5H6" />
        </>
      )}
      {name === 'file' && (
        <>
          <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v5h5" />
          <path d="M9 13h6M9 17h4" />
        </>
      )}
      {name === 'users' && (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
          <circle cx="9.5" cy="7" r="4" />
          <path d="M21 21v-2a4 4 0 0 0-3-3.87M16.5 3.13a4 4 0 0 1 0 7.75" />
        </>
      )}
      {name === 'alert' && (
        <>
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <path d="M12 9v4M12 17h.01" />
        </>
      )}
      {name === 'refresh' && (
        <>
          <path d="M21 12a9 9 0 1 1-2.6-6.4" />
          <path d="M21 3v6h-6" />
        </>
      )}
    </svg>
  );
}

export function DashboardPage({
  canViewSales = true,
  canViewInventory = true,
  canViewProfit = true,
  canViewDebtors = true,
  canViewHealth = true,
  canNotify = true,
  onNavigate,
}: {
  onNavigate?: (page: AdminPage) => void;
  canViewSales?: boolean;
  canViewInventory?: boolean;
  canViewProfit?: boolean;
  canViewDebtors?: boolean;
  canViewHealth?: boolean;
  canNotify?: boolean;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trend, setTrend] = useState<Trend[]>([]);
  const [inventoryTrend, setInventoryTrend] = useState<InventoryTrend[]>([]);
  const [profitTrend, setProfitTrend] = useState<ProfitTrend[]>([]);
  const [periodDays, setPeriodDays] = useState<1 | 7 | 30 | 90>(30);
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [failedNotifications, setFailedNotifications] = useState<FailedNotification[]>([]);
  const [system, setSystem] = useState<SystemStats | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const query = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - (periodDays - 1) * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return `?from=${iso(from)}&to=${iso(to)}`;
  }, [periodDays]);
  const periodLabel = PERIODS.find((p) => p.days === periodDays)?.label ?? '۳۰ روز';
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [s, t, i, p, d, h, n, sys] = await Promise.all([
        api<{ data: Summary }>('/dashboard/summary'),
        canViewSales
          ? api<{ data: Trend[] }>(`/dashboard/sales-trend${query}`)
          : Promise.resolve({ data: [] as Trend[] }),
        canViewInventory
          ? api<{ data: InventoryTrend[] }>(`/dashboard/inventory-trend${query}`)
          : Promise.resolve({ data: [] as InventoryTrend[] }),
        canViewProfit
          ? api<{ data: ProfitTrend[] }>(`/dashboard/profit-trend${query}`)
          : Promise.resolve({ data: [] as ProfitTrend[] }),
        canViewDebtors
          ? api<{ data: Debtor[] }>('/customers/debtors')
          : Promise.resolve({ data: [] as Debtor[] }),
        canViewHealth
          ? api<{ data: Health }>('/notifications/health')
          : Promise.resolve({ data: null as Health | null }),
        canNotify
          ? api<{ data: FailedNotification[] }>('/notifications/failed?limit=10')
          : Promise.resolve({ data: [] as FailedNotification[] }),
        canViewHealth
          ? api<{ data: SystemStats }>('/dashboard/system')
          : Promise.resolve({ data: null as SystemStats | null }),
      ]);
      setSummary(s.data);
      setTrend(t.data);
      setInventoryTrend(i.data);
      setProfitTrend(p.data);
      setDebtors(d.data);
      setHealth(h.data);
      setFailedNotifications(n.data);
      setSystem(sys.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // KPI deltas: compare the latest day of the trend with the day before.
  const last = trend.at(-1);
  const prev = trend.at(-2);
  const revenueToday = last ? Number(last.revenue) : 0;
  const revenueDelta =
    last && prev && Number(prev.revenue) > 0
      ? Math.round(((Number(last.revenue) - Number(prev.revenue)) / Number(prev.revenue)) * 100)
      : null;
  const invoiceToday = last?.invoiceCount ?? 0;
  const invoiceDelta = last && prev ? invoiceToday - prev.invoiceCount : null;
  const donutData = categoryComposition(summary?.categoryComposition ?? []);
  const donutFallback = donutData.length
    ? donutData
    : brandComposition(summary?.stockComposition ?? []);
  const todayLabel = new Intl.DateTimeFormat('fa-IR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
  const timeLabel = (iso: string) =>
    new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

  return (
    <section className="dash-page">
      <div className="page-h">
        <div>
          <h2>داشبورد</h2>
          <div className="crumb">
            <span>خانه</span>
            <i>·</i>
            <span>امروز، {todayLabel}</span>
          </div>
        </div>
        <div className="page-h-tools">
          <div className="seg" role="tablist" aria-label="بازهٔ گزارش">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                className={periodDays === p.days ? 'on' : ''}
                onClick={() => setPeriodDays(p.days)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button className="icon-btn" title="به‌روزرسانی" onClick={load} disabled={loading}>
            <Ic name="refresh" />
          </button>
        </div>
      </div>
      {error && <div className="notice">{error}</div>}
      {loading && !summary && <div className="notice">در حال دریافت اطلاعات داشبورد...</div>}

      <section className="ops-today-grid" aria-label="خلاصهٔ عملیاتی امروز">
        <article className="ops-today-card primary"><small>فروش امروز</small><strong>{money(summary?.todaySales ?? 0)}</strong><span>{faNum(summary?.todayInvoiceCount ?? 0)} فاکتور صادرشده</span></article>
        <article className="ops-today-card success"><small>دریافت‌شده امروز</small><strong>{money(summary?.todayReceived ?? 0)}</strong><span>پرداخت‌های ثبت‌شده امروز</span></article>
        <article className="ops-today-card warn"><small>فاکتورهای باز</small><strong>{faNum(summary?.unpaidInvoices ?? 0)}</strong><span>نیازمند پیگیری پرداخت</span></article>
        <article className="ops-today-card danger"><small>چک‌های امروز</small><strong>{faNum(summary?.dueChecks?.filter((check) => new Date(check.dueDate).toDateString() === new Date().toDateString()).length ?? 0)}</strong><span>سررسید امروز</span></article>
      </section>

      <section className="daily-work" aria-labelledby="daily-work-title">
        <div className="daily-work-heading">
          <div>
            <h3 id="daily-work-title">کارهای امروز</h3>
            <p>مواردی که بهتر است قبل از پایان روز بررسی شوند.</p>
          </div>
          <span className="daily-work-count">{faNum([
            summary?.lowStock ?? 0,
            summary?.unpaidInvoices ?? 0,
            failedNotifications.length,
            summary?.productsWithoutImages ?? 0,
            summary?.inventoryWithoutLocation ?? 0,
            summary?.pendingPurchases ?? 0,
          ].filter((count) => count > 0).length)} مورد</span>
        </div>
        <div className="daily-work-list">
          {[
            { label: 'اقلام زیر حداقل موجودی', count: summary?.lowStock ?? 0, page: 'inventory' as AdminPage, tone: 'warn' },
            { label: 'فاکتور پرداخت‌نشده', count: summary?.unpaidInvoices ?? 0, page: 'invoices' as AdminPage, tone: 'danger' },
            { label: 'ارسال پیام ناموفق', count: failedNotifications.length, page: 'messaging' as AdminPage, tone: 'danger' },
            { label: 'محصول بدون تصویر', count: summary?.productsWithoutImages ?? 0, page: 'products' as AdminPage, tone: 'neutral' },
            { label: 'قلم بدون قفسه', count: summary?.inventoryWithoutLocation ?? 0, page: 'inventory' as AdminPage, tone: 'neutral' },
            { label: 'خرید نیازمند پیگیری', count: summary?.pendingPurchases ?? 0, page: 'purchases' as AdminPage, tone: 'neutral' },
          ].map((task) => (
            <button className={`daily-work-item ${task.tone}`} key={task.label} onClick={() => onNavigate?.(task.page)}>
              <span className="daily-work-dot" />
              <span className="daily-work-label">{task.label}</span>
              <b>{faNum(task.count)}</b>
              <span className="daily-work-arrow">←</span>
            </button>
          ))}
        </div>
      </section>

      <section className="data-quality-panel" aria-labelledby="data-quality-title">
        <div className="daily-work-heading">
          <div><h3 id="data-quality-title">کنترل کیفیت داده‌های محصولات</h3><p>موارد ناقص را تکمیل کنید تا جست‌وجو و نمایش سایت دقیق‌تر شود.</p></div>
        </div>
        <div className="data-quality-list">
          {[
            ['بدون تصویر', summary?.productsWithoutImages ?? 0],
            ['بدون شماره فنی', summary?.productsWithoutPartNumber ?? 0],
            ['بدون خودروی سازگار', summary?.productsWithoutVehicles ?? 0],
            ['بدون برند', summary?.productsWithoutBrand ?? 0],
            ['بدون قفسه', summary?.inventoryWithoutLocation ?? 0],
            ['بدون قیمت فروش', summary?.productsWithoutSalePrice ?? 0],
          ].map(([label, count]) => (
            <button className="data-quality-item" key={label} onClick={() => onNavigate?.('products')}>
              <span>{label}</span><b>{faNum(Number(count))}</b><i>ویرایش ←</i>
            </button>
          ))}
        </div>
      </section>

      <div className="kpis">
        {canViewSales ? (
          <article className="kpi" title={money(revenueToday)}>
            <div className="hd">
              <span className="ic">
                <Ic name="money" />
              </span>
              <small>فروش امروز</small>
            </div>
            <div className="v">{revenueToday ? moneyCompact(revenueToday) : '—'}</div>
            <div className="f">
              {revenueDelta === null ? (
                <span className="fl">بدون مرجع مقایسه</span>
              ) : (
                <span className={revenueDelta >= 0 ? 'up' : 'dn'}>
                  {revenueDelta >= 0 ? '▲' : '▼'} {faNum(Math.abs(revenueDelta))}٪ نسبت به دیروز
                </span>
              )}
            </div>
          </article>
        ) : (
          <article className="kpi">
            <div className="hd">
              <span className="ic">
                <Ic name="file" />
              </span>
              <small>محصولات فعال</small>
            </div>
            <div className="v">{summary ? faNum(summary.products) : '—'}</div>
            <div className="f">
              <span className="fl">کالای قابل فروش</span>
            </div>
          </article>
        )}
        {canViewSales ? (
          <article className="kpi">
            <div className="hd">
              <span className="ic">
                <Ic name="file" />
              </span>
              <small>فاکتورهای امروز</small>
            </div>
            <div className="v">
              {faNum(invoiceToday)} <small className="unit">فاکتور</small>
            </div>
            <div className="f">
              {invoiceDelta === null ? (
                <span className="fl">بدون مرجع مقایسه</span>
              ) : invoiceDelta === 0 ? (
                <span className="fl">مثل دیروز</span>
              ) : (
                <span className={invoiceDelta > 0 ? 'up' : 'dn'}>
                  {faNum(Math.abs(invoiceDelta))} فاکتور {invoiceDelta > 0 ? 'بیشتر' : 'کمتر'}
                </span>
              )}
            </div>
          </article>
        ) : (
          <article className="kpi">
            <div className="hd">
              <span className="ic">
                <Ic name="file" />
              </span>
              <small>اقلام موجودی</small>
            </div>
            <div className="v">{summary ? faNum(summary.inventoryItems) : '—'}</div>
            <div className="f">
              <span className="fl">اقلام فعال انبار</span>
            </div>
          </article>
        )}
        {canViewDebtors && (
          <article className="kpi">
            <div className="hd">
              <span className="ic">
                <Ic name="users" />
              </span>
              <small>مشتریان بدهکار</small>
            </div>
            <div className="v">
              {faNum(debtors.length)} <small className="unit">مشتری</small>
            </div>
            <div className="f">
              <span className="fl">مجموع بدهی: {moneyCompact(totalDebt(debtors))}</span>
            </div>
          </article>
        )}
        <article className="kpi alert">
          <div className="hd">
            <span className="ic">
              <Ic name="alert" />
            </span>
            <small>هشدار کمبود موجودی</small>
          </div>
          <div className="v">
            {summary ? faNum(summary.lowStock) : '—'} <small className="unit">قلم</small>
          </div>
          <div className="f">
            <span className="dn">بر اساس حداقل موجودی</span>
          </div>
        </article>
      </div>

      <Suspense
        fallback={<div className="dashboard-chart-loading">در حال آماده‌سازی نمودارها...</div>}
      >
        <div className="cols-2">
          {canViewSales && (
            <article className="card">
              <header className="card-h">
                <h3>روند فروش — {periodLabel} گذشته</h3>
                <small className="muted">فروش روزانه (میلیون ریال)</small>
              </header>
              <DashboardCharts.SalesChart data={trend} />
            </article>
          )}
          <article className="card">
            <header className="card-h">
              <h3>ترکیب موجودی بر اساس دسته</h3>
              <small className="muted">سهم هر دسته از کل موجودی انبار</small>
            </header>
            <DonutChart data={donutFallback} />
          </article>
          <article className="card check-due-card">
            <header className="card-h"><h3>سررسید چک‌ها {summary?.dueChecks?.length ? <span className="badge b-warn">{faNum(summary.dueChecks.length)} مورد</span> : null}</h3><a className="card-more" href="#/invoices">فاکتورها ›</a></header>
            {summary?.dueChecks?.length ? <div className="list-rows">{summary.dueChecks.map((check) => <div className="list-row" key={check.id}><span className="thumb">چک</span><span className="grow"><b>فاکتور {check.invoice.number}</b><small>{check.invoice.customerName ?? 'مشتری حضوری'} · {check.bank ?? 'بانک نامشخص'}</small></span><span className="badge b-danger">{money(check.amount)}</span></div>)}</div> : <p className="muted empty-line">چک با سررسید نزدیک وجود ندارد.</p>}
          </article>
        </div>

        <div className="cols-2">
          {canViewDebtors && (
            <article className="card">
              <header className="card-h">
                <h3>
                  مشتریان بدهکار
                  <span className="badge b-danger">{faNum(debtors.length)} مورد</span>
                </h3>
                <a className="card-more" href="#/customers">
                  همهٔ مشتریان ›
                </a>
              </header>
              {debtors.length ? (
                <div className="dash-tbl">
                  <div className="thead">
                    <span>مشتری</span>
                    <span>موبایل</span>
                    <span>بدهی</span>
                    <span>یادآوری</span>
                  </div>
                  {debtors.slice(0, 6).map((debtor) => (
                    <div className="trow" key={debtor.id}>
                      <b>{debtor.name}</b>
                      <code dir="ltr">{formatPersianNumber(debtor.mobile)}</code>
                      <b className="num danger">{money(debtor.debt)}</b>
                      <span>
                        {canNotify ? (
                          <button
                            className="row-action"
                            onClick={async () => {
                              try {
                                await api('/notifications/test', {
                                  method: 'POST',
                                  body: JSON.stringify({
                                    channel: 'sms',
                                    mobile: debtor.mobile,
                                    message: debtReminderMessage(debtor.name, Number(debtor.debt)),
                                  }),
                                });
                                setNotice(
                                  `یادآوری بدهی برای ${debtor.name} در صف پیامک قرار گرفت.`,
                                );
                              } catch (e) {
                                setNotice((e as Error).message);
                              }
                            }}
                          >
                            پیامک
                          </button>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted empty-line">مشتری بدهکاری وجود ندارد.</p>
              )}
            </article>
          )}
          <article className="card">
            <header className="card-h">
              <h3>
                کمبود موجودی
                {summary && summary.lowStock > 0 && (
                  <span className="badge b-danger">{faNum(summary.lowStock)} قلم</span>
                )}
              </h3>
              {canViewInventory && (
                <a className="card-more" href="#/inventory">
                  انبار ›
                </a>
              )}
            </header>
            {summary?.lowStockItems.length ? (
              <div className="list-rows">
                {summary.lowStockItems.slice(0, 5).map((row) => {
                  const min = row.minStock ?? 0;
                  const ratio = min > 0 ? Math.min(1, row.quantity / min) : 0;
                  const barClass = row.quantity <= 0 ? '' : ratio <= 0.5 ? 'mid' : 'ok';
                  return (
                    <div className="list-row" key={row.id}>
                      <span className="thumb">{row.product.name.slice(0, 2)}</span>
                      <span className="grow">
                        <b>{row.product.name}</b>
                        <small>
                          {row.brand?.name ?? 'بدون برند'}
                          {row.location ? ` · ${locationChip(row.location)}` : ''}
                        </small>
                        <i className={`stockbar ${barClass}`}>
                          <i style={{ width: `${Math.round(ratio * 100)}%` }} />
                        </i>
                      </span>
                      <span className="badge b-warn">
                        {faNum(row.quantity)} از {faNum(min || 0)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="muted empty-line">همهٔ اقلام بالاتر از حداقل موجودی هستند.</p>
            )}
          </article>
        </div>

        <div className="cols-2b">
          <article className="card">
            <header className="card-h">
              <h3>آخرین تراکنش‌های انبار</h3>
              <small className="muted">دفتر کل — غیرقابل تغییر</small>
            </header>
            {summary?.recentTransactions.length ? (
              <div className="tl">
                {summary.recentTransactions.map((row) => (
                  <div
                    className={`tl-item ${row.quantityChange < 0 ? 'neg' : 'pos'}`}
                    key={String(row.id)}
                  >
                    <b>
                      {transactionLabels[row.type] ?? row.type} —{' '}
                      {row.item?.product?.name ?? 'قلم موجودی'}
                    </b>
                    <small>
                      {row.item?.brand?.name ?? ''}
                      {row.item?.brand?.name ? ' · ' : ''}
                      {timeLabel(row.createdAt)}
                      {row.quantityAfter !== undefined
                        ? ` · موجودی بعد: ${faNum(row.quantityAfter)}`
                        : ''}
                    </small>
                    <span className={`num ${row.quantityChange < 0 ? 'danger' : 'ok'}`}>
                      {row.quantityChange > 0 ? '+' : ''}
                      {faNum(row.quantityChange)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted empty-line">تراکنشی ثبت نشده است.</p>
            )}
          </article>
          {canViewHealth && (
            <article className="card">
              <header className="card-h">
                <h3>یکپارچه‌سازی‌ها و سلامت سیستم</h3>
                <span className="badge b-line">
                  صف:{' '}
                  {health && Object.keys(health.queue).length
                    ? Object.entries(health.queue)
                        .map(([state, count]) => `${state} ${faNum(count)}`)
                        .join(' · ')
                    : 'خالی'}
                </span>
              </header>
              <div className="list-rows">
                {health
                  ? Object.entries(health.channels).map(([channel, state]) => (
                      <div className="list-row" key={channel}>
                        <span className="thumb ic-thumb">
                          <Ic name="file" />
                        </span>
                        <span className="grow">
                          <b>{channelLabels[channel] ?? channel}</b>
                          <small>{state.configured ? 'کانال فعال' : 'پیکربندی نشده'}</small>
                        </span>
                        <span className={`badge ${state.configured ? 'b-ok' : 'b-danger'}`}>
                          {state.configured
                            ? `فعال · ${state.provider ?? 'پیکربندی‌شده'}`
                            : 'غیرفعال'}
                        </span>
                      </div>
                    ))
                  : null}
                {canViewHealth && (
                  <div className="list-row">
                    <span className="thumb ic-thumb">
                      <Ic name="refresh" />
                    </span>
                    <span className="grow">
                      <b>صف پیامک</b>
                      <small>پیام‌های در انتظار ارسال</small>
                    </span>
                    <span className="badge b-ok">پایش‌شده</span>
                  </div>
                )}
                {system && (
                  <div className="list-row">
                    <span className="thumb ic-thumb">
                      <Ic name="alert" />
                    </span>
                    <span className="grow">
                      <b>حافظهٔ سرور</b>
                      <small>
                        {gigabytes(system.memory.used)} از {gigabytes(system.memory.total)} گیگابایت
                        مصرف‌شده
                      </small>
                      <i
                        className={`stockbar ${system.memory.total ? (system.memory.used / system.memory.total > 0.85 ? '' : system.memory.used / system.memory.total > 0.6 ? 'mid' : 'ok') : ''}`}
                      >
                        <i
                          style={{
                            width: `${Math.min(100, Math.round((system.memory.used / (system.memory.total || 1)) * 100))}%`,
                          }}
                        />
                      </i>
                    </span>
                    <span className="badge b-line">
                      {faNum(
                        Math.min(
                          100,
                          Math.round((system.memory.used / (system.memory.total || 1)) * 100),
                        ),
                      )}
                      ٪
                    </span>
                  </div>
                )}
                {system?.disk && (
                  <div className="list-row">
                    <span className="thumb ic-thumb">
                      <Ic name="file" />
                    </span>
                    <span className="grow">
                      <b>فضای دیسک</b>
                      <small>
                        {gigabytes(system.disk.used)} از {gigabytes(system.disk.total)} گیگابایت
                        اشغال‌شده
                      </small>
                      <i
                        className={`stockbar ${system.disk.total ? (system.disk.used / system.disk.total > 0.85 ? '' : system.disk.used / system.disk.total > 0.6 ? 'mid' : 'ok') : ''}`}
                      >
                        <i
                          style={{
                            width: `${Math.min(100, Math.round((system.disk.used / (system.disk.total || 1)) * 100))}%`,
                          }}
                        />
                      </i>
                    </span>
                    <span className="badge b-line">
                      {faNum(
                        Math.min(
                          100,
                          Math.round((system.disk.used / (system.disk.total || 1)) * 100),
                        ),
                      )}
                      ٪
                    </span>
                  </div>
                )}
              </div>
            </article>
          )}
        </div>

        {(canViewInventory || canViewProfit) && (
          <div className="cols-2b">
            {canViewInventory && (
              <article className="card">
                <header className="card-h">
                  <h3>گردش موجودی</h3>
                  <small className="muted">ورود، خروج و مرجوعی روزانه</small>
                </header>
                <DashboardCharts.InventoryChart data={inventoryTrend} />
              </article>
            )}
            {canViewProfit && (
              <article className="card">
                <header className="card-h">
                  <h3>روند سود ناخالص</h3>
                  <small className="muted">فروش، هزینهٔ خرید و سود روزانه</small>
                </header>
                <DashboardCharts.ProfitChart data={profitTrend} />
              </article>
            )}
          </div>
        )}
      </Suspense>
      {notice && <div className="notice">{notice}</div>}
    </section>
  );
}
