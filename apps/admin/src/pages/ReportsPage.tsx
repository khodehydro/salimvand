import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { formatPersianNumber } from '@salimvand/shared';
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
type SupplierCheckReport = { id: string; checkNumber?: string | null; bank?: string | null; amount: string; dueDate: string; status: string; invoice: { number: string; supplierName: string } };
type ReturnReport = { rows: Array<{ id: string; invoice: { number: string; customerName?: string | null }; product: string; quantity: number; refundAmount: string; reason: string; restock: boolean; createdAt: string }>; products: Array<{ name: string; quantity: number; amount: string }>; customers: Array<{ name: string; count: number; amount: string }> };
type CheckReport = { id: string; checkNumber?: string | null; bank?: string | null; branch?: string | null; amount: string; dueDate: string; status: string; invoice: { number: string; customerName?: string | null } };
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
  const [checks, setChecks] = useState<CheckReport[]>([]);
  const [returns, setReturns] = useState<ReturnReport | null>(null);
  const [supplierChecks, setSupplierChecks] = useState<SupplierCheckReport[]>([]);
  const [checkStatus, setCheckStatus] = useState('');
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
      const [s, profitResult, c, p, a, checkResult, returnResult, supplierCheckResult] = await Promise.all([
        api<{ data: Sales }>(`/reports/sales${query}`),
        api<{ data: ProfitReport }>(`/reports/profit${query}`),
        api<{ data: CustomerReport }>('/reports/customers'),
        api<{ data: SupplierReport }>('/reports/purchase-debts'),
        api<{ data: Audit[] }>('/dashboard/audit?pageSize=20'),
        api<{ data: CheckReport[] }>(`/reports/checks${query}${query ? '&' : '?'}${new URLSearchParams({ ...(checkStatus ? { status: checkStatus } : {}) }).toString()}`),
        api<{ data: ReturnReport }>(`/reports/returns${query}`),
        api<{ data: SupplierCheckReport[] }>(`/reports/supplier-checks${checkStatus ? `?status=${checkStatus}` : ''}`),
      ]);
      setSales(s.data);
      setProfit(profitResult.data);
      setCustomers(c.data);
      setSuppliers(p.data);
      setAudit(a.data);
      setChecks(checkResult.data ?? []);
      setReturns(returnResult.data);
      setSupplierChecks(supplierCheckResult.data ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, checkStatus]);
  useEffect(() => {
    void load();
  }, [load]);
  const printReturns = () => {
    const win = window.open('', '_blank', 'width=1000,height=800'); if (!win) return;
    const date = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full' }).format(new Date());
    const rows = (returns?.rows ?? []).map((row) => `<tr><td>${row.invoice.number}</td><td>${row.invoice.customerName ?? 'حضوری'}</td><td>${row.product}</td><td>${row.quantity}</td><td>${money(row.refundAmount)}</td><td>${row.restock ? 'بازگشت به انبار' : 'ضایعات'}</td><td>${row.reason}</td></tr>`).join('');
    win.document.write(`<html dir="rtl"><head><meta charset="utf-8"><title>گزارش مرجوعی کالا</title><style>body{font-family:Vazirmatn,Tahoma,sans-serif;padding:24px;color:#17243b}h1{font-size:20px}p{color:#64748b;font-size:11px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #ccd5df;padding:8px;text-align:right}th{background:#edf2f7}</style></head><body><h1>گزارش مرجوعی کالا</h1><p>تاریخ خروجی: ${date}</p><table><thead><tr><th>فاکتور</th><th>مشتری</th><th>محصول</th><th>تعداد</th><th>مبلغ برگشت</th><th>مقصد</th><th>دلیل</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`); win.document.close();
  };
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
        <button className="outline" onClick={printReturns}>
          چاپ گزارش مرجوعی
        </button>
        <button className="outline" onClick={() => void downloadFile('/reports/returns/export', 'salimvand-returns.csv').catch((e: Error) => setError(e.message))}>خروجی مرجوعی</button>
        <button className="outline" onClick={() => void downloadFile('/reports/checks/export', 'salimvand-checks.csv').catch((e: Error) => setError(e.message))}>خروجی چک‌ها</button>
        <button className="outline" onClick={() => void downloadFile('/reports/supplier-checks/export', 'salimvand-supplier-checks.csv').catch((e: Error) => setError(e.message))}>خروجی چک تأمین</button>
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
          <strong>{sales ? formatPersianNumber(sales.summary.invoiceCount) : '—'}</strong>
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
      <section className="card checks-report-card"><div className="card-h"><h2>چک‌های تأمین‌کنندگان</h2></div><div className="report-check-table"><div className="thead"><span>فاکتور خرید</span><span>تأمین‌کننده</span><span>بانک/شماره</span><span>سررسید</span><span>مبلغ</span><span>وضعیت</span></div>{supplierChecks.map((check) => <div className="trow" key={check.id}><span>{check.invoice.number}</span><span>{check.invoice.supplierName}</span><span>{check.bank ?? '—'} · {check.checkNumber ?? '—'}</span><span>{new Intl.DateTimeFormat('fa-IR').format(new Date(check.dueDate))}</span><b>{money(check.amount)}</b><span>{({ pending: 'در انتظار', cleared: 'وصول‌شده', bounced: 'برگشتی', cancelled: 'لغوشده' } as Record<string, string>)[check.status] ?? check.status}</span></div>)}</div>{!supplierChecks.length && <p className="muted">چک تأمین‌کننده‌ای ثبت نشده است.</p>}</section>
      <section className="card checks-report-card">
        <div className="card-h"><h2>گزارش مرجوعی کالا</h2><span className="badge b-warn">{formatPersianNumber(returns?.rows.length ?? 0)} مورد</span></div>
        <div className="report-check-table"><div className="thead"><span>فاکتور</span><span>مشتری</span><span>محصول</span><span>تعداد</span><span>مبلغ برگشت</span><span>نوع</span></div>{returns?.rows.slice(0, 100).map((row) => <div className="trow" key={row.id}><span>{row.invoice.number}</span><span>{row.invoice.customerName ?? 'حضوری'}</span><span>{row.product}</span><span>{formatPersianNumber(row.quantity)}</span><b>{money(row.refundAmount)}</b><span>{row.restock ? 'بازگشت به انبار' : 'ضایعات'}</span></div>)}</div>{!returns?.rows.length && <p className="muted">مرجوعی‌ای در این بازه ثبت نشده است.</p>}<h3 className="list-subhead">مشتریانی با بیشترین مرجوعی</h3><div className="customer-products">{(returns?.customers ?? []).slice(0, 5).map((customer) => <span key={customer.name}>{customer.name} · {formatPersianNumber(customer.count)} قلم · {money(customer.amount)}</span>)}</div></section>
      <section className="card checks-report-card">
        <div className="card-h"><h2>گزارش چک‌ها</h2><select value={checkStatus} onChange={(e) => setCheckStatus(e.target.value)}><option value="">همه وضعیت‌ها</option><option value="pending">در انتظار</option><option value="cleared">وصول‌شده</option><option value="bounced">برگشتی</option><option value="cancelled">لغوشده</option></select></div>
        <div className="report-check-table"><div className="thead"><span>فاکتور</span><span>مشتری</span><span>بانک/شماره</span><span>سررسید</span><span>مبلغ</span><span>وضعیت</span></div>{checks.map((check) => <div className="trow" key={check.id}><span>{check.invoice.number}</span><span>{check.invoice.customerName ?? 'حضوری'}</span><span>{check.bank ?? '—'} · {check.checkNumber ?? '—'}</span><span>{new Intl.DateTimeFormat('fa-IR').format(new Date(check.dueDate))}</span><b>{money(check.amount)}</b><span>{({ pending: 'در انتظار', cleared: 'وصول‌شده', bounced: 'برگشتی', cancelled: 'لغوشده' } as Record<string, string>)[check.status] ?? check.status}</span></div>)}</div>{!checks.length && <p className="muted">چکی با این فیلتر پیدا نشد.</p>}
      </section>
      <div className="history">
        <h2>سود تفکیک‌شده بر اساس برند</h2>
        {profit?.brands
          .sort((a, b) => Number(b.profit) - Number(a.profit))
          .slice(0, 10)
          .map((row) => (
            <div key={row.brand}>
              <span>
                {row.brand}
                <small>{formatPersianNumber(row.quantity)} عدد</small>
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
            <b>{formatPersianNumber(row.quantity)} عدد</b>
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
              {formatPersianNumber(row.mobile)} · {formatPersianNumber(row.invoiceCount)} فاکتور
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
              <small>{formatPersianNumber(row.invoiceCount)} فاکتور خرید</small>
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
