import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatPersianNumber } from '@salimvand/shared';
import { designSystemCss } from './styles';
import {
  availabilityLabels,
  availabilityTone,
  brand,
  chartColors,
  type Theme,
  type Tone,
} from './tokens';

type ClassName = string | undefined;
const cx = (...parts: Array<ClassName | false | null | undefined>) =>
  parts.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ theme */

const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void }>({
  theme: 'light',
  setTheme: () => undefined,
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({
  theme,
  dir = 'rtl',
  className,
  children,
}: PropsWithChildren<{ theme: Theme; dir?: 'rtl' | 'ltr'; className?: string }>) {
  const [current, setCurrent] = useState<Theme>(theme);
  useEffect(() => setCurrent(theme), [theme]);
  const value = useMemo(() => ({ theme: current, setTheme: setCurrent }), [current]);
  return (
    <ThemeContext.Provider value={value}>
      <div dir={dir} data-theme={current} className={cx('sv-theme', className)}>
        <style dangerouslySetInnerHTML={{ __html: designSystemCss }} />
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <button
      type="button"
      className={cx('sv-btn sv-btn--ghost sv-btn--icon', className)}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label={theme === 'dark' ? 'پوستهٔ روشن' : 'پوستهٔ تاریک'}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}

/* -------------------------------------------------------------- primitives */

export type ButtonVariant = 'primary' | 'outline' | 'soft' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...props
}: PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
  }
>) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx(
        'sv-btn',
        `sv-btn--${variant}`,
        `sv-btn--${size}`,
        loading && 'is-loading',
        className,
      )}
    >
      {loading && <span className="sv-spinner" aria-hidden />}
      {children}
    </button>
  );
}

/** Backwards-compatible alias for the first iteration of the design system. */
export const BrandButton = Button;

export function Badge({
  tone = 'neutral',
  className,
  children,
}: PropsWithChildren<{ tone?: Tone; className?: string }>) {
  return <span className={cx('sv-badge', `sv-badge--${tone}`, className)}>{children}</span>;
}

export function AvailabilityBadge({
  availability,
  className,
}: {
  availability: string;
  className?: string;
}) {
  return (
    <Badge tone={availabilityTone(availability)} className={className}>
      {availabilityLabels[availability] ?? availability}
    </Badge>
  );
}

