import { useEffect, useMemo, useState } from 'react';
import { formatPersianNumber } from '@salimvand/shared';
import { api } from '../lib/api';

type Product = { id: string; name: string; code: string };
type Media = {
  id: string;
  path: string;
  alt?: string | null;
  isPrimary: boolean;
  product: { id: string; name: string; slug?: string };
};

export function MediaPage() {
  const [items, setItems] = useState<Media[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState('');
  const [alt, setAlt] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      const [mediaResult, productResult] = await Promise.all([
        api<{ data: Media[] }>('/media'),
        api<{ data: Product[] }>('/products'),
      ]);
      setItems(mediaResult.data);
      setProducts(productResult.data);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const value = query.trim().toLocaleLowerCase('fa');
    return value
      ? items.filter((item) =>
          `${item.product.name} ${item.alt ?? ''}`.toLocaleLowerCase('fa').includes(value),
        )
      : items;
  }, [items, query]);

  const upload = async () => {
    if (!productId || !file) return setMessage('محصول و فایل تصویر را انتخاب کنید.');
    const data = new FormData();
    data.append('file', file);
    if (alt.trim()) data.append('alt', alt.trim());
    setLoading(true);
    try {
      await api(`/media/products/${productId}/upload`, { method: 'POST', body: data });
      setMessage('تصویر در دو اندازهٔ بهینه WebP ذخیره شد.');
      setFile(null);
      setAlt('');
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const addUrl = async () => {
    if (!productId || !url.trim()) return setMessage('محصول و نشانی HTTPS تصویر را وارد کنید.');
    setLoading(true);
    try {
      await api(`/media/products/${productId}/url`, {
        method: 'POST',
        body: JSON.stringify({ url: url.trim(), alt: alt.trim() }),
      });
      setMessage('تصویر به محصول متصل شد.');
      setUrl('');
      setAlt('');
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const makePrimary = async (item: Media) => {
    try {
      await api(`/media/products/${item.product.id}/${item.id}/primary`, { method: 'PATCH' });
      setMessage('تصویر اصلی محصول تغییر کرد.');
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const remove = async (item: Media) => {
    if (!window.confirm(`تصویر «${item.product.name}» حذف شود؟`)) return;
    try {
      await api(`/media/products/${item.product.id}/${item.id}`, { method: 'DELETE' });
      setMessage('تصویر حذف شد.');
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  return (
    <section className="media-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">کاتالوگ</span>
          <h1>کتابخانهٔ رسانه</h1>
          <p className="muted">تصاویر محصول را بدون واردکردن شناسه‌های فنی مدیریت کنید.</p>
        </div>
        <span className="count">{formatPersianNumber(items.length)} تصویر</span>
      </div>
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      <div className="media-form">
        <label>
          محصول
          <select value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="">انتخاب محصول…</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} · {product.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          متن جایگزین تصویر
          <input
            value={alt}
            onChange={(event) => setAlt(event.target.value)}
            placeholder="شرح کوتاه و دقیق تصویر"
          />
        </label>
        <label>
          بارگذاری تصویر
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="button"
          onClick={() => void upload()}
          disabled={loading || !productId || !file}
        >
          {loading ? 'در حال پردازش…' : 'بارگذاری و بهینه‌سازی'}
        </button>
        <label>
          یا نشانی HTTPS
          <input
            dir="ltr"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/image.webp"
          />
        </label>
        <button
          type="button"
          className="outline"
          onClick={() => void addUrl()}
          disabled={loading || !productId || !url}
        >
          اتصال تصویر از نشانی
        </button>
      </div>
      <div className="media-toolbar">
        <label className="search-field">
          <span>⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="جست‌وجو در نام محصول یا متن تصویر"
          />
        </label>
        <span>{formatPersianNumber(filtered.length)} نتیجه</span>
      </div>
      {filtered.length ? (
        <div className="media-grid">
          {filtered.map((item) => (
            <article className="media-card" key={item.id}>
              <div className="media-preview">
                <img src={item.path} alt={item.alt ?? item.product.name} loading="lazy" />
                {item.isPrimary && <span className="media-primary">تصویر اصلی</span>}
              </div>
              <strong>{item.product.name}</strong>
              <small>{item.alt || 'متن جایگزین ثبت نشده'}</small>
              <div className="media-actions">
                {!item.isPrimary && (
                  <button type="button" className="outline" onClick={() => void makePrimary(item)}>
                    انتخاب به‌عنوان اصلی
                  </button>
                )}
                <button type="button" className="danger" onClick={() => void remove(item)}>
                  حذف
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <b>تصویری پیدا نشد</b>
          <span>یک تصویر بارگذاری کنید یا عبارت جست‌وجو را تغییر دهید.</span>
        </div>
      )}
    </section>
  );
}
