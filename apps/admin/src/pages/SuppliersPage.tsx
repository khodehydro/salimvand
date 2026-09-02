import { FormEvent, useEffect, useState } from 'react';
import { formatJalaliDate, formatPersianNumber, formatRial } from '@salimvand/shared';
import { api } from '../lib/api';

type Supplier = {
  id: string;
  name: string;
  mobile: string | null;
  phone: string | null;
  address: string | null;
  taxId: string | null;
  notes: string | null;
  isActive: boolean;
};
type SupplierDebtor = {
  id: string;
  name: string;
  mobile: string | null;
  debt: string | number;
  invoiceCount: number;
};
type Purchase = {
  id: string;
  number: string;
  total: string | number;
  paidAmount: string | number;
  status: string;
  issuedAt: string;
  items: Array<{
    id: string;
    productName: string;
    quantity: number;
    unitPrice: string | number;
    lineTotal: string | number;
  }>;
};
type SupplierProfile = Supplier & {
  debt: string | number;
  invoiceCount: number;
  purchases: Purchase[];
  supplierPayments: Array<{ id: string; amount: string | number; method: string; paidAt: string }>;
};
const empty = { name: '', mobile: '', phone: '', address: '', taxId: '', notes: '' };

export function SuppliersPage({ canManage = true }: { canManage?: boolean }) {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [debtors, setDebtors] = useState<SupplierDebtor[]>([]);
  const [profile, setProfile] = useState<SupplierProfile | null>(null);
  const [form, setForm] = useState(empty);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; mobile?: string }>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const load = async () => {
    try {
      const [list, debts] = await Promise.all([
        api<{ data: Supplier[] }>(
          `/suppliers${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`,
        ),
        api<{ data: SupplierDebtor[] }>('/suppliers/debtors'),
      ]);
      setRows(list.data);
      setDebtors(debts.data);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const openProfile = async (id: string) => {
    setLoading(true);
    try {
      setProfile((await api<{ data: SupplierProfile }>(`/suppliers/${id}`)).data);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm('تأمین‌کننده غیرفعال شود؟ سوابق خرید حفظ خواهند شد.')) return;
    try {
      await api(`/suppliers/${id}`, { method: 'DELETE' });
      setMessage('تأمین‌کننده غیرفعال شد.');
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const errors: typeof fieldErrors = {};
    if (!form.name.trim()) errors.name = 'نام تأمین‌کننده الزامی است';
    if (form.mobile && !/^09\d{9}$/.test(form.mobile))
      errors.mobile = 'شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود';
    if (Object.keys(errors).length) return setFieldErrors(errors);
    setLoading(true);
    setFieldErrors({});
    try {
      await api(editing ? `/suppliers/${editing.id}` : '/suppliers', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(form),
      });
      setMessage(editing ? 'تأمین‌کننده ویرایش شد.' : 'تأمین‌کننده ثبت شد.');
      setForm(empty);
      setEditing(null);
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const edit = (supplier: Supplier) => {
    setEditing(supplier);
    setForm({
      name: supplier.name,
      mobile: supplier.mobile ?? '',
      phone: supplier.phone ?? '',
      address: supplier.address ?? '',
      taxId: supplier.taxId ?? '',
      notes: supplier.notes ?? '',
    });
  };

  return (
    <section className="suppliers-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">خرید</span>
          <h1>تأمین‌کنندگان</h1>
          <p className="muted">طرف‌حساب‌ها، خریدها، پرداخت‌ها و مانده بدهی</p>
        </div>
        <span className="count">{formatPersianNumber(rows.length)} تأمین‌کننده</span>
      </div>
      {message && <div className="notice">{message}</div>}
      {debtors.length > 0 && (
        <div className="supplier-debt-cards">
          {debtors.slice(0, 4).map((debtor) => (
            <button key={debtor.id} onClick={() => void openProfile(debtor.id)}>
              <small>{debtor.name}</small>
              <strong>{formatRial(Number(debtor.debt))}</strong>
              <span>{formatPersianNumber(debtor.invoiceCount)} فاکتور باز</span>
            </button>
          ))}
        </div>
      )}
      {canManage && (
        <form className="product-form supplier-form" onSubmit={submit}>
          <h2>{editing ? `ویرایش ${editing.name}` : 'ثبت تأمین‌کننده'}</h2>
          <label>
            نام مجموعه یا شخص
            <input
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label>
            موبایل
            <input
              dir="ltr"
              value={form.mobile}
              onChange={(event) => setForm({ ...form, mobile: event.target.value })}
            />
          </label>
          <label>
            تلفن
            <input
              dir="ltr"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
          </label>
          <label>
            شناسه مالیاتی
            <input
              dir="ltr"
              value={form.taxId}
              onChange={(event) => setForm({ ...form, taxId: event.target.value })}
            />
          </label>
          <label>
            آدرس
            <input
              value={form.address}
              onChange={(event) => setForm({ ...form, address: event.target.value })}
            />
          </label>
          <label>
            یادداشت
            <input
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </label>
          {fieldErrors.name && <small className="field-error">{fieldErrors.name}</small>}
          {fieldErrors.mobile && <small className="field-error">{fieldErrors.mobile}</small>}
          <div className="form-actions">
            <button disabled={loading}>
              {loading ? 'در حال ذخیره…' : editing ? 'ذخیره تغییرات' : 'ثبت تأمین‌کننده'}
            </button>
            {editing && (
              <button
                type="button"
                className="outline"
                onClick={() => {
                  setEditing(null);
                  setForm(empty);
                }}
              >
                انصراف
              </button>
            )}
          </div>
        </form>
      )}
      <div className="adjust-box customer-search">
        <input
          placeholder="جست‌وجوی نام، موبایل یا تلفن"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void load();
          }}
        />
        <button onClick={() => void load()}>جست‌وجو</button>
        <button
          className="outline"
          onClick={() => {
            setSearch('');
            window.setTimeout(() => void load(), 0);
          }}
        >
          همه
        </button>
      </div>
      <div className="product-table">
        <div className="table-head supplier-head">
          <span>تأمین‌کننده</span>
          <span>راه ارتباطی</span>
          <span>شناسه مالیاتی</span>
          <span>وضعیت</span>
          <span>عملیات</span>
        </div>
        {rows.map((supplier) => (
          <div className="table-row supplier-row" key={supplier.id}>
            <button className="supplier-name" onClick={() => void openProfile(supplier.id)}>
              <strong>{supplier.name}</strong>
              <small>{supplier.address || 'بدون آدرس'}</small>
            </button>
            <span>
              <code dir="ltr">{formatPersianNumber(supplier.mobile ?? '—')}</code>
              <small dir="ltr">{formatPersianNumber(supplier.phone ?? '')}</small>
            </span>
            <code dir="ltr">{formatPersianNumber(supplier.taxId ?? '—')}</code>
            <span className={supplier.isActive ? 'status-chip' : 'low-stock'}>
              {supplier.isActive ? 'فعال' : 'غیرفعال'}
            </span>
            <span className="row-actions">
              {canManage ? (
                <>
                  <button className="row-action" onClick={() => edit(supplier)}>
                    ویرایش
                  </button>
                  {supplier.isActive && (
                    <button
                      className="row-action danger-text"
                      onClick={() => void remove(supplier.id)}
                    >
                      غیرفعال
                    </button>
                  )}
                </>
              ) : (
                <button className="row-action" onClick={() => void openProfile(supplier.id)}>
                  مشاهده حساب
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      {profile && (
        <div className="editor supplier-profile">
          <div className="editor-head">
            <div>
              <span className="eyebrow">حساب تأمین‌کننده</span>
              <h2>{profile.name}</h2>
            </div>
            <button className="close" onClick={() => setProfile(null)}>
              بستن
            </button>
          </div>
          <div className="supplier-profile-kpis">
            <article>
              <small>مانده بدهی</small>
              <strong>{formatRial(Number(profile.debt))}</strong>
            </article>
            <article>
              <small>تعداد خرید</small>
              <strong>{formatPersianNumber(profile.invoiceCount)}</strong>
            </article>
            <article>
              <small>جمع پرداخت‌ها</small>
              <strong>
                {formatRial(
                  profile.supplierPayments.reduce(
                    (sum, payment) => sum + Number(payment.amount),
                    0,
                  ),
                )}
              </strong>
            </article>
          </div>
          <h3>آخرین فاکتورهای خرید</h3>
          {profile.purchases.length ? (
            profile.purchases.map((purchase) => (
              <article className="supplier-purchase" key={purchase.id}>
                <header>
                  <code>{formatPersianNumber(purchase.number)}</code>
                  <time>{formatJalaliDate(purchase.issuedAt)}</time>
                </header>
                <div>
                  <span>{formatPersianNumber(purchase.items.length)} قلم</span>
                  <strong>{formatRial(Number(purchase.total))}</strong>
                  <b
                    className={
                      Number(purchase.total) > Number(purchase.paidAmount)
                        ? 'low-stock'
                        : 'status-chip'
                    }
                  >
                    مانده {formatRial(Number(purchase.total) - Number(purchase.paidAmount))}
                  </b>
                </div>
              </article>
            ))
          ) : (
            <p className="muted">خریدی ثبت نشده است.</p>
          )}
        </div>
      )}
    </section>
  );
}
