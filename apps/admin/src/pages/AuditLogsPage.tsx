import { useEffect, useMemo, useState } from 'react';
import { formatJalaliDate, formatPersianNumber } from '@salimvand/shared';
import { api } from '../lib/api';

type AuditRow = {
  id: string | number;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  createdAt: string;
  user?: { id: string; name: string; username: string; role: string } | null;
};

const actionLabels: Record<string, string> = {
  create: 'ایجاد',
  update: 'ویرایش',
  delete: 'حذف',
  restore: 'بازیابی',
  adjust: 'اصلاح موجودی',
  receive: 'ورود کالا',
  transfer: 'انتقال',
  payment: 'ثبت پرداخت',
  void: 'ابطال',
  return: 'مرجوعی',
};
const entityLabels: Record<string, string> = {
  product: 'محصول',
  inventory: 'موجودی',
  inventory_item: 'قلم انبار',
  invoice: 'فاکتور',
  customer: 'مشتری',
  supplier: 'تأمین‌کننده',
  purchase: 'خرید',
  user: 'کاربر',
  settings: 'تنظیمات',
};

export function AuditLogsPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({ take: '100' });
    if (action) params.set('action', action);
    if (entityType) params.set('entityType', entityType);
    try {
      const result = await api<{ data: { total: number; rows: AuditRow[] } }>(
        `/audit-logs?${params}`,
      );
      setRows(result.data.rows);
      setTotal(result.data.total);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [action, entityType]);
  const filtered = useMemo(() => {
    const value = query.trim().toLocaleLowerCase('fa');
    if (!value) return rows;
    return rows.filter((row) =>
      `${row.user?.name ?? ''} ${row.user?.username ?? ''} ${row.entityId ?? ''} ${actionLabels[row.action] ?? row.action}`
        .toLocaleLowerCase('fa')
        .includes(value),
    );
  }, [query, rows]);

  return (
    <section className="audit-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">امنیت و نظارت</span>
          <h1>تاریخچهٔ تغییرات</h1>
          <p className="muted">ردپای غیرقابل‌ویرایش عملیات حساس سیستم</p>
        </div>
        <span className="count">{formatPersianNumber(total)} رویداد</span>
      </div>
      {message && <div className="notice">{message}</div>}
      <div className="audit-filters">
        <label>
          جست‌وجو
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="کاربر یا شناسه رکورد"
          />
        </label>
        <label>
          عملیات
          <select value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="">همهٔ عملیات</option>
            {Object.entries(actionLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          بخش
          <select value={entityType} onChange={(event) => setEntityType(event.target.value)}>
            <option value="">همهٔ بخش‌ها</option>
            {Object.entries(entityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="outline"
          onClick={() => {
            setAction('');
            setEntityType('');
            setQuery('');
          }}
        >
          پاک کردن
        </button>
      </div>
      {loading ? (
        <div className="skeleton-block" />
      ) : filtered.length ? (
        <div className="audit-list">
          {filtered.map((row) => (
            <button
              className="audit-event"
              type="button"
              key={String(row.id)}
              onClick={() => setSelected(row)}
            >
              <span className={`audit-icon action-${row.action}`}>
                {row.action === 'delete' || row.action === 'void'
                  ? '!'
                  : row.action === 'create'
                    ? '+'
                    : '↻'}
              </span>
              <span>
                <strong>
                  {actionLabels[row.action] ?? row.action}{' '}
                  {entityLabels[row.entityType] ?? row.entityType}
                </strong>
                <small>
                  {row.user?.name ?? 'سیستم'} · <code>{row.entityId?.slice(0, 12) ?? '—'}</code>
                </small>
              </span>
              <time>{formatJalaliDate(row.createdAt, 'dateTime')}</time>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <b>رویدادی یافت نشد</b>
          <span>فیلترها را تغییر دهید.</span>
        </div>
      )}
      {selected && (
        <div className="editor audit-detail">
          <div className="editor-head">
            <div>
              <span className="eyebrow">جزئیات رویداد</span>
              <h2>
                {actionLabels[selected.action] ?? selected.action}{' '}
                {entityLabels[selected.entityType] ?? selected.entityType}
              </h2>
            </div>
            <button className="close" onClick={() => setSelected(null)}>
              بستن
            </button>
          </div>
          <dl>
            <div>
              <dt>کاربر</dt>
              <dd>
                {selected.user ? `${selected.user.name} (${selected.user.username})` : 'سیستم'}
              </dd>
            </div>
            <div>
              <dt>زمان</dt>
              <dd>{formatJalaliDate(selected.createdAt, 'dateTime')}</dd>
            </div>
            <div>
              <dt>IP</dt>
              <dd>
                <code>{selected.ip ?? '—'}</code>
              </dd>
            </div>
            <div>
              <dt>شناسه</dt>
              <dd>
                <code>{selected.entityId ?? '—'}</code>
              </dd>
            </div>
          </dl>
          {selected.before != null && (
            <>
              <h3>پیش از تغییر</h3>
              <pre>{JSON.stringify(selected.before, null, 2)}</pre>
            </>
          )}
          {selected.after != null && (
            <>
              <h3>پس از تغییر</h3>
              <pre>{JSON.stringify(selected.after, null, 2)}</pre>
            </>
          )}
        </div>
      )}
    </section>
  );
}
