// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StoreSlider } from './StoreSlider';

const slides = ['اول', 'دوم', 'سوم'].map((alt, i) => ({
  path: `/uploads/site/slide-0000000${i}.webp`,
  alt,
}));
const show = () => render(<StoreSlider slides={slides} storeName="فروشگاه" />);
const tick = (ms = 3000) => act(() => vi.advanceTimersByTime(ms));
const active = () => screen.getByRole('button', { current: true }).getAttribute('aria-label');
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('store image slider', () => {
  it('server-renders the first image without video, extra cards or browser globals', () => {
    const html = renderToStaticMarkup(<StoreSlider slides={slides} storeName="فروشگاه" />);
    expect(html).toContain('alt="اول"');
    expect(html).toContain('aria-current="true"');
    expect(html).not.toContain('iframe');
    expect(html).not.toContain('hero-video-card');
  });
  it('automatically advances every three seconds and loops', () => {
    show();
    expect(active()).toBe('نمایش تصویر ۱');
    tick(2999);
    expect(active()).toBe('نمایش تصویر ۱');
    tick(1);
    expect(active()).toBe('نمایش تصویر ۲');
    tick();
    expect(active()).toBe('نمایش تصویر ۳');
    tick();
    expect(active()).toBe('نمایش تصویر ۱');
  });
  it('supports indicators and restarts the interval after manual selection', () => {
    show();
    tick(2000);
    fireEvent.click(screen.getByRole('button', { name: 'نمایش تصویر ۳' }));
    expect(active()).toBe('نمایش تصویر ۳');
    tick(1000);
    expect(active()).toBe('نمایش تصویر ۳');
    tick(2000);
    expect(active()).toBe('نمایش تصویر ۱');
  });
  it('supports swiping in both directions without hijacking vertical scrolling', () => {
    show();
    const slider = screen.getByRole('region');
    const swipe = (x: number, y = 20) => {
      fireEvent.touchStart(slider, { touches: [{ clientX: 150, clientY: 20 }] });
      fireEvent.touchEnd(slider, { changedTouches: [{ clientX: x, clientY: y }] });
    };
    swipe(50);
    expect(active()).toBe('نمایش تصویر ۲');
    swipe(250);
    expect(active()).toBe('نمایش تصویر ۱');
    swipe(160, 200);
    expect(active()).toBe('نمایش تصویر ۱');
  });
  it('does not auto-advance while a finger is touching the slider', () => {
    show();
    const slider = screen.getByRole('region');
    fireEvent.touchStart(slider, { touches: [{ clientX: 180, clientY: 20 }] });
    tick(6000);
    expect(active()).toBe('نمایش تصویر ۱');
    fireEvent.touchEnd(slider, { touches: [], changedTouches: [{ clientX: 40, clientY: 20 }] });
    expect(active()).toBe('نمایش تصویر ۲');
    tick();
    expect(active()).toBe('نمایش تصویر ۳');
  });
  it('supports keyboard navigation and shows only image indicators, without play/pause', () => {
    show();
    expect(screen.getAllByRole('button')).toHaveLength(slides.length);
    expect(screen.queryByRole('button', { name: /توقف پخش|ادامهٔ پخش/ })).toBeNull();
    fireEvent.keyDown(screen.getByRole('region'), { key: 'ArrowLeft' });
    expect(active()).toBe('نمایش تصویر ۲');
    tick();
    expect(active()).toBe('نمایش تصویر ۳');
    fireEvent.keyDown(screen.getByRole('region'), { key: 'ArrowRight' });
    expect(active()).toBe('نمایش تصویر ۲');
  });
  it('stops automatic advancement in hidden tabs', () => {
    show();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    tick(10000);
    expect(active()).toBe('نمایش تصویر ۱');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    fireEvent(document, new Event('visibilitychange'));
    tick();
    expect(active()).toBe('نمایش تصویر ۲');
  });
  it('respects reduced motion while keeping manual controls usable', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    show();
    tick(10000);
    expect(active()).toBe('نمایش تصویر ۱');
    fireEvent.click(screen.getByRole('button', { name: 'نمایش تصویر ۳' }));
    expect(active()).toBe('نمایش تصویر ۳');
    expect(screen.queryByRole('button', { name: 'توقف پخش خودکار' })).toBeNull();
  });
  it('handles empty galleries, single slides and unavailable image files', () => {
    const { rerender } = render(<StoreSlider slides={[]} storeName="فروشگاه" />);
    expect(screen.getByText('تصاویر فروشگاه به‌زودی')).not.toBeNull();
    rerender(<StoreSlider slides={[slides[0]]} storeName="فروشگاه" />);
    expect(screen.queryByRole('button')).toBeNull();
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('تصاویر فروشگاه')).not.toBeNull();
  });
});
