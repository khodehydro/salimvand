import { useState } from 'react';
import {
  STORE_SLIDER_LIMIT,
  formatPersianNumber,
  type StoreSliderSettings,
} from '@salimvand/shared';
import { api } from '../lib/api';
import { MediaImage } from './MediaImage';

export function StoreSliderEditor({
  value,
  onChange,
  onBusyChange,
}: {
  value: StoreSliderSettings;
  onChange: (value: StoreSliderSettings) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const upload = async (file?: File) => {
    if (!file || busy || value.slides.length >= STORE_SLIDER_LIMIT) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setMessage('فرمت مجاز: JPG، PNG یا WebP');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage('حجم تصویر باید حداکثر ۵ مگابایت باشد');
      return;
    }
    setBusy(true);
    onBusyChange(true);
    setMessage('');
    try {
      const body = new FormData();
      body.append('file', file);
      const result = await api<{ data: { path: string } }>('/media/settings/slide/upload', {
        method: 'POST',
        body,
      });
      onChange({ slides: [...value.slides, { path: result.data.path, alt: '' }] });
      setMessage('تصویر اضافه شد؛ برای انتشار، تنظیمات را ذخیره کنید.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  const move = (index: number, direction: number) => {
    const slides = [...value.slides];
    [slides[index], slides[index + direction]] = [slides[index + direction], slides[index]];
    onChange({ slides });
  };
  return (
    <fieldset className="store-slider-editor" disabled={busy}>
      <legend>اسلایدر تصاویر فروشگاه</legend>
      <p className="muted">
        جایگزین ویدئوی فروشگاه؛ پخش خودکار هر ۵ ثانیه، اندیکاتور و سوایپ دستی. در موبایل فقط تصاویر
        داخل باکس اصلی نمایش داده می‌شوند.
      </p>
      <p className="muted">
        حداکثر ۱۰ تصویر افقی؛ پیشنهاد: ۱۶۰۰ × ۹۰۰ پیکسل، JPG / PNG / WebP و حداکثر ۵ مگابایت.
        لبه‌های تصویر ممکن است برای پرکردن کادر بریده شوند.
      </p>
      <label>
        افزودن تصویر اسلایدر
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={value.slides.length >= STORE_SLIDER_LIMIT}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            void upload(file);
          }}
        />
      </label>
      <p role="status">
        {busy
          ? 'در حال بارگذاری تصویر…'
          : message || `${formatPersianNumber(value.slides.length)} از ۱۰ تصویر`}
      </p>
      <ol className="store-slider-list">
        {value.slides.map((slide, index) => (
          <li key={slide.path}>
            <MediaImage
              src={slide.path}
              alt={slide.alt || `تصویر ${formatPersianNumber(index + 1)}`}
            />
            <label>
              توضیح تصویر {formatPersianNumber(index + 1)}
              <input
                maxLength={160}
                value={slide.alt}
                placeholder="مثلاً نمای داخل فروشگاه"
                onChange={(event) =>
                  onChange({
                    slides: value.slides.map((item, i) =>
                      i === index ? { ...item, alt: event.target.value } : item,
                    ),
                  })
                }
              />
            </label>
            <div className="store-slider-order">
              <button
                type="button"
                disabled={index === 0}
                aria-label={`انتقال تصویر ${index + 1} به قبل`}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === value.slides.length - 1}
                aria-label={`انتقال تصویر ${index + 1} به بعد`}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => onChange({ slides: value.slides.filter((_, i) => i !== index) })}
              >
                حذف از اسلایدر
              </button>
            </div>
          </li>
        ))}
      </ol>
      <small className="muted">
        افزودن، حذف و ترتیب پس از «ذخیره تنظیمات» منتشر می‌شوند؛ اعمال روی سایت ممکن است تا یک دقیقه
        طول بکشد. حذف از این فهرست فایل را از کتابخانهٔ رسانه پاک نمی‌کند.
      </small>
    </fieldset>
  );
}
