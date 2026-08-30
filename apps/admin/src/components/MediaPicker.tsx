import { useEffect, useMemo, useState } from 'react';
import { formatPersianNumber } from '@salimvand/shared';
import { api } from '../lib/api';
import { MediaImage } from './MediaImage';

export type PickerItem = {
  id: string;
  path: string;
  alt?: string | null;
  isPrimary?: boolean;
  kind?: 'product' | 'site';
  label?: string;
  product?: { id: string; name: string } | null;
};

/**
 * Modal media library used wherever an operator picks an existing file
 * instead of uploading a new one: the store logo / favicon in settings and
 * attaching images to products. Lists every server media item (product
 * images + site assets) exactly like the media page.
 */
export function MediaPicker({
  open,
  title,
  onClose,
  onSelect,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSelect: (item: PickerItem) => void;
}) {
  const [items, setItems] = useState<PickerItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    api<{ data: PickerItem[] }>('/media')
      .then((result) => setItems(result.data))
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const value = query.trim().toLocaleLowerCase('fa');
    if (!value) return items;
    return items.filter((item) =>
      `${item.product?.name ?? ''} ${item.label ?? ''} ${item.alt ?? ''} ${item.path}`
        .toLocaleLowerCase('fa')
        .includes(value),
    );
  }, [items, query]);

  if (!open) return null;
  return (
    <div className="picker-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="picker-modal">
        <header>
          <b>{title}</b>
          <button type="button" className="picker-close" onClick={onClose} aria-label="بستن">
            ✕
          </button>
        </header>
        <label className="picker-search">
          <span>⌕</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="جست‌وجو در رسانه‌ها…"
          />
        </label>
        {error && <p className="picker-empty">{error}</p>}
        {loading ? (
          <div className="picker-grid">
            <div className="skeleton-block" />
            <div className="skeleton-block" />
            <div className="skeleton-block" />
          </div>
        ) : filtered.length ? (
          <div className="picker-grid">
            {filtered.map((item) => (
              <button
                type="button"
                key={item.id}
                className="picker-item"
                onClick={() => {
                  onSelect(item);
                  onClose();
                }}
                title={item.alt ?? item.product?.name ?? item.label ?? item.path}
              >
                <MediaImage src={item.path} alt={item.alt ?? item.label ?? 'رسانه'} />
                <span>{item.product?.name ?? item.label ?? 'رسانهٔ سایت'}</span>
                {item.kind === 'site' && <small>رسانهٔ سایت</small>}
              </button>
            ))}
          </div>
        ) : (
          <p className="picker-empty">
            {items.length
              ? 'رسانه‌ای با این جست‌وجو پیدا نشد.'
              : 'هنوز رسانه‌ای بارگذاری نشده است — ابتدا از صفحهٔ «رسانه‌ها» فایل اضافه کنید.'}
          </p>
        )}
        <footer>
          <span>{formatPersianNumber(filtered.length)} فایل قابل انتخاب</span>
          <button type="button" className="outline" onClick={onClose}>
            انصراف
          </button>
        </footer>
      </div>
    </div>
  );
}