export function BrandChip({ name, inStock }: { name: string; inStock: boolean }) {
  return (
    <span className={cx('sv-brand-chip', inStock ? 'is-in' : 'is-out')}>
      <i aria-hidden>{inStock ? '✓' : '×'}</i>
      {name}
    </span>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  className,
  children,
}: PropsWithChildren<{
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}>) {
  return (
    <section className={cx('sv-card', className)}>
      {(title || actions) && (
        <header className="sv-card__head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="sv-card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function KpiCard({
  label,
  value,
  delta,
  hint,
  tone = 'neutral',
  onClick,
}: {
  label: string;
  value: ReactNode;
  delta?: string;
  hint?: string;
  tone?: Tone;
  onClick?: () => void;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx('sv-kpi', `sv-kpi--${tone}`)}
    >
      <small>{label}</small>
      <strong>{value}</strong>
      {delta && <em>{delta}</em>}
      {hint && <span>{hint}</span>}
    </Wrapper>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: PropsWithChildren<{
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
}>) {
  return (
    <label className={cx('sv-field', error && 'has-error', className)}>
      <span>
        {label}
        {required && <b aria-hidden> *</b>}
      </span>
      {children}
      {error ? (
        <small className="sv-field__error">{error}</small>
      ) : hint ? (
        <small>{hint}</small>
      ) : null}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('sv-input', className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx('sv-textarea', className)} />;
}

export function Select({
  className,
  children,
  ...props
}: PropsWithChildren<SelectHTMLAttributes<HTMLSelectElement>>) {
  return (
    <select {...props} className={cx('sv-select', className)}>
      {children}
    </select>
  );
}

export function SearchInput({
  value,
  onValueChange,
  onSubmit,
  placeholder = 'جست‌وجو...',
  hotkey,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  hotkey?: string;
  className?: string;
}) {
  return (
    <label className={cx('sv-search', className)}>
      <span aria-hidden>⌕</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSubmit?.(value);
        }}
      />
      {hotkey && <kbd>{hotkey}</kbd>}
    </label>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  className,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <label className={cx('sv-chk', className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function Switch({
  label,
  checked,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={cx('sv-sw', checked && 'is-on')}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="sv-seg" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={option.value === value ? 'is-active' : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; badge?: number }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="sv-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          className={tab.id === active ? 'is-active' : undefined}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {typeof tab.badge === 'number' && <i>{formatPersianNumber(tab.badge)}</i>}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  min = 1,
  onChange,
}: {
  value: number;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="sv-stepper">
      <button type="button" aria-label="کاهش" onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <span>{formatPersianNumber(value)}</span>
      <button type="button" aria-label="افزایش" onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ data */

export type Column<Row> = {
  key: string;
  header: ReactNode;
  align?: 'start' | 'center' | 'end';
  width?: string;
  render?: (row: Row, index: number) => ReactNode;
};

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
  dense = false,
}: {
  columns: Array<Column<Row>>;
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  empty?: ReactNode;
  onRowClick?: (row: Row) => void;
  dense?: boolean;
}) {
  return (
    <div className={cx('sv-table-wrap', dense && 'is-dense')}>
      <table className="sv-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                style={{ textAlign: column.align ?? 'start', width: column.width }}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'is-clickable' : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} style={{ textAlign: column.align ?? 'start' }}>
                  {column.render
                    ? column.render(row, index)
                    : String((row as Record<string, unknown>)[column.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <div className="sv-table__empty">{empty ?? <EmptyState title="رکوردی وجود ندارد" />}</div>
      )}
    </div>
  );
}

export function StockBar({
  value,
  min = 0,
  className,
}: {
  value: number;
  min?: number;
  className?: string;
}) {
  const ratio = min > 0 ? Math.min(1, value / (min * 3 || 1)) : value > 0 ? 1 : 0;
  const tone: Tone = value <= 0 ? 'danger' : min > 0 && value <= min ? 'warn' : 'ok';
  return (
    <div className={cx('sv-stockbar', `is-${tone}`, className)} title={formatPersianNumber(value)}>
      <i style={{ width: `${Math.max(4, Math.round(ratio * 100))}%` }} />
      <b>{formatPersianNumber(value)}</b>
    </div>
  );
}

export function Timeline({
  items,
}: {
  items: Array<{
    id: string;
    title: ReactNode;
    subtitle?: ReactNode;
    meta?: ReactNode;
    tone?: Tone;
  }>;
}) {
  return (
    <ol className="sv-tl">
      {items.map((item) => (
        <li key={item.id} className={cx('sv-tl__item', item.tone && `is-${item.tone}`)}>
          <i aria-hidden />
          <div>
            <b>{item.title}</b>
            {item.subtitle && <small>{item.subtitle}</small>}
          </div>
          {item.meta && <span>{item.meta}</span>}
        </li>
      ))}
      {!items.length && <li className="sv-tl__empty">رویدادی ثبت نشده است.</li>}
    </ol>
  );
}

export function EmptyState({
  icon = '◇',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="sv-empty">
      <span aria-hidden>{icon}</span>
      <b>{title}</b>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx('sv-skeleton', className)} aria-busy>
      {Array.from({ length: lines }, (_, index) => (
        <i key={index} style={{ width: `${100 - index * 12}%` }} />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- overlays */

export function Sheet({
  open,
  title,
  onClose,
  footer,
  children,
}: PropsWithChildren<{
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}>) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="sv-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside
        className="sv-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'پنل کناری'}
      >
        <header>
          <h3>{title}</h3>
          <button
            type="button"
            className="sv-btn sv-btn--ghost sv-btn--icon"
            onClick={onClose}
            aria-label="بستن"
          >
            ✕
          </button>
        </header>
        <div className="sv-sheet__body">{children}</div>
        {footer && <footer className="sv-sheet__foot">{footer}</footer>}
      </aside>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  footer,
  size = 'md',
  children,
}: PropsWithChildren<{
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}>) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="sv-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className={cx('sv-modal', `is-${size}`)} role="dialog" aria-modal="true">
        <header>
          <h3>{title}</h3>
          <button
            type="button"
            className="sv-btn sv-btn--ghost sv-btn--icon"
            onClick={onClose}
            aria-label="بستن"
          >
            ✕
          </button>
        </header>
        <div className="sv-modal__body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export type PaletteGroup = {
  id: string;
  label: string;
  items: Array<{ label: string; detail?: string; onSelect: () => void }>;
};

export function CommandPalette({
  open,
  groups,
  onClose,
  placeholder = 'جست‌وجوی سراسری...',
  query: controlledQuery,
  onQueryChange,
  filterLocally = true,
}: {
  open: boolean;
  groups: PaletteGroup[];
  onClose: () => void;
  placeholder?: string;
  /** Controlled mode: the app owns the query (server-side search) and passes results in. */
  query?: string;
  onQueryChange?: (query: string) => void;
  filterLocally?: boolean;
}) {
  const [internalQuery, setInternalQuery] = useState('');
  const query = controlledQuery ?? internalQuery;
  const setQuery = (value: string) => {
    setInternalQuery(value);
    onQueryChange?.(value);
  };
  const filtered = useMemo(() => {
    if (!filterLocally) return groups.filter((group) => group.items.length > 0);
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            !query.trim() ||
            item.label.includes(query.trim()) ||
            (item.detail ?? '').includes(query.trim()),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, query, filterLocally]);
  const run = useCallback(
    (item: { onSelect: () => void }) => {
      item.onSelect();
      onClose();
    },
    [onClose],
  );
  if (!open) return null;
  return (
    <div
      className="sv-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="sv-palette" role="dialog" aria-modal="true" aria-label="جست‌وجوی سراسری">
        <input
          autoFocus
          value={query}
          placeholder={placeholder}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            const index = Number(event.key);
            if (index >= 1 && index <= filtered.length) {
              const first = filtered[index - 1].items[0];
              if (first) run(first);
            }
          }}
        />
        <div className="sv-palette__body">
          {filtered.map((group, groupIndex) => (
            <section key={group.id}>
              <header>
                <span className="sv-palette__key">{formatPersianNumber(groupIndex + 1)}</span>
                {group.label}
              </header>
              {group.items.map((item) => (
                <button key={`${group.id}-${item.label}`} type="button" onClick={() => run(item)}>
                  <b>{item.label}</b>
                  {item.detail && <small>{item.detail}</small>}
                </button>
              ))}
            </section>
          ))}
          {!filtered.length && (
            <EmptyState title="نتیجه‌ای پیدا نشد" description="عبارت دیگری را امتحان کنید." />
          )}
        </div>
        <footer>↑↓ جابه‌جایی · Enter انتخاب · ۱..۵ پرش به گروه · Esc بستن</footer>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- toasts */

export type Toast = { id: string; message: string; tone?: Tone };
const listeners = new Set<(toasts: Toast[]) => void>();
let toasts: Toast[] = [];

export function pushToast(message: string, tone: Tone = 'neutral') {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  toasts = [...toasts, { id, message, tone }];
  listeners.forEach((listener) => listener(toasts));
  const schedule = typeof window === 'undefined' ? setTimeout : window.setTimeout.bind(window);
  schedule(() => dismissToast(id), 4200);
  return id;
}

export function dismissToast(id: string) {
  toasts = toasts.filter((toast) => toast.id !== id);
  listeners.forEach((listener) => listener(toasts));
}

export function useToasts() {
  const [state, setState] = useState<Toast[]>(toasts);
  useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}

export function ToastStack() {
  const items = useToasts();
  return (
    <div className="sv-toasts" role="status" aria-live="polite">
      {items.map((toast) => (
        <div key={toast.id} className={cx('sv-toast', `is-${toast.tone ?? 'neutral'}`)}>
          <span>{toast.message}</span>
          <button type="button" onClick={() => dismissToast(toast.id)} aria-label="بستن پیام">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- charts */

export function DonutChart({
  data,
  height = 220,
}: {
  data: Array<{ name: string; value: number }>;
  height?: number;
}) {
  const total = data.reduce((sum, entry) => sum + entry.value, 0);
  return (
    <div className="sv-donut">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="58%"
            outerRadius="86%"
            paddingAngle={2}
          >
            {data.map((entry, index) => (
              <Cell
                key={entry.name}
                fill={chartColors[index % chartColors.length]}
                stroke="transparent"
              />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
      <ul className="sv-legend">
        {data.map((entry, index) => (
          <li key={entry.name}>
            <i style={{ background: chartColors[index % chartColors.length] }} />
            <span>{entry.name}</span>
            <b>{formatPersianNumber(entry.value)}</b>
            {total > 0 && (
              <small>{formatPersianNumber(Math.round((entry.value / total) * 100))}٪</small>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TrendBarChart({
  data,
  dataKey = 'value',
  labelKey = 'label',
  height = 240,
}: {
  data: Array<Record<string, string | number>>;
  dataKey?: string;
  labelKey?: string;
  height?: number;
}) {
  return (
    <div className="sv-bars" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--sv-border)" vertical={false} />
          <XAxis dataKey={labelKey} stroke="var(--sv-text-3)" fontSize={11} />
          <YAxis stroke="var(--sv-text-3)" fontSize={11} />
          <Tooltip cursor={{ fill: 'var(--sv-surface-3)' }} />
          <Bar dataKey={dataKey} fill={brand[600]} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------- utilities */

/** Interface numbers are always Persian; codes stay Latin + monospace + LTR. */
export function Num({ value, className }: { value: number | string; className?: string }) {
  return <span className={cx('sv-num', className)}>{formatPersianNumber(value)}</span>;
}

export function Code({ value, className }: { value: string; className?: string }) {
  return (
    <code dir="ltr" className={cx('sv-code', className)}>
      {value}
    </code>
  );
}
