import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { DonutChart } from '@salimvand/ui';
import { monthlySales, profitShare } from '../lib/report-metrics';

const SalesChart = lazy(() =>
  import('./DashboardCharts').then((module) => ({ default: module.SalesChart })),
);

type Sales = {
  summary: { invoiceCount: number; revenue: string; paid: string; outstanding: string };
  products: Array<{ name: string; quantity: number; revenue: string }>;
  invoices?: Array<{ issuedAt: string; total: string; paidAmount: string }>;
};
type CustomerReport = {
  customers: Array<{
    id: string;
    name: string;
    mobile: string;
    invoiceCount: number;
    purchased: string;
    debt: string;
  }>;
  debtors: Array<{ id: string; name: string; mobile: string; invoiceCount: number; debt: string }>;
};
type Audit = {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
  user?: { name: string } | null;
};
type SupplierReport = {
  suppliers: Array<{
    supplierId: string;
    supplierName: string;
    invoiceCount: number;
    total: string;
    paidAmount: string;
    debt: string;
  }>;
  totalDebt: string;
};
type ProfitReport = {
  summary: { revenue: string; cost: string; profit: string };
  brands: Array<{ brand: string; quantity: number; revenue: string; cost: string; profit: string }>;
};
const money = (value: string | number) =>
  `${new Intl.NumberFormat('fa-IR').format(Number(value))} ریال`;

