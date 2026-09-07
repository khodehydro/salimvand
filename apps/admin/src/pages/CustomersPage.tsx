import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { paramsFromHash } from '../lib/admin-route';
import { formatRial, formatPersianNumber } from '@salimvand/shared';
import { FaNumberInput } from '../components/FaNumberInput';

type CustomerVehicle = {
  id: string;
  plate?: string | null;
  chassis?: string | null;
  year?: number | null;
  notes?: string | null;
  trim?: {
    id: string;
    name: string;
    model: { id: string; name: string; make: { id: string; name: string } };
  } | null;
};
type VehicleMake = {
  id: string;
  name: string;
  models: Array<{ id: string; name: string; trims: Array<{ id: string; name: string }> }>;
};
type Customer = {
  id: string;
  name: string;
  mobile: string;
  address?: string | null;
  notes?: string | null;
  debt: string | number;
  totalPurchase?: string | number;
  lastPurchase?: string | null;
  invoiceCount: number;
  smsLogs?: Array<{ id: string | number; message: string; status: string; createdAt: string }>;
  invoices?: Array<{
    id: string;
    number: string;
    total: string | number;
    paidAmount: string | number;
    paymentStatus: string;
    issuedAt: string;
    items?: Array<{ productName: string; quantity: number }>;
    payments?: Array<{ amount: string | number; method: string; checks?: Array<{ checkNumber?: string | null; bank?: string | null; amount: string | number; dueDate: string; status?: string }> }>;
  }>;
  payments?: Array<{ amount: string | number; method: string; paidAt: string; notes?: string | null }>;
};
const paymentLabels: Record<string, string> = {
  paid: 'تسویه شده',
  partial: 'پرداخت بخشی',
  unpaid: 'پرداخت نشده',
};
const shamsi = (value: string) =>
  new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(new Date(value));

