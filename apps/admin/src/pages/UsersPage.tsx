import { FormEvent, useEffect, useState } from 'react';
import { formatJalaliDate, formatPersianNumber, formatRial } from '@salimvand/shared';
import { api } from '../lib/api';

type User = {
  id: string;
  name: string;
  username: string;
  role: string;
  mobile?: string | null;
  isActive: boolean;
  lastLoginAt?: string | null;
};
type Activity = {
  user: User;
  auditLogs: Array<{ id: string | number; action: string; entityType: string; createdAt: string }>;
  transactions: Array<{
    id: string | number;
    type: string;
    quantityChange: number;
    createdAt: string;
    item?: { product?: { name?: string } };
  }>;
  invoices: Array<{
    id: string;
    number: string;
    total: string | number;
    status: string;
    issuedAt: string;
  }>;
};
const roleLabels: Record<string, string> = {
  super_admin: 'مدیر کل',
  manager: 'مدیر',
  seller: 'فروشنده',
  warehouse: 'انباردار',
  accountant: 'حسابدار',
  wholesale: 'خریدار عمده',
};
const initialForm = { name: '', username: '', password: '', role: 'seller', mobile: '' };

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState(initialForm);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      setUsers((await api<{ data: User[] }>('/users')).data);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      await api('/users', { method: 'POST', body: JSON.stringify(form) });
      setMessage('کاربر جدید ایجاد شد.');
      setForm(initialForm);
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const toggle = async (user: User) => {
    if (!window.confirm(`حساب ${user.name} ${user.isActive ? 'غیرفعال' : 'فعال'} شود؟`)) return;
    try {
      await api(`/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      setMessage('وضعیت حساب تغییر کرد.');
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const openEdit = (user: User) => {
    setEditing(user);
    setEditName(user.name);
    setEditRole(user.role);
    setNewPassword('');
  };
  const saveEdit = async () => {
    if (!editing) return;
    if (!editName.trim()) return setMessage('نام نمایشی الزامی است.');
    if (newPassword && newPassword.length < 10)
      return setMessage('رمز جدید باید حداقل ۱۰ کاراکتر باشد.');
    setLoading(true);
    try {
      await api(`/users/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editName.trim(),
          role: editRole,
          ...(newPassword ? { password: newPassword } : {}),
        }),
      });
      setMessage('کاربر به‌روزرسانی شد.');
      setEditing(null);
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const showActivity = async (user: User) => {
    setLoading(true);
    try {
      setActivity((await api<{ data: Activity }>(`/users/${user.id}/activity`)).data);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="users-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">امنیت</span>
          <h1>کاربران و نقش‌ها</h1>
          <p className="muted">ایجاد حساب، کنترل دسترسی و مشاهدهٔ فعالیت کاربران</p>
        </div>
        <span className="count">{formatPersianNumber(users.length)} کاربر</span>
      </div>
      {message && <div className="notice">{message}</div>}
      <form className="product-form user-form" onSubmit={submit}>
        <h2>ایجاد کاربر</h2>
        <label>
          نام کامل
          <input
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <label>
          نام کاربری
          <input
            required
            dir="ltr"
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
          />
        </label>
        <label>
          رمز عبور
          <input
            required
            minLength={10}
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
        </label>
        <label>
          نقش
          <select
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value })}
          >
            {Object.entries(roleLabels)
              .filter(([role]) => role !== 'super_admin')
              .map(([role, label]) => (
                <option value={role} key={role}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <label>
          موبایل
          <input
            dir="ltr"
            inputMode="tel"
            value={form.mobile}
            onChange={(event) => setForm({ ...form, mobile: event.target.value })}
          />
        </label>
        <button disabled={loading}>{loading ? 'در حال ایجاد…' : 'ایجاد حساب کاربری'}</button>
      </form>
      <div className="product-table">
        <div className="table-head user-head">
          <span>کاربر</span>
          <span>نام کاربری</span>
          <span>نقش</span>
          <span>آخرین ورود</span>
          <span>عملیات</span>
        </div>
        {users.map((user) => (
          <div
            className={`table-row user-row ${user.isActive ? '' : 'row-disabled'}`}
            key={user.id}
          >
            <span>
              <strong>{user.name}</strong>
              <small>
                {formatPersianNumber(user.mobile || 'بدون موبایل')} ·{' '}
                {user.isActive ? 'فعال' : 'غیرفعال'}
              </small>
            </span>
            <code>{user.username}</code>
            <span className="status-chip">{roleLabels[user.role] ?? user.role}</span>
            <small>
              {user.lastLoginAt ? formatJalaliDate(user.lastLoginAt, 'dateTime') : 'هنوز وارد نشده'}
            </small>
            <span className="row-actions">
              <button className="row-action" onClick={() => void showActivity(user)}>
                فعالیت
              </button>
              <button className="row-action" onClick={() => openEdit(user)}>
                ویرایش
              </button>
              <button className="row-action danger-text" onClick={() => void toggle(user)}>
                {user.isActive ? 'غیرفعال' : 'فعال'}
              </button>
            </span>
          </div>
        ))}
      </div>
      {editing && (
        <div className="editor user-editor">
          <div className="editor-head">
            <h2>ویرایش کاربر · {editing.name}</h2>
            <button className="close" onClick={() => setEditing(null)}>
              بستن
            </button>
          </div>
          <label>
            نام نمایشی
            <input
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              placeholder="نامی که در پنل و روی فاکتورها دیده می‌شود"
            />
          </label>
          <label>
            نقش
            <select value={editRole} onChange={(event) => setEditRole(event.target.value)}>
              {Object.entries(roleLabels).map(([role, label]) => (
                <option value={role} key={role}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            رمز عبور جدید (اختیاری)
            <input
              type="password"
              minLength={10}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="حداقل ۱۰ کاراکتر"
            />
          </label>
          <button disabled={loading} onClick={() => void saveEdit()}>
            ذخیره تغییرات
          </button>
        </div>
      )}
      {activity && (
        <div className="editor activity-editor">
          <div className="editor-head">
            <div>
              <span className="eyebrow">گزارش کاربر</span>
              <h2>{activity.user.name}</h2>
            </div>
            <button className="close" onClick={() => setActivity(null)}>
              بستن
            </button>
          </div>
          <div className="activity-summary">
            <article>
              <b>{formatPersianNumber(activity.invoices.length)}</b>
              <small>فاکتور اخیر</small>
            </article>
            <article>
              <b>{formatPersianNumber(activity.transactions.length)}</b>
              <small>تراکنش انبار</small>
            </article>
            <article>
              <b>{formatPersianNumber(activity.auditLogs.length)}</b>
              <small>تغییر ثبت‌شده</small>
            </article>
          </div>
          <h3>فاکتورهای صادرشده</h3>
          {activity.invoices.length ? (
            activity.invoices.map((invoice) => (
              <div className="activity-line" key={invoice.id}>
                <code>{formatPersianNumber(invoice.number)}</code>
                <span>{formatRial(Number(invoice.total))}</span>
                <small>{formatJalaliDate(invoice.issuedAt, 'dateTime')}</small>
              </div>
            ))
          ) : (
            <p className="muted">فاکتوری ثبت نشده است.</p>
          )}
          <h3>آخرین تغییرات</h3>
          {activity.auditLogs.map((log) => (
            <div className="activity-line" key={String(log.id)}>
              <strong>
                {log.action} · {log.entityType}
              </strong>
              <small>{formatJalaliDate(log.createdAt, 'dateTime')}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