export function ReportsPage() {
  const [sales, setSales] = useState<Sales | null>(null);
  const [profit, setProfit] = useState<ProfitReport | null>(null);
  const [customers, setCustomers] = useState<CustomerReport | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierReport | null>(null);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const query =
    from || to
      ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}`
      : '';
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, profitResult, c, p, a] = await Promise.all([
        api<{ data: Sales }>(`/reports/sales${query}`),
        api<{ data: ProfitReport }>(`/reports/profit${query}`),
        api<{ data: CustomerReport }>('/reports/customers'),
        api<{ data: SupplierReport }>('/reports/purchase-debts'),
        api<{ data: Audit[] }>('/dashboard/audit?pageSize=20'),
      ]);
      setSales(s.data);
      setProfit(profitResult.data);
      setCustomers(c.data);
      setSuppliers(p.data);
      setAudit(a.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query]);
  useEffect(() => {
    void load();
  }, [load]);
  const exportSales = () =>
    void downloadFile(`/reports/sales/export${query}`, 'salimvand-sales.csv').catch((e: Error) =>
      setError(e.message),
    );
  return (
    <section>
      <div className="page-title">
        <div>
          <span className="eyebrow">تحلیل داده</span>
          <h1>گزارش‌ها</h1>
          <p className="muted">فروش، سود، مطالبات و رویدادهای حساس سیستم</p>
        </div>
        <button className="button-primary" onClick={exportSales}>
          خروجی CSV فروش
        </button>
        <button
          className="button-primary"
          onClick={() =>
            void downloadFile(
              '/reports/purchase-debts/export',
              'salimvand-supplier-debts.csv',
            ).catch((e: Error) => setError(e.message))
          }
        >
          خروجی بدهی تأمین
        </button>
      </div>
      <div className="report-filters">
        <label>
          از تاریخ
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          تا تاریخ
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button onClick={() => void load()} disabled={loading}>
          {loading ? 'در حال بارگذاری...' : 'اعمال بازه'}
        </button>
        <button
          className="outline"
          onClick={() => {
            setFrom('');
            setTo('');
          }}
        >
          پاک کردن
        </button>
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="cards dashboard-cards">
        <article>
          <small>تعداد فاکتور</small>
          <strong>{sales?.summary.invoiceCount ?? '—'}</strong>
        </article>
        <article>
          <small>فروش</small>
          <strong>{sales ? money(sales.summary.revenue) : '—'}</strong>
        </article>
        <article>
          <small>دریافت‌شده</small>
          <strong>{sales ? money(sales.summary.paid) : '—'}</strong>
        </article>
        <article>
          <small>مطالبات</small>
          <strong className="low-stock">{sales ? money(sales.summary.outstanding) : '—'}</strong>
        </article>
      </div>
      <div className="cards dashboard-cards profit-cards">
        <article>
          <small>فروش ناخالص</small>
          <strong>{profit ? money(profit.summary.revenue) : '—'}</strong>
        </article>
        <article>
          <small>هزینهٔ خرید</small>
          <strong>{profit ? money(profit.summary.cost) : '—'}</strong>
        </article>
        <article>
          <small>سود ناخالص</small>
          <strong
            className={profit && Number(profit.summary.profit) >= 0 ? 'status-chip' : 'low-stock'}
          >
            {profit ? money(profit.summary.profit) : '—'}
          </strong>
        </article>
      </div>
      <div className="history">
        <h2>سود تفکیک‌شده بر اساس برند</h2>
        {profit?.brands
          .sort((a, b) => Number(b.profit) - Number(a.profit))
          .slice(0, 10)
          .map((row) => (
            <div key={row.brand}>
              <span>
                {row.brand}
                <small>{row.quantity} عدد</small>
              </span>
              <b>{money(row.revenue)}</b>
              <strong className={Number(row.profit) >= 0 ? 'status-chip' : 'low-stock'}>
                {money(row.profit)}
              </strong>
            </div>
          ))}
        {profit && profit.brands.length === 0 && (
          <p className="muted">داده‌ای در این بازه وجود ندارد.</p>
        )}
      </div>
      <div className="dashboard-chart-card">
        <div className="chart-header">
          <div>
            <h2>روند ماهانهٔ فروش</h2>
            <p className="muted">جمع فاکتورها بر اساس ماه شمسی</p>
          </div>
        </div>
        <Suspense
          fallback={<div className="dashboard-chart-loading">در حال آماده‌سازی نمودار…</div>}
        >
          <SalesChart
            data={monthlySales(sales?.invoices ?? []).map((bucket) => ({
              ...bucket,
              revenue: String(bucket.revenue),
              paid: String(bucket.paid),
            }))}
          />
        </Suspense>
      </div>
      <div className="dashboard-chart-card">
        <div className="chart-header">
          <div>
            <h2>سهم برندها از سود</h2>
            <p className="muted">دونات سود تفکیک‌شده بر اساس برند</p>
          </div>
        </div>
        <DonutChart data={profitShare(profit?.brands ?? [])} />
      </div>
      <div className="history">
        <h2>محصولات پرفروش</h2>
        {sales?.products.slice(0, 10).map((row) => (
          <div key={row.name}>
            <span>{row.name}</span>
            <b>{row.quantity} عدد</b>
            <span>{money(row.revenue)}</span>
          </div>
        ))}
        {sales?.products.length === 0 && <p className="muted">داده‌ای در این بازه وجود ندارد.</p>}
      </div>
      <div className="history">
        <h2>بدهکاران برتر</h2>
        {customers?.debtors.slice(0, 10).map((row) => (
          <div key={row.id}>
            <span>{row.name}</span>
            <small>
              {row.mobile} · {row.invoiceCount} فاکتور
            </small>
            <b className="low-stock">{money(row.debt)}</b>
          </div>
        ))}
        {customers && customers.debtors.length === 0 && (
          <p className="muted">در حال حاضر مشتری بدهکاری وجود ندارد.</p>
        )}
      </div>
      <div className="history">
        <h2>بدهی تأمین‌کنندگان</h2>
        <div>
          <strong>مجموع بدهی</strong>
          <b className="low-stock">{suppliers ? money(suppliers.totalDebt) : '—'}</b>
        </div>
        {suppliers?.suppliers
          .filter((row) => Number(row.debt) > 0)
          .slice(0, 10)
          .map((row) => (
            <div key={row.supplierId}>
              <span>{row.supplierName}</span>
              <small>{row.invoiceCount} فاکتور خرید</small>
              <b className="low-stock">{money(row.debt)}</b>
            </div>
          ))}
        {suppliers && suppliers.suppliers.every((row) => Number(row.debt) <= 0) && (
          <p className="muted">در حال حاضر بدهی تأمین‌کننده‌ای وجود ندارد.</p>
        )}
      </div>
      <div className="history">
        <h2>آخرین Auditها</h2>
        {audit.length ? (
          audit.map((row) => (
            <div key={String(row.id)}>
              <span>{row.entityType}</span>
              <small>{row.action}</small>
              <span>{row.user?.name ?? 'سیستم'}</span>
              <time>{new Date(row.createdAt).toLocaleString('fa-IR')}</time>
            </div>
          ))
        ) : (
          <p className="muted">رویدادی ثبت نشده است.</p>
        )}
      </div>
    </section>
  );
}
