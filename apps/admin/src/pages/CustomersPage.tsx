import { FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { paramsFromHash } from '../lib/admin-route';
import { formatRial, formatPersianNumber } from '@salimvand/shared';

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
  invoiceCount: number;
  invoices?: Array<{
    id: string;
    number: string;
    total: string | number;
    paidAmount: string | number;
    paymentStatus: string;
    issuedAt: string;
  }>;
};
export function CustomersPage({
  canManage = true,
  canPay = true,
}: {
  canManage?: boolean;
  canPay?: boolean;
}) {
  const [rows, setRows] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  // Two tabs mirror the invoices page: registering lives apart from the register.
  const [tab, setTab] = useState<'new' | 'list'>('list');
  const [form, setForm] = useState({ name: '', mobile: '', address: '', notes: '' });
  const [editFor, setEditFor] = useState<Customer | null>(null);
  const [editForm, setEditForm] = useState({ name: '', mobile: '', address: '', notes: '' });
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
  const load = (query = search) =>
    void api<{ data: Customer[] }>(
      `/customers${query.trim() ? `?search=${encodeURIComponent(query.trim())}` : ''}`,
    )
      .then((result) => setRows(result.data))
      .catch((error: Error) => setMessage(error.message));
  useEffect(() => {
    void load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The register is searchable the moment you type — no submit button.
  useEffect(() => {
    const handle = window.setTimeout(() => load(search), 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
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
      load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };
  /** Edit dialog save: PATCHes the customer profile and refreshes the list. */
  const updateCustomer = async () => {
    if (!editFor) return;
    const errors: { name?: string; mobile?: string } = {};
    if (!editForm.name.trim()) errors.name = 'نام مشتری الزامی است';
    if (!/^09\d{9}$/.test(editForm.mobile))
      errors.mobile = 'شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود';
    if (Object.keys(errors).length) return setFieldErrors(errors);
    setFieldErrors({});
    setLoading(true);
    try {
      await api(`/customers/${editFor.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editForm.name.trim(),
          mobile: editForm.mobile.trim(),
          address: editForm.address,
          notes: editForm.notes,
        }),
      });
      setMessage(`اطلاعات ${editFor.name} به‌روزرسانی شد`);
      setEditFor(null);
      await load();
      if (selected?.id === editFor.id) await loadDetail(editFor.id);
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
          <p className="muted">
            {tab === 'new' ? 'ثبت پروندهٔ مشتری جدید' : 'مشتری‌ها، فاکتورها و مانده بدهی'}
          </p>
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
          <small>جست‌وجوی لحظه‌ای، پرداخت بدهی و پروندهٔ مشتری</small>
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
          <h2>ثبت مشتری جدید</h2>
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
          <button disabled={loading}>{loading ? 'در حال ثبت...' : 'ثبت مشتری'}</button>
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
              <span>فاکتورها</span>
              <span>بدهی</span>
              <span>وضعیت</span>
              <span>عملیات</span>
            </div>
            {rows.map((customer) => (
              <div className="table-row customer-row" key={customer.id}>
                <button className="row-action" onClick={() => void loadDetail(customer.id)}>
                  {customer.name}
                </button>
                <code>{customer.mobile}</code>
                <span>{formatPersianNumber(customer.invoiceCount)}</span>
                <b className={Number(customer.debt) > 0 ? 'low-stock' : 'status-chip'}>
                  {formatRial(Number(customer.debt))}
                </b>
                <span>{Number(customer.debt) > 0 ? 'بدهکار' : 'تسویه'}</span>
                <span className="customer-actions">
                  {canManage && (
                    <button
                      className="row-action"
                      onClick={() => {
                        setEditFor(customer);
                        setEditForm({
                          name: customer.name,
                          mobile: customer.mobile,
                          address: customer.address ?? '',
                          notes: customer.notes ?? '',
                        });
                      }}
                    >
                      ویرایش
                    </button>
                  )}
                  {canPay && Number(customer.debt) > 0 && (
                    <button className="row-action" onClick={() => setPaymentFor(customer)}>
                      ثبت پرداخت
                    </button>
                  )}
                </span>
              </div>
            ))}
            {!rows.length && (
              <div className="table-row customer-row">
                <span className="muted">مشتری‌ای پیدا نشد.</span>
              </div>
            )}
          </div>
        </>
      )}

      {editFor && (
        <div className="modal-backdrop" onClick={() => setEditFor(null)}>
          <div
            className="editor customer-edit"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="ویرایش مشتری"
          >
            <div className="editor-head">
              <h2>ویرایش مشتری</h2>
              <button className="close" onClick={() => setEditFor(null)}>
                بستن
              </button>
            </div>
            <label>
              نام و نام خانوادگی
              <input
                value={editForm.name}
                onChange={(e) => {
                  setEditForm({ ...editForm, name: e.target.value });
                  setFieldErrors((current) => ({ ...current, name: undefined }));
                }}
              />
            </label>
            {fieldErrors.name && <small className="field-error">{fieldErrors.name}</small>}
            <label>
              موبایل
              <input
                dir="ltr"
                value={editForm.mobile}
                onChange={(e) => {
                  setEditForm({ ...editForm, mobile: e.target.value });
                  setFieldErrors((current) => ({ ...current, mobile: undefined }));
                }}
              />
            </label>
            {fieldErrors.mobile && <small className="field-error">{fieldErrors.mobile}</small>}
            <label>
              آدرس
              <input
                value={editForm.address}
                onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                placeholder="آدرس مشتری"
              />
            </label>
            <label>
              یادداشت
              <input
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                placeholder="یادداشت پرونده"
              />
            </label>
            <div className="editor-footer">
              <button
                className="button-primary"
                disabled={loading}
                onClick={() => void updateCustomer()}
              >
                {loading ? 'در حال ذخیره...' : 'ذخیرهٔ تغییرات'}
              </button>
              <button className="outline" onClick={() => setEditFor(null)}>
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}
      {paymentFor && (
        <div className="editor customer-payment">
          <div className="editor-head">
            <h2>ثبت پرداخت بدهی · {paymentFor.name}</h2>
            <button className="close" onClick={() => setPaymentFor(null)}>
              بستن
            </button>
          </div>
          <p>بدهی فعلی: {formatRial(Number(paymentFor.debt))}</p>
          <input
            type="number"
            min="1"
            max={Number(paymentFor.debt)}
            value={paymentAmount}
            onChange={(e) => setPaymentAmount(e.target.value)}
            placeholder="مبلغ پرداختی به ریال"
          />
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
            <option value="cash">نقدی</option>
            <option value="card">کارت</option>
            <option value="transfer">واریز</option>
            <option value="credit">اعتباری</option>
          </select>
          <button
            disabled={loading}
            className="button-primary"
            onClick={() => void registerPayment()}
          >
            {loading ? 'در حال ثبت...' : 'ثبت پرداخت'}
          </button>
        </div>
      )}
      {selected && (
        <div className="editor customer-detail">
          <div className="editor-head">
            <h2>{selected.name} · جزئیات حساب</h2>
            <button className="close" onClick={() => setSelected(null)}>
              بستن
            </button>
          </div>
          <p>
            موبایل: <code>{selected.mobile}</code>
          </p>
          <p>
            مانده بدهی: <strong>{formatRial(Number(selected.debt))}</strong>
          </p>
          {selected.address && (
            <p>
              آدرس: <span className="muted">{selected.address}</span>
            </p>
          )}
          {selected.notes && (
            <p>
              یادداشت: <span className="muted">{selected.notes}</span>
            </p>
          )}
          <h3>خودروهای مشتری</h3>
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
          </div>
          {canManage && (
            <div className="customer-vehicle-form">
              <select
                value={vehicleForm.trimId}
                onChange={(event) => setVehicleForm({ ...vehicleForm, trimId: event.target.value })}
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
                onChange={(event) => setVehicleForm({ ...vehicleForm, plate: event.target.value })}
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
              <input
                type="number"
                value={vehicleForm.year}
                onChange={(event) => setVehicleForm({ ...vehicleForm, year: event.target.value })}
                placeholder="سال مدل"
              />
              <button disabled={loading} onClick={() => void addVehicle()}>
                افزودن خودرو
              </button>
            </div>
          )}
          <h3>فاکتورها</h3>
          {selected.invoices?.length ? (
            selected.invoices.map((invoice) => (
              <div className="table-row customer-row" key={invoice.id}>
                <code>{invoice.number}</code>
                <span>{formatRial(Number(invoice.total))}</span>
                <span>پرداخت: {formatRial(Number(invoice.paidAmount))}</span>
                <b>{invoice.paymentStatus}</b>
              </div>
            ))
          ) : (
            <p className="muted">فاکتوری ثبت نشده است.</p>
          )}
        </div>
      )}
    </section>
  );
}
