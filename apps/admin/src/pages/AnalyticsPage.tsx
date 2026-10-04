import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatPersianNumber } from '@salimvand/shared';
import { api } from '../lib/api';

type Overview = {
  rangeDays: number;
  kpi: {
    today: number;
    yesterday: number;
    last7: number;
    prev7: number;
    last30: number;
    total: number;
  };
  series: Array<{ date: string; views: number }>;
  topPages: Array<{ path: string; views: number }>;
  topProducts: Array<{ productId: string; name: string; code: string; slug: string; views: number }>;
  topSearches: Array<{ term: string; searches: number }>;
};

const RANGES = [
  { id: 7, label: '۷ روز' },
  { id: 30, label: '۳۰ روز' },
  { id: 90, label: '۹۰ روز' },
] as const;

const dayLabel = new Intl.DateTimeFormat('fa-IR', { month: 'short', day: 'numeric' });

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <article className="kpi analytics-kpi">
      <small>{label}</small>
      <strong>{formatPersianNumber(value)}</strong>
      {hint ? <em>{hint}</em> : null}
    </article>
  );
}

export function AnalyticsPage() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<{ data: Overview }>(`/analytics/overview?days=${days}`)
      .then((result) => {
        if (!cancelled) setData(result.data);
      })
      .catch((error: Error) => {
        if (!cancelled) setMessage(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const weeklyChange =
    data && data.kpi.prev7 > 0
      ? Math.round(((data.kpi.last7 - data.kpi.prev7) / data.kpi.prev7) * 100)
      : null;
  const chartData = (data?.series ?? []).map((row) => ({
    ...row,
    label: dayLabel.format(new Date(`${row.date}T12:00:00`)),
  }));
  const maxSearch = Math.max(1, ...(data?.topSearches ?? []).map((row) => row.searches));
  const maxPage = Math.max(1, ...(data?.topPages ?? []).map((row) => row.views));

  return (
    <section className="analytics-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">گزارش سایت</span>
          <h1>آمار و بازدیدها</h1>
          <p className="muted">
            ترافیک سایت عمومی، پربازدیدترین محصولات و جست‌وجوهای کاربران — روزانه، هفتگی و ماهانه.
          </p>
        </div>
        <div className="tp-options analytics-ranges" role="tablist" aria-label="بازهٔ زمانی">
          {RANGES.map((range) => (
            <button
              key={range.id}
              type="button"
              role="tab"
              aria-selected={days === range.id}
              className={days === range.id ? 'active' : ''}
              onClick={() => setDays(range.id)}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {message && <div className="notice">{message}</div>}
      {loading && <div className="skeleton-block" />}

      {data && (
        <>
          <div className="cards analytics-kpis">
            <KpiCard label="بازدید امروز" value={data.kpi.today} hint="از نیمه‌شب تا الان" />
            <KpiCard label="بازدید دیروز" value={data.kpi.yesterday} />
            <KpiCard
              label="۷ روز اخیر"
              value={data.kpi.last7}
              hint={
                weeklyChange === null
                  ? undefined
                  : weeklyChange >= 0
                    ? `٪${formatPersianNumber(weeklyChange)} نسبت به هفتهٔ قبل ↑`
                    : `٪${formatPersianNumber(Math.abs(weeklyChange))} نسبت به هفتهٔ قبل ↓`
              }
            />
            <KpiCard label="۳۰ روز اخیر" value={data.kpi.last30} />
            <KpiCard label="کل بازدیدها" value={data.kpi.total} />
          </div>

          <div className="analytics-chart card">
            <h2>روند روزانهٔ بازدید</h2>
            {chartData.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 12, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid
                    stroke="var(--sv-border)"
                    strokeDasharray="3 3"
                    horizontal
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'var(--sv-text-3)' }}
                    interval="preserveStartEnd"
                    minTickGap={18}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: 'var(--sv-text-3)' }}
                    width={36}
                  />
                  <Tooltip
                    formatter={(value) => [formatPersianNumber(Number(value)), 'بازدید']}
                    contentStyle={{
                      background: 'var(--sv-surface)',
                      border: '1px solid var(--sv-border)',
                      borderRadius: 10,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="views" fill="var(--sv-primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="muted">هنوز داده‌ای ثبت نشده است.</p>
            )}
          </div>

          <div className="analytics-grid">
            <div className="card analytics-panel">
              <h2>پربازدیدترین محصولات</h2>
              {data.topProducts.length ? (
                <ol className="analytics-list">
                  {data.topProducts.map((product, index) => (
                    <li key={product.productId}>
                      <span className="analytics-rank">{formatPersianNumber(index + 1)}</span>
                      <span className="analytics-name">
                        <b>{product.name}</b>
                        <small dir="ltr">{product.code}</small>
                      </span>
                      <span className="analytics-value">
                        {formatPersianNumber(product.views)} بازدید
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">هنوز بازدید محصولی ثبت نشده است.</p>
              )}
            </div>

            <div className="card analytics-panel">
              <h2>جست‌وجوهای پرتکرار</h2>
              {data.topSearches.length ? (
                <ul className="analytics-bars">
                  {data.topSearches.map((row) => (
                    <li key={row.term}>
                      <span className="analytics-name">
                        <b>«{row.term}»</b>
                      </span>
                      <span
                        className="analytics-bar"
                        style={{ width: `${Math.max(8, (row.searches / maxSearch) * 100)}%` }}
                        aria-hidden="true"
                      />
                      <span className="analytics-value">
                        {formatPersianNumber(row.searches)} بار
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">هنوز جست‌وجویی ثبت نشده است.</p>
              )}
            </div>

            <div className="card analytics-panel">
              <h2>پربازدیدترین صفحات</h2>
              {data.topPages.length ? (
                <ul className="analytics-bars">
                  {data.topPages.map((row) => (
                    <li key={row.path}>
                      <span className="analytics-name">
                        <b dir="ltr">{row.path}</b>
                      </span>
                      <span
                        className="analytics-bar"
                        style={{ width: `${Math.max(8, (row.views / maxPage) * 100)}%` }}
                        aria-hidden="true"
                      />
                      <span className="analytics-value">{formatPersianNumber(row.views)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">هنوز بازدیدی ثبت نشده است.</p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
