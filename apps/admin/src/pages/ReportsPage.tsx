import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { formatPersianNumber } from '@salimvand/shared';
import { DonutChart } from '@salimvand/ui';
import { monthlySales, profitShare } from '../lib/report-metrics';
import { JalaliDateInput } from '../components/JalaliDateInput';

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

type ReportTab = 'sales' | 'checks' | 'returns' | 'debts' | 'charts';

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
  const [activeTab, setActiveTab] = useState<ReportTab>('sales');

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

  const totalReports = (sales?.summary.invoiceCount ?? 0) + (checks.length ?? 0) + (returns?.rows.length ?? 0);

  return (
    <section className="reports-page dash-page">
      {/* ── Header: same as dashboard & invoices (page-h + crumb + tools) ── */}
      <div className="page-h">
        <div>
          <h2>گزارش‌ها</h2>
          <div className="crumb">
            <span>تحلیل داده</span>
            <i>/</i>
            <span>فروش، سود، مطالبات و چک‌ها</span>
          </div>
        </div>
        <div className="page-h-tools">
          <span className="badge b-line">{formatPersianNumber(totalReports)} رکورد</span>
          <button className="btn btn-sm btn-o" onClick={exportSales} title="خروجی فروش">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            CSV فروش
          </button>
        </div>
      </div>

      {/* ── Tabs: same as invoices (seg-tabs with b + small) ── */}
      <nav className="settings-tabs seg-tabs reports-tabs" aria-label="بخش‌های گزارش">
        <button
          type="button"
          className={activeTab === 'sales' ? 'active' : ''}
          onClick={() => setActiveTab('sales')}
          aria-current={activeTab === 'sales' ? 'true' : undefined}
        >
          <b>فروش و سود</b>
          <small>فاکتورها، درآمد، سود برندها و پرفروش‌ترین‌ها</small>
        </button>
        <button
          type="button"
          className={activeTab === 'checks' ? 'active' : ''}
          onClick={() => setActiveTab('checks')}
          aria-current={activeTab === 'checks' ? 'true' : undefined}
        >
          <b>چک‌ها</b>
          <small>چک مشتریان و چک تأمین‌کنندگان</small>
        </button>
        <button
          type="button"
          className={activeTab === 'returns' ? 'active' : ''}
          onClick={() => setActiveTab('returns')}
          aria-current={activeTab === 'returns' ? 'true' : undefined}
        >
          <b>مرجوعی</b>
          <small>کالاهای برگشتی و مشتریان پرمرجوعی</small>
        </button>
        <button
          type="button"
          className={activeTab === 'debts' ? 'active' : ''}
          onClick={() => setActiveTab('debts')}
          aria-current={activeTab === 'debts' ? 'true' : undefined}
        >
          <b>بدهی‌ها</b>
          <small>بدهکاران برتر و بدهی تأمین‌کنندگان</small>
        </button>
        <button
          type="button"
          className={activeTab === 'charts' ? 'active' : ''}
          onClick={() => setActiveTab('charts')}
          aria-current={activeTab === 'charts' ? 'true' : undefined}
        >
          <b>نمودارها و فعالیت</b>
          <small>روند فروش، سهم سود و آخرین Auditها</small>
        </button>
      </nav>

      {/* ── Filter toolbar: identical to invoices list (date-range pill + status pill) ── */}
      <div className="list-toolbar invoices-toolbar reports-toolbar">
        <div className="invoice-filter-row">
          <div
            className={`date-range-filters${from || to ? ' is-active' : ''}`}
            aria-label="فیلتر بازهٔ تاریخ شمسی"
          >
            <span className="drf-lead" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            </span>
            <label className="drf-field">
              <span className="drf-label">از تاریخ</span>
              <JalaliDateInput value={from} onChange={setFrom} aria-label="از تاریخ (شمسی)" placeholder="۱۴۰۵/۰۱/۰۱" />
              {from && <button type="button" className="drf-x" aria-label="پاک کردن از تاریخ" onClick={() => setFrom('')}>×</button>}
            </label>
            <span className="drf-sep" aria-hidden="true" />
            <label className="drf-field">
              <span className="drf-label">تا تاریخ</span>
              <JalaliDateInput value={to} onChange={setTo} aria-label="تا تاریخ (شمسی)" placeholder="۱۴۰۵/۰۱/۰۱" />
              {to && <button type="button" className="drf-x" aria-label="پاک کردن تا تاریخ" onClick={() => setTo('')}>×</button>}
            </label>
          </div>

          {activeTab === 'checks' && (
            <div className={`status-filter${checkStatus ? ' is-active' : ''}`} aria-label="فیلتر وضعیت چک">
              <span className="stf-lead" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>
              </span>
              <div className="stf-options" role="tablist" aria-label="وضعیت چک">
                {[
                  { id: '', label: 'همه' },
                  { id: 'pending', label: 'در انتظار' },
                  { id: 'cleared', label: 'وصول‌شده' },
                  { id: 'bounced', label: 'برگشتی' },
                  { id: 'cancelled', label: 'لغوشده' },
                ].map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    aria-selected={checkStatus === entry.id}
                    className={checkStatus === entry.id ? 'active' : ''}
                    onClick={() => setCheckStatus(entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button className="btn btn-sm btn-p" onClick={() => void load()} disabled={loading}>
            {loading ? 'در حال بارگذاری...' : 'اعمال بازه'}
          </button>
          {(from || to || checkStatus) && (
            <button
              type="button"
              className="pill"
              onClick={() => {
                setFrom('');
                setTo('');
                setCheckStatus('');
              }}
            >
              × پاک کردن فیلترها
            </button>
          )}
        </div>

        {/* Export toolbar: same pill language as invoices */}
        <div className="report-export-row">
          <span className="muted">خروجی‌ها:</span>
          <button className="row-action" onClick={exportSales}>CSV فروش</button>
          <button className="row-action" onClick={() => void downloadFile('/reports/returns/export', 'salimvand-returns.csv').catch((e: Error) => setError(e.message))}>مرجوعی</button>
          <button className="row-action" onClick={() => void downloadFile('/reports/checks/export', 'salimvand-checks.csv').catch((e: Error) => setError(e.message))}>چک‌ها</button>
          <button className="row-action" onClick={() => void downloadFile('/reports/supplier-checks/export', 'salimvand-supplier-checks.csv').catch((e: Error) => setError(e.message))}>چک تأمین</button>
          <button className="row-action" onClick={() => void downloadFile('/reports/purchase-debts/export', 'salimvand-supplier-debts.csv').catch((e: Error) => setError(e.message))}>بدهی تأمین</button>
          <button className="row-action" onClick={printReturns}>چاپ مرجوعی</button>
        </div>
      </div>

      {error && <div className="notice">{error}</div>}

      {/* ── Tab: فروش و سود ── */}
      {activeTab === 'sales' && (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="hd"><span className="ic">📄</span><small>تعداد فاکتور</small></div>
              <div className="v">{sales ? formatPersianNumber(sales.summary.invoiceCount) : '—'}</div>
              <div className="f"><span className="fl">در بازهٔ انتخابی</span></div>
            </div>
            <div className="kpi">
              <div className="hd"><span className="ic">💰</span><small>فروش</small></div>
              <div className="v">{sales ? money(sales.summary.revenue) : '—'}</div>
              <div className="f"><span className="up">ناخالص</span></div>
            </div>
            <div className="kpi">
              <div className="hd"><span className="ic">✅</span><small>دریافت‌شده</small></div>
              <div className="v">{sales ? money(sales.summary.paid) : '—'}</div>
              <div className="f"><span className="up">وصول شده</span></div>
            </div>
            <div className="kpi alert">
              <div className="hd"><span className="ic">⚠️</span><small>مطالبات</small></div>
              <div className="v">{sales ? money(sales.summary.outstanding) : '—'}</div>
              <div className="f"><span className="dn">بدهی مشتریان</span></div>
            </div>
          </div>

          <div className="kpis" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="kpi">
              <div className="hd"><span className="ic">📈</span><small>فروش ناخالص</small></div>
              <div className="v">{profit ? money(profit.summary.revenue) : '—'}</div>
            </div>
            <div className="kpi">
              <div className="hd"><span className="ic">📦</span><small>هزینهٔ خرید</small></div>
              <div className="v">{profit ? money(profit.summary.cost) : '—'}</div>
            </div>
            <div className="kpi">
              <div className="hd"><span className="ic">💎</span><small>سود ناخالص</small></div>
              <div className="v" style={{ color: profit && Number(profit.summary.profit) >= 0 ? 'var(--sv-ok)' : 'var(--sv-danger)' }}>
                {profit ? money(profit.summary.profit) : '—'}
              </div>
            </div>
          </div>

          <div className="cols-2">
            <div className="card">
              <div className="card-h">
                <h3>محصولات پرفروش</h3>
                <span className="badge b-line">{formatPersianNumber(sales?.products.length ?? 0)} قلم</span>
              </div>
              <div className="card-b" style={{ paddingTop: 6, paddingBottom: 6 }}>
                {sales?.products.slice(0, 10).map((row) => (
                  <div className="list-row" key={row.name}>
                    <span className="thumb">{row.name.slice(0, 2)}</span>
                    <div className="grow">
                      <b>{row.name}</b>
                      <small>{formatPersianNumber(row.quantity)} عدد · {money(row.revenue)}</small>
                    </div>
                  </div>
                ))}
                {sales?.products.length === 0 && <p className="muted empty-line">داده‌ای در این بازه وجود ندارد.</p>}
              </div>
            </div>

            <div className="card">
              <div className="card-h">
                <h3>سود تفکیک‌شده بر اساس برند</h3>
                <span className="badge b-brand">Top 10</span>
              </div>
              <div className="card-b">
                <div className="dash-tbl">
                  <div className="thead">
                    <span>برند</span>
                    <span>تعداد</span>
                    <span>فروش</span>
                    <span>سود</span>
                  </div>
                  {profit?.brands
                    .sort((a, b) => Number(b.profit) - Number(a.profit))
                    .slice(0, 10)
                    .map((row) => (
                      <div className="trow" key={row.brand}>
                        <b>{row.brand}</b>
                        <span>{formatPersianNumber(row.quantity)}</span>
                        <span>{money(row.revenue)}</span>
                        <b className={Number(row.profit) >= 0 ? 'num ok' : 'num danger'}>{money(row.profit)}</b>
                      </div>
                    ))}
                </div>
                {profit && profit.brands.length === 0 && <p className="muted empty-line">داده‌ای وجود ندارد.</p>}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Tab: چک‌ها ── */}
      {activeTab === 'checks' && (
        <div className="cols-2b">
          <section className="card">
            <div className="card-h">
              <h3>چک‌های مشتریان</h3>
              <span className="badge b-warn">{formatPersianNumber(checks.length)} مورد</span>
            </div>
            <div className="card-b">
              <div className="dash-tbl report-check-tbl">
                <div className="thead"><span>فاکتور</span><span>مشتری</span><span>بانک/شماره</span><span>سررسید</span><span>مبلغ</span><span>وضعیت</span></div>
                {checks.map((check) => (
                  <div className="trow" key={check.id}>
                    <code>{check.invoice.number}</code>
                    <span>{check.invoice.customerName ?? 'حضوری'}</span>
                    <span>{check.bank ?? '—'} · {check.checkNumber ?? '—'}</span>
                    <span>{new Intl.DateTimeFormat('fa-IR').format(new Date(check.dueDate))}</span>
                    <b>{money(check.amount)}</b>
                    <span className={`badge ${check.status === 'cleared' ? 'b-ok' : check.status === 'bounced' ? 'b-danger' : 'b-line'}`}>{({ pending: 'در انتظار', cleared: 'وصول‌شده', bounced: 'برگشتی', cancelled: 'لغوشده' } as Record<string, string>)[check.status] ?? check.status}</span>
                  </div>
                ))}
              </div>
              {!checks.length && <p className="muted empty-line">چکی با این فیلتر پیدا نشد.</p>}
            </div>
          </section>

          <section className="card">
            <div className="card-h">
              <h3>چک‌های تأمین‌کنندگان</h3>
              <span className="badge b-line">{formatPersianNumber(supplierChecks.length)} مورد</span>
            </div>
            <div className="card-b">
              <div className="dash-tbl report-check-tbl">
                <div className="thead"><span>فاکتور خرید</span><span>تأمین‌کننده</span><span>بانک/شماره</span><span>سررسید</span><span>مبلغ</span><span>وضعیت</span></div>
                {supplierChecks.map((check) => (
                  <div className="trow" key={check.id}>
                    <code>{check.invoice.number}</code>
                    <span>{check.invoice.supplierName}</span>
                    <span>{check.bank ?? '—'} · {check.checkNumber ?? '—'}</span>
                    <span>{new Intl.DateTimeFormat('fa-IR').format(new Date(check.dueDate))}</span>
                    <b>{money(check.amount)}</b>
                    <span className="badge b-line">{({ pending: 'در انتظار', cleared: 'وصول‌شده', bounced: 'برگشتی', cancelled: 'لغوشده' } as Record<string, string>)[check.status] ?? check.status}</span>
                  </div>
                ))}
              </div>
              {!supplierChecks.length && <p className="muted empty-line">چک تأمین‌کننده‌ای ثبت نشده است.</p>}
            </div>
          </section>
        </div>
      )}

      {/* ── Tab: مرجوعی ── */}
      {activeTab === 'returns' && (
        <section className="card">
          <div className="card-h">
            <h3>گزارش مرجوعی کالا</h3>
            <span className="badge b-warn">{formatPersianNumber(returns?.rows.length ?? 0)} مورد</span>
          </div>
          <div className="card-b">
            <div className="dash-tbl report-check-tbl">
              <div className="thead"><span>فاکتور</span><span>مشتری</span><span>محصول</span><span>تعداد</span><span>مبلغ برگشت</span><span>نوع</span></div>
              {returns?.rows.slice(0, 100).map((row) => (
                <div className="trow" key={row.id}>
                  <code>{row.invoice.number}</code>
                  <span>{row.invoice.customerName ?? 'حضوری'}</span>
                  <span>{row.product}</span>
                  <span>{formatPersianNumber(row.quantity)}</span>
                  <b>{money(row.refundAmount)}</b>
                  <span className={`badge ${row.restock ? 'b-ok' : 'b-danger'}`}>{row.restock ? 'بازگشت به انبار' : 'ضایعات'}</span>
                </div>
              ))}
            </div>
            {!returns?.rows.length && <p className="muted empty-line">مرجوعی‌ای در این بازه ثبت نشده است.</p>}
            <div className="card-h" style={{ marginTop: 18 }}>
              <h3>مشتریانی با بیشترین مرجوعی</h3>
            </div>
            <div className="list-rows">
              {(returns?.customers ?? []).slice(0, 5).map((customer) => (
                <div className="list-row" key={customer.name}>
                  <span className="thumb">{customer.name.slice(0, 2)}</span>
                  <div className="grow">
                    <b>{customer.name}</b>
                    <small>{formatPersianNumber(customer.count)} قلم · {money(customer.amount)}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Tab: بدهی‌ها ── */}
      {activeTab === 'debts' && (
        <div className="cols-2b">
          <section className="card">
            <div className="card-h">
              <h3>بدهکاران برتر</h3>
              <span className="badge b-danger">{formatPersianNumber(customers?.debtors.length ?? 0)} مشتری</span>
            </div>
            <div className="card-b" style={{ paddingTop: 6, paddingBottom: 6 }}>
              {customers?.debtors.slice(0, 10).map((row) => (
                <div className="list-row" key={row.id}>
                  <span className="thumb">{row.name.slice(0, 2)}</span>
                  <div className="grow">
                    <b>{row.name}</b>
                    <small>{formatPersianNumber(row.mobile)} · {formatPersianNumber(row.invoiceCount)} فاکتور</small>
                  </div>
                  <div className="val"><span className="badge b-danger">{money(row.debt)}</span></div>
                </div>
              ))}
              {customers && customers.debtors.length === 0 && <p className="muted empty-line">مشتری بدهکاری وجود ندارد.</p>}
            </div>
          </section>

          <section className="card">
            <div className="card-h">
              <h3>بدهی تأمین‌کنندگان</h3>
              <span className="badge b-warn">{suppliers ? money(suppliers.totalDebt) : '—'}</span>
            </div>
            <div className="card-b" style={{ paddingTop: 6, paddingBottom: 6 }}>
              <div className="list-row" style={{ background: 'var(--sv-surface-2)', borderRadius: 10, marginBottom: 8 }}>
                <span className="thumb">Σ</span>
                <div className="grow"><b>مجموع بدهی</b><small>به تأمین‌کنندگان</small></div>
                <div className="val"><span className="badge b-danger">{suppliers ? money(suppliers.totalDebt) : '—'}</span></div>
              </div>
              {suppliers?.suppliers.filter((row) => Number(row.debt) > 0).slice(0, 10).map((row) => (
                <div className="list-row" key={row.supplierId}>
                  <span className="thumb">{row.supplierName.slice(0, 2)}</span>
                  <div className="grow">
                    <b>{row.supplierName}</b>
                    <small>{formatPersianNumber(row.invoiceCount)} فاکتور خرید</small>
                  </div>
                  <div className="val"><span className="badge b-warn">{money(row.debt)}</span></div>
                </div>
              ))}
              {suppliers && suppliers.suppliers.every((row) => Number(row.debt) <= 0) && <p className="muted empty-line">بدهی تأمین‌کننده‌ای وجود ندارد.</p>}
            </div>
          </section>
        </div>
      )}

      {/* ── Tab: نمودارها و فعالیت ── */}
      {activeTab === 'charts' && (
        <>
          <div className="cols-2">
            <div className="card">
              <div className="card-h">
                <h3>روند ماهانهٔ فروش</h3>
                <span className="badge b-line">شمسی</span>
              </div>
              <div className="card-b">
                <Suspense fallback={<div className="dashboard-chart-loading">در حال آماده‌سازی نمودار…</div>}>
                  <SalesChart
                    data={monthlySales(sales?.invoices ?? []).map((bucket) => ({
                      ...bucket,
                      revenue: String(bucket.revenue),
                      paid: String(bucket.paid),
                    }))}
                  />
                </Suspense>
              </div>
            </div>
            <div className="card">
              <div className="card-h">
                <h3>سهم برندها از سود</h3>
                <span className="badge b-line">دونات</span>
              </div>
              <div className="card-b">
                <DonutChart data={profitShare(profit?.brands ?? [])} />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <h3>آخرین Auditها</h3>
              <span className="badge b-line">۲۰ مورد اخیر</span>
            </div>
            <div className="card-b">
              <div className="dash-tbl">
                <div className="thead"><span>بخش</span><span>عملیات</span><span>کاربر</span><span>زمان</span></div>
                {audit.map((row) => (
                  <div className="trow" key={String(row.id)}>
                    <span>{row.entityType}</span>
                    <span className="badge b-line">{row.action}</span>
                    <span>{row.user?.name ?? 'سیستم'}</span>
                    <time>{new Date(row.createdAt).toLocaleString('fa-IR')}</time>
                  </div>
                ))}
              </div>
              {!audit.length && <p className="muted empty-line">رویدادی ثبت نشده است.</p>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
