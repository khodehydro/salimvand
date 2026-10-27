// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render as renderComponent,
  screen,
  waitFor,
} from '@testing-library/react';
import ContentStudioPage from './ContentStudioPage';
import { api } from '../lib/api';
import { StudioRenderer } from '../lib/content-studio/render';
import { exportStudio, saveStudioBlob } from '../lib/content-studio/export';
vi.mock('../lib/api', async () => {
  const { vi } = await import('vitest');
  return { api: vi.fn() };
});
vi.mock('../lib/content-studio/render', async () => {
  const { vi } = await import('vitest');
  const render = vi.fn();
  return {
    StudioRenderer: class {
      warnings = new Set();
      dispose() {}
      render = render;
    },
  };
});
vi.mock('../lib/content-studio/export', async () => {
  const { vi } = await import('vitest');
  return { exportStudio: vi.fn(), saveStudioBlob: vi.fn() };
});
const request = vi.mocked(api),
  exportMock = vi.mocked(exportStudio),
  saveMock = vi.mocked(saveStudioBlob),
  renderMock = vi.mocked(new StudioRenderer().render);
const products = Array.from({ length: 7 }, (_, i) => ({
  id: `p${i}`,
  name: `آبگیر ${i + 1}`,
  code: `P${i}`,
  image: '',
  category: 'آبگیر',
  vehicles: [],
  available: true,
  variants: [{ id: `v${i}`, name: 'ایساکو', available: true, price: null as string | null }],
}));
const branding = {
  name: 'فروشگاه',
  logo: '',
  phones: '0912',
  website: 'https://shop.test',
  telegram: '',
  bale: '',
  address: '',
};
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  renderMock.mockImplementation(async () => document.createElement('canvas'));
  exportMock.mockResolvedValue({ blob: new Blob(['zip']), filename: 'آبگیر.zip', warnings: [] });
  request.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path.endsWith('options'))
      return {
        data: {
          categories: [{ id: 'c', name: 'آبگیر', parentId: null }],
          vehicles: [],
          brands: [],
        },
      };
    const input = JSON.parse(String(options?.body));
    return {
      data: {
        products: products
          .filter((p) => !input.productIds || input.productIds.includes(p.id))
          .map((p) => ({
            ...p,
            variants: p.variants.map((v) => ({ ...v, price: input.showPrices ? '1250000' : null })),
          })),
        branding,
        capturedAt: '2026-10-27T10:00:00Z',
      },
    };
  });
});
afterEach(() => cleanup());
async function loaded() {
  renderComponent(<ContentStudioPage />);
  await screen.findByRole('checkbox', { name: 'انتخاب آبگیر 1' });
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'ساخت و دانلود همهٔ تصاویر ZIP' })
        .hasAttribute('disabled'),
    ).toBe(false),
  );
}
describe('content studio workspace', () => {
  it('defaults to inquiry and six per page, can deselect/reorder and refreshes only selected IDs before downloading', async () => {
    await loaded();
    expect(screen.getByRole('combobox', { name: 'نمایش قیمت در تصاویر' })).toHaveProperty(
      'value',
      'inquiry',
    );
    expect(screen.getByRole('combobox', { name: 'تعداد اقلام در هر صفحه' })).toHaveProperty(
      'value',
      '6',
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'انتخاب آبگیر 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'انتقال آبگیر 3 به قبل' }));
    fireEvent.click(screen.getByRole('button', { name: 'ساخت و دانلود همهٔ تصاویر ZIP' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const snapshot = exportMock.mock.calls[0][0];
    expect(snapshot.products.map((p: { id: string }) => p.id)).toEqual([
      'p2',
      'p1',
      'p3',
      'p4',
      'p5',
      'p6',
    ]);
    expect(snapshot.products[0].variants[0].price).toBeNull();
    expect(JSON.parse(String(request.mock.calls.at(-1)![1]?.body)).productIds).toEqual([
      'p2',
      'p1',
      'p3',
      'p4',
      'p5',
      'p6',
    ]);
  });
  it('explicitly opts in to export sale prices and supports a single-story preset', async () => {
    await loaded();
    fireEvent.change(screen.getByRole('combobox', { name: 'نمایش قیمت در تصاویر' }), {
      target: { value: 'sale' },
    });
    await waitFor(() =>
      expect(
        request.mock.calls.some(
          (c) => c[1]?.body && JSON.parse(String(c[1].body)).showPrices === true,
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'ساخت و دانلود همهٔ تصاویر ZIP' })
          .hasAttribute('disabled'),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'استوری تک‌محصول' }));
    fireEvent.click(screen.getByRole('button', { name: 'ساخت و دانلود همهٔ تصاویر ZIP' }));
    await waitFor(() => expect(exportMock).toHaveBeenCalled());
    expect(exportMock.mock.calls[0][1]).toMatchObject({
      mode: 'single',
      formats: ['story'],
      showPrices: true,
    });
    expect(exportMock.mock.calls[0][0].products[0].variants[0].price).toBe('1250000');
  });
  it('stores preferences, not product snapshots/prices, and handles an empty selection', async () => {
    await loaded();
    fireEvent.change(screen.getByLabelText('عنوان مجموعه'), { target: { value: 'فهرست آبگیر' } });
    fireEvent.click(screen.getByRole('button', { name: 'ذخیرهٔ تنظیمات طرح' }));
    const saved = localStorage.getItem('salimvand.content-studio.preferences.v1')!;
    expect(JSON.parse(saved).title).toBe('فهرست آبگیر');
    expect(saved).not.toMatch(/1250000|products|variants|capturedAt/);
    fireEvent.click(screen.getByRole('button', { name: 'پاک کردن انتخاب' }));
    expect(
      screen
        .getByRole('button', { name: 'ساخت و دانلود همهٔ تصاویر ZIP' })
        .hasAttribute('disabled'),
    ).toBe(true);
    await screen.findByText('برای دیدن طرح، حداقل یک محصول را انتخاب کنید.');
  });
  it('automatically restores the latest layout and no-price preference without saving product data', async () => {
    await loaded();
    fireEvent.change(screen.getByLabelText('عنوان مجموعه'), { target: { value: 'انتخاب امروز' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'نمایش قیمت در تصاویر' }), {
      target: { value: 'sale' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'نمایش قیمت در تصاویر' }), {
      target: { value: 'none' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'استوری تک‌محصول' }));
    const saved = localStorage.getItem('salimvand.content-studio.preferences.v1')!;
    expect(JSON.parse(saved)).toMatchObject({
      title: 'انتخاب امروز',
      showPriceInfo: false,
      showPrices: false,
      mode: 'single',
      formats: ['story'],
    });
    expect(saved).not.toMatch(/products|variants|capturedAt|1250000/);
    cleanup();
    await loaded();
    expect(screen.getByLabelText('عنوان مجموعه')).toHaveProperty('value', 'انتخاب امروز');
    expect(screen.getByRole('combobox', { name: 'نمایش قیمت در تصاویر' })).toHaveProperty(
      'value',
      'none',
    );
    expect(screen.getByRole('combobox', { name: 'نوع چیدمان' })).toHaveProperty('value', 'single');
    fireEvent.click(screen.getByRole('button', { name: 'ساخت و دانلود همهٔ تصاویر ZIP' }));
    await waitFor(() => expect(exportMock).toHaveBeenCalled());
    expect(JSON.parse(String(request.mock.calls.at(-1)![1]?.body)).showPrices).toBe(false);
    expect(exportMock.mock.calls[0][1]).toMatchObject({ showPriceInfo: false, showPrices: false });
    expect(exportMock.mock.calls[0][0].products[0].variants[0].price).toBeNull();
  });
  it('warns when the browser refuses automatic preference storage', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      await loaded();
      expect(screen.getByRole('alert').textContent).toContain('ذخیرهٔ خودکار');
    } finally {
      set.mockRestore();
    }
  });
  it('cancels without downloading a partial archive', async () => {
    exportMock.mockImplementation(
      (_a, _b, _c, _d, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('cancel', 'AbortError'))),
        ),
    );
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'ساخت و دانلود همهٔ تصاویر ZIP' }));
    await waitFor(() => expect(exportMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'لغو ساخت' }));
    await screen.findByText('عملیات لغو شد؛ فایل ناقص دانلود نمی‌شود.');
    expect(saveMock).not.toHaveBeenCalled();
  });
  it('blocks an export when a chosen product disappeared during refresh', async () => {
    await loaded();
    request.mockImplementationOnce(async () => ({
      data: { products: [], branding, capturedAt: '2026-10-27T10:00:00Z' },
    }));
    fireEvent.click(screen.getByRole('button', { name: 'ساخت و دانلود همهٔ تصاویر ZIP' }));
    await screen.findByText(/بعضی محصولات حذف/);
    expect(exportMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });
});