export function CustomersPage({
  canManage = true,
  canPay = true,
}: {
  canManage?: boolean;
  canPay?: boolean;
}) {
  const [rows, setRows] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'list' | 'new'>('list');
  const [form, setForm] = useState({ name: '', mobile: '', address: '', notes: '' });
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; mobile?: string }>({});
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [paymentFor, setPaymentFor] = useState<Customer | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [vehicles, setVehicles] = useState<CustomerVehicle[]>([]);
  const [vehicleTree, setVehicleTree] = useState<VehicleMake[]>([]);
  const [vehicleForm, setVehicleForm] = useState({
    trimId: '',
    plate: '',
    chassis: '',
    year: '',
    notes: '',
  });
  /** Inline edit of an existing customer's profile. */
  const [editing, setEditing] = useState<Customer | null>(null);
  const [editForm, setEditForm] = useState({ name: '', mobile: '', address: '', notes: '' });

  const loadDetail = async (id: string) => {
    try {
      const [result, vehicleResult, treeResult] = await Promise.all([
        api<{ data: Customer }>(`/customers/${id}`),
        api<{ data: CustomerVehicle[] }>(`/customers/${id}/vehicles`),
        api<{ data: VehicleMake[] }>('/vehicles/tree'),
      ]);
      setSelected(result.data);
      setVehicles(vehicleResult.data);
      setVehicleTree(treeResult.data);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const load = () =>
    void api<{ data: Customer[] }>('/customers')
      .then((result) => setRows(result.data))
      .catch((error: Error) => setMessage(error.message));
  useEffect(load, []);
  // Deep link from the global palette (#/customers?customer=<id>) opens the profile.
  useEffect(() => {
    const openFromHash = () => {
      const customerId = paramsFromHash(window.location.hash).customer;
      if (customerId) void loadDetail(customerId);
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Instant, client-side: the list already carries name + mobile. */
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return rows;
    return rows.filter(
      (customer) =>
        customer.name.toLocaleLowerCase().includes(query) ||
        customer.mobile.includes(query.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))),
    );
  }, [rows, search]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const errors: { name?: string; mobile?: string } = {};
    if (!form.name.trim()) errors.name = 'نام مشتری الزامی است';
    if (!/^09\d{9}$/.test(form.mobile)) errors.mobile = 'شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود';
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setLoading(true);
    try {
      await api('/customers', { method: 'POST', body: JSON.stringify(form) });
      setMessage('مشتری ثبت شد');
      setForm({ name: '', mobile: '', address: '', notes: '' });
      setTab('list');
      load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const openEdit = (customer: Customer) => {
    setEditing(customer);
    setEditForm({
      name: customer.name,
      mobile: customer.mobile,
      address: customer.address ?? '',
      notes: customer.notes ?? '',
    });
  };
  const saveEdit = async () => {
    if (!editing) return;
    if (!editForm.name.trim()) return setMessage('نام مشتری الزامی است');
    if (!/^09\d{9}$/.test(editForm.mobile))
      return setMessage('شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود');
    setLoading(true);
    try {
      await api(`/customers/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editForm.name,
          mobile: editForm.mobile,
          address: editForm.address,
          notes: editForm.notes,
        }),
      });
      setMessage('اطلاعات مشتری به‌روزرسانی شد');
      setEditing(null);
      load();
      if (selected?.id === editing.id) await loadDetail(editing.id);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const registerPayment = async () => {
    if (
      !paymentFor ||
      !paymentAmount ||
      !Number.isInteger(Number(paymentAmount)) ||
      Number(paymentAmount) <= 0 ||
      Number(paymentAmount) > Number(paymentFor.debt)
    )
      return setMessage('مبلغ پرداخت معتبر و کمتر از بدهی الزامی است');
    setLoading(true);
    try {
      const result = await api<{ data: { remainingDebt?: string | number } }>(
        `/customers/${paymentFor.id}/payments`,
        { method: 'POST', body: JSON.stringify({ amount: paymentAmount, method: paymentMethod }) },
      );
      setMessage(
        `پرداخت ثبت شد · ماندهٔ جدید: ${formatRial(Number(result.data.remainingDebt ?? 0))}`,
      );
      setPaymentFor(null);
      setPaymentAmount('');
      load();
      if (selected?.id === paymentFor.id) await loadDetail(paymentFor.id);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const addVehicle = async () => {
    if (!selected) return;
    if (!vehicleForm.trimId && !vehicleForm.plate.trim())
      return setMessage('حداقل نوع خودرو یا پلاک را وارد کنید');
    setLoading(true);
    try {
      await api(`/customers/${selected.id}/vehicles`, {
        method: 'POST',
        body: JSON.stringify({
          ...vehicleForm,
          year: vehicleForm.year ? Number(vehicleForm.year) : undefined,
        }),
      });
      setMessage('خودرو به پروفایل مشتری اضافه شد');
      setVehicleForm({ trimId: '', plate: '', chassis: '', year: '', notes: '' });
      await loadDetail(selected.id);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const removeVehicle = async (vehicleId: string) => {
    if (!selected || !window.confirm('این خودرو از پروفایل مشتری حذف شود؟')) return;
    try {
      await api(`/customers/${selected.id}/vehicles/${vehicleId}`, { method: 'DELETE' });
      setMessage('خودرو حذف شد');
      await loadDetail(selected.id);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  return (
    <section>
      <div className="page-title">
        <div>
          <span className="eyebrow">فروش</span>
          <h1>مشتریان</h1>
          <p className="muted">پروندهٔ مشتری‌ها، فاکتورها، خودروها و تسویه بدهی</p>
        </div>
        <span className="count">{formatPersianNumber(rows.length)} مشتری</span>
      </div>

      <nav className="settings-tabs" aria-label="بخش‌های مشتریان">
        <button
          type="button"
          className={tab === 'list' ? 'active' : ''}
          onClick={() => setTab('list')}
          aria-current={tab === 'list' ? 'true' : undefined}
        >
          <b>لیست مشتریان</b>
          <small>جست‌وجوی لحظه‌ای، پرونده، فاکتورها و ثبت پرداخت</small>
        </button>
        {canManage && (
          <button
            type="button"
            className={tab === 'new' ? 'active' : ''}
            onClick={() => setTab('new')}
            aria-current={tab === 'new' ? 'true' : undefined}
          >
            <b>ثبت مشتری جدید</b>
            <small>نام، موبایل، آدرس و یادداشت</small>
          </button>
        )}
      </nav>

      {message && <div className="notice">{message}</div>}

      {tab === 'new' && canManage && (
        <form className="product-form customer-form" onSubmit={submit}>
          <h2>مشتری جدید</h2>
          <label>
            نام و نام خانوادگی
            <input
              required
              value={form.name}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value });
                setFieldErrors((current) => ({ ...current, name: undefined }));
              }}
            />
          </label>
          {fieldErrors.name && <small className="field-error">{fieldErrors.name}</small>}
          <label>
            موبایل
            <input
              required
              dir="ltr"
              pattern="09[0-9]{9}"
              value={form.mobile}
              onChange={(e) => {
                setForm({ ...form, mobile: e.target.value });
                setFieldErrors((current) => ({ ...current, mobile: undefined }));
              }}
            />
          </label>
          {fieldErrors.mobile && <small className="field-error">{fieldErrors.mobile}</small>}
          <label>
            آدرس
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="آدرس مشتری — هنگام صدور فاکتور پیش‌فرض می‌شود"
            />
          </label>
          <label>
            یادداشت
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <button className="button-primary" disabled={loading}>
            {loading ? 'در حال ثبت...' : 'ثبت مشتری'}
          </button>
        </form>
      )}

      {tab === 'list' && (
        <>
          <div className="list-toolbar">
            <div className="search-field">
              <span className="search-icon">⌕</span>
              <input
                placeholder="جست‌وجوی لحظه‌ای نام یا موبایل مشتری…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => setSearch('')}
                  aria-label="پاک کردن جست‌وجو"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          <div className="product-table">
            <div className="table-head customer-head">
              <span>مشتری</span>
              <span>موبایل</span>
              <span>مجموع خرید</span>
              <span>آخرین خرید</span>
              <span>فاکتورها</span>
              <span>بدهی</span>
              <span>وضعیت</span>
            </div>
            {filtered.map((customer) => (
              <div className="table-row customer-row" key={customer.id}>
                <button className="row-action" onClick={() => void loadDetail(customer.id)}>
                  {customer.name}
                </button>
                <code dir="ltr">{formatPersianNumber(customer.mobile)}</code>
                <span>{formatRial(Number(customer.totalPurchase ?? 0))}</span>
                <span>{customer.lastPurchase ? shamsi(customer.lastPurchase) : '—'}</span>
                <span>{formatPersianNumber(customer.invoiceCount)}</span>
                <b className={Number(customer.debt) > 0 ? 'low-stock' : 'status-chip'}>
                  {formatRial(Number(customer.debt))}
                </b>
                <span className="customer-actions">
                  {canPay && Number(customer.debt) > 0 && (
                    <button className="row-action" onClick={() => setPaymentFor(customer)}>
                      ثبت پرداخت
                    </button>
                  )}
                  {canManage && (
                    <button className="row-action" onClick={() => openEdit(customer)}>
                      ویرایش
                    </button>
                  )}
                </span>
              </div>
            ))}
            {!filtered.length && <p className="muted empty-line">مشتری‌ای پیدا نشد.</p>}
          </div>
        </>
      )}

      {paymentFor && (
        <div className="modal-mask" role="dialog" aria-modal="true" aria-label="ثبت پرداخت مشتری">
          <div className="modal-mask-panel pay-modal">
            <header className="pay-modal-h">
              <b>ثبت پرداخت بدهی · {paymentFor.name}</b>
              <button type="button" className="close" onClick={() => setPaymentFor(null)}>
                ✕
              </button>
            </header>
            <div className="pay-modal-body">
              <div className="ln grand">
                <span>بدهی فعلی</span>
                <b>{formatRial(Number(paymentFor.debt))}</b>
              </div>
              <label className="field">
                <span className="lab">مبلغ پرداختی (ریال)</span>
                <FaNumberInput
                  className="money-in"
                  value={paymentAmount}
                  onChange={(plain) => setPaymentAmount(plain)}
                  placeholder="۰"
                />
              </label>
              <label className="field">
                <span className="lab">روش پرداخت</span>
                <select
                  className="money-in"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                >
                  <option value="cash">نقدی</option>
                  <option value="card">کارت‌خوان</option>
                  <option value="transfer">واریز بانکی</option>
                  <option value="credit">نسیه / چک</option>
                </select>
              </label>
            </div>
            <footer className="pay-modal-f">
              <button
                className="button-primary"
                disabled={loading}
                onClick={() => void registerPayment()}
              >
                {loading ? 'در حال ثبت...' : 'ثبت پرداخت'}
              </button>
              <button className="outline" onClick={() => setPaymentFor(null)}>
                انصراف
              </button>
            </footer>
          </div>
        </div>
      )}

      {editing && (
        <div className="modal-mask" role="dialog" aria-modal="true" aria-label="ویرایش مشتری">
          <div className="modal-mask-panel pay-modal">
            <header className="pay-modal-h">
              <b>ویرایش اطلاعات · {editing.name}</b>
              <button type="button" className="close" onClick={() => setEditing(null)}>
                ✕
              </button>
            </header>
            <div className="pay-modal-body">
              <label className="field">
                <span className="lab">نام و نام خانوادگی</span>
                <input
                  className="money-in"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="lab">موبایل</span>
                <input
                  className="money-in"
                  dir="ltr"
                  value={editForm.mobile}
                  onChange={(e) => setEditForm({ ...editForm, mobile: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="lab">آدرس</span>
                <input
                  className="money-in"
                  value={editForm.address}
                  onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="lab">یادداشت</span>
                <input
                  className="money-in"
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                />
              </label>
            </div>
            <footer className="pay-modal-f">
              <button className="button-primary" disabled={loading} onClick={() => void saveEdit()}>
                ذخیرهٔ تغییرات
              </button>
              <button className="outline" onClick={() => setEditing(null)}>
                انصراف
              </button>
            </footer>
          </div>
        </div>
      )}

      {selected && (
        <div
          className="modal-mask"
          role="dialog"
          aria-modal="true"
          aria-label={`پروندهٔ ${selected.name}`}
          onClick={() => setSelected(null)}
        >
          <div
            className="modal-mask-panel customer-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="pay-modal-h">
              <b>
                {selected.name} · پروندهٔ مشتری{' '}
                <code dir="ltr">{formatPersianNumber(selected.mobile)}</code>
              </b>
              <button type="button" className="close" onClick={() => setSelected(null)}>
                ✕
              </button>
            </header>
            <div className="pay-modal-body">
              <div className="ln grand">
                <span>مانده بدهی</span>
                <b>{formatRial(Number(selected.debt))}</b>
              </div>
              {selected.address && (
                <div className="ln">
                  <span>آدرس</span>
                  <b>{selected.address}</b>
                </div>
              )}
              {selected.notes && (
                <div className="ln">
                  <span>یادداشت</span>
                  <b>{selected.notes}</b>
                </div>
              )}
              {canManage && (
                <button className="row-action" onClick={() => openEdit(selected)}>
                  ✎ ویرایش اطلاعات مشتری
                </button>
              )}

              <h3 className="list-subhead">فاکتورهای مشتری</h3>
              {selected.invoices?.length ? (
                <div className="dash-tbl">
                  <div className="thead">
                    <span>شماره</span>
                    <span>تاریخ</span>
                    <span>مبلغ</span>
                    <span>وضعیت</span>
                  </div>
                  {selected.invoices.map((invoice) => (
                    <div className="trow" key={invoice.id}>
                      <a className="row-action" href={`#/invoices?invoice=${invoice.id}`}>
                        <code>{formatPersianNumber(invoice.number)}</code>
                      </a>
                      <span>{shamsi(invoice.issuedAt)}</span>
                      <b className="num">{formatRial(Number(invoice.total))}</b>
                      <span
                        className={invoice.paymentStatus === 'paid' ? 'status-chip' : 'low-stock'}
                      >
                        {paymentLabels[invoice.paymentStatus] ?? invoice.paymentStatus}
                        {' · '}
                        {formatRial(Number(invoice.paidAmount))}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted empty-line">فاکتوری ثبت نشده است.</p>
              )}

              <h3 className="list-subhead">چک‌های مشتری</h3>
              <div className="customer-products customer-check-list">
                {(selected.invoices ?? []).flatMap((invoice) => (invoice.payments ?? []).flatMap((payment) => (payment.checks ?? []).map((check) => ({ ...check, invoice: invoice.number })))).map((check) => <span key={`${check.invoice}-${check.checkNumber}-${check.dueDate}`}><b>فاکتور {check.invoice}</b> · {check.checkNumber || 'بدون شماره'} · {check.bank || 'بانک نامشخص'} · {formatRial(Number(check.amount))} · سررسید {shamsi(check.dueDate)} · {({ pending: 'در انتظار', cleared: 'وصول‌شده', bounced: 'برگشتی', cancelled: 'لغوشده' } as Record<string, string>)[check.status ?? 'pending'] ?? 'در انتظار'}</span>)}
                {!selected.invoices?.some((invoice) => invoice.payments?.some((payment) => payment.checks?.length)) && <p className="muted">چکی برای این مشتری ثبت نشده است.</p>}
              </div>

              <h3 className="list-subhead">تاریخچه پیامک‌ها</h3>
              <div className="customer-products">{selected.smsLogs?.length ? selected.smsLogs.map((sms) => <span key={String(sms.id)}>{shamsi(sms.createdAt)} · {sms.status} · {sms.message}</span>) : <p className="muted">پیامی ثبت نشده است.</p>}</div>

              <h3 className="list-subhead">کالاهای خریداری‌شده</h3>
              <div className="customer-products">
                {Object.entries((selected.invoices ?? []).flatMap((invoice) => invoice.items ?? []).reduce<Record<string, number>>((result, item) => { result[item.productName] = (result[item.productName] ?? 0) + item.quantity; return result; }, {})).map(([name, quantity]) => <span key={name}>{name} · {formatPersianNumber(quantity)} عدد</span>)}
                {!selected.invoices?.some((invoice) => invoice.items?.length) && <p className="muted">کالایی ثبت نشده است.</p>}
              </div>

              <h3 className="list-subhead">خودروهای مشتری</h3>
              <div className="customer-vehicles">
                {vehicles.map((vehicle) => (
                  <article key={vehicle.id}>
                    <span>
                      <strong>
                        {vehicle.trim
                          ? `${vehicle.trim.model.make.name} ${vehicle.trim.model.name} · ${vehicle.trim.name}`
                          : 'خودروی آزاد'}
                      </strong>
                      <small>
                        {vehicle.plate || 'بدون پلاک'}{' '}
                        {vehicle.year ? `· مدل ${formatPersianNumber(vehicle.year)}` : ''}
                      </small>
                    </span>
                    {canManage && (
                      <button
                        className="row-action danger-text"
                        onClick={() => void removeVehicle(vehicle.id)}
                      >
                        حذف
                      </button>
                    )}
                  </article>
                ))}
                {!vehicles.length && <p className="muted empty-line">خودرویی ثبت نشده است.</p>}
              </div>
              {canManage && (
                <div className="customer-vehicle-form">
                  <select
                    value={vehicleForm.trimId}
                    onChange={(event) =>
                      setVehicleForm({ ...vehicleForm, trimId: event.target.value })
                    }
                  >
                    <option value="">انتخاب خودرو و تیپ</option>
                    {vehicleTree.flatMap((make) =>
                      make.models.flatMap((model) =>
                        model.trims.map((trim) => (
                          <option key={trim.id} value={trim.id}>
                            {make.name} · {model.name} · {trim.name}
                          </option>
                        )),
                      ),
                    )}
                  </select>
                  <input
                    value={vehicleForm.plate}
                    onChange={(event) =>
                      setVehicleForm({ ...vehicleForm, plate: event.target.value })
                    }
                    placeholder="پلاک"
                  />
                  <input
                    dir="ltr"
                    value={vehicleForm.chassis}
                    onChange={(event) =>
                      setVehicleForm({ ...vehicleForm, chassis: event.target.value })
                    }
                    placeholder="شماره شاسی"
                  />
                  <FaNumberInput
                    group={false}
                    value={vehicleForm.year}
                    onChange={(plain) => setVehicleForm({ ...vehicleForm, year: plain })}
                    placeholder="سال مدل"
                  />
                  <button disabled={loading} onClick={() => void addVehicle()}>
                    افزودن خودرو
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
