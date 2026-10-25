'use client';

import { useEffect, useRef, useState } from 'react';
import { formatPersianNumber, type StoreSlide } from '@salimvand/shared';

export function StoreSlider({ slides, storeName }: { slides: StoreSlide[]; storeName: string }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [touching, setTouching] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [inView, setInView] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const root = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const count = slides.length;
  const index = count ? active % count : 0;
  const advance = (delta: number) => {
    if (count > 1) setActive((current) => (current + delta + count) % count);
  };

  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    update();
    document.addEventListener('visibilitychange', update);
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(media?.matches ?? false);
    motion();
    media?.addEventListener('change', motion);
    const observer =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
        : null;
    if (root.current) observer?.observe(root.current);
    return () => {
      document.removeEventListener('visibilitychange', update);
      media?.removeEventListener('change', motion);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (count < 2 || paused || hovered || touching || focused || !visible || !inView || reduced)
      return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % count), 5000);
    return () => window.clearInterval(timer);
  }, [count, index, paused, hovered, touching, focused, visible, inView, reduced]);

  // Warm just the next slide instead of downloading the entire gallery.
  const nextPath = count > 1 ? slides[(index + 1) % count].path : '';
  useEffect(() => {
    if (nextPath) {
      const image = new Image();
      image.src = nextPath;
    }
  }, [nextPath]);

  return (
    <div
      id="video"
      ref={root}
      className="store-slider"
      role="region"
      aria-roledescription="اسلایدر"
      aria-label="تصاویر فروشگاه"
      tabIndex={count > 1 ? 0 : undefined}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={(event) => setFocused(event.target.matches(':focus-visible'))}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          advance(event.key === 'ArrowLeft' ? 1 : -1);
        }
      }}
      onTouchStart={(event) => {
        setTouching(true);
        const point = event.touches[0];
        touch.current = event.touches.length === 1 ? { x: point.clientX, y: point.clientY } : null;
      }}
      onTouchCancel={() => {
        setTouching(false);
        touch.current = null;
      }}
      onTouchEnd={(event) => {
        setTouching(event.touches.length > 0);
        const start = touch.current;
        touch.current = null;
        const end = event.changedTouches[0];
        if (!start || !end) return;
        const dx = end.clientX - start.x,
          dy = end.clientY - start.y;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) advance(dx < 0 ? 1 : -1);
      }}
    >
      {count === 0 && <div className="store-slider-empty">تصاویر فروشگاه به‌زودی</div>}
      {slides.map((slide, i) => (
        <div key={slide.path} className="store-slide" hidden={i !== index}>
          {failed[slide.path] ? (
            <div className="store-slider-empty">تصاویر فروشگاه</div>
          ) : (
            <img
              src={slide.path}
              alt={slide.alt || `${storeName} — تصویر ${formatPersianNumber(i + 1)}`}
              width={1600}
              height={900}
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
              onError={() => setFailed((current) => ({ ...current, [slide.path]: true }))}
            />
          )}
        </div>
      ))}
      {count > 1 && (
        <div className="store-slider-controls">
          <div className="store-slider-dots" role="group" aria-label="انتخاب تصویر">
            {slides.map((slide, i) => (
              <button
                key={slide.path}
                type="button"
                className={i === index ? 'active' : ''}
                aria-current={i === index ? 'true' : undefined}
                aria-label={`نمایش تصویر ${formatPersianNumber(i + 1)}`}
                onClick={() => setActive(i)}
              >
                <span />
              </button>
            ))}
          </div>
          {!reduced && (
            <button
              type="button"
              className="store-slider-pause"
              aria-pressed={paused}
              aria-label={paused ? 'ادامهٔ پخش خودکار' : 'توقف پخش خودکار'}
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? '▶' : 'Ⅱ'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
