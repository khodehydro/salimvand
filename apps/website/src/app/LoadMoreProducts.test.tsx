// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoadMoreProducts } from './LoadMoreProducts';
import type { CatalogPage } from './catalog-pagination';

const items = (start: number, count = 28) =>
  Array.from({ length: count }, (_, index) => ({
    slug: `p${start + index}`,
    name: `محصول ${start + index}`,
    code: `P-${start + index}`,
    availability: 'in_stock',
  }));
const initial: CatalogPage = { items: items(1), total: 88, totalPages: 4, page: 1 };
const query = 'categoryId=cat&vehicleModelId=car&brandId=brand&inStock=true&q=قاب';
const response = (page: number, count = 28) =>
  new Response(
    JSON.stringify({
      data: {
        items: items((page - 1) * 28 + 1, count),
        page,
        total: 88,
        totalPages: 4,
      },
    }),
  );
const cards = () => document.querySelectorAll('.product-card');

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
    { type: 'navigate' },
  ] as PerformanceNavigationTiming[]);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('28-at-a-time catalog', () => {
  it('server renders 28 cards and a real crawlable next-page link', () => {
    const html = renderToStaticMarkup(<LoadMoreProducts initial={initial} query={query} />);
    expect(html.match(/class="product-card"/g)).toHaveLength(28);
    expect(html).toContain('rel="next"');
    expect(html).toContain('page=2#catalog');
    expect(html).toContain('نمایش ۲۸ از ۸۸ محصول');
  });

  it('appends 28 per click, preserves filters, and stops at the partial final page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(2))
      .mockResolvedValueOnce(response(3))
      .mockResolvedValueOnce(response(4, 4));
    vi.stubGlobal('fetch', fetchMock);
    render(<LoadMoreProducts initial={initial} query={query} />);
    expect(cards()).toHaveLength(28);
    for (const expected of [56, 84, 88]) {
      fireEvent.click(screen.getByRole('button', { name: /نمایش محصولات بیشتر/ }));
      await waitFor(() => expect(cards()).toHaveLength(expected));
    }
    expect(screen.queryByRole('button', { name: /نمایش محصولات بیشتر/ })).toBeNull();
    expect(screen.getByText('به پایان نتایج رسیدید.')).toBeTruthy();
    for (const [index, [url]] of fetchMock.mock.calls.entries()) {
      expect(String(url).startsWith('/catalog/products?')).toBe(true);
      const params = new URL(String(url), 'https://example.com').searchParams;
      expect(params.get('pageSize')).toBe('28');
      expect(params.get('page')).toBe(String(index + 2));
      expect(params.get('categoryId')).toBe('cat');
      expect(params.get('vehicleModelId')).toBe('car');
      expect(params.get('brandId')).toBe('brand');
      expect(params.get('inStock')).toBe('true');
      expect(params.get('q')).toBe('قاب');
    }
  });

  it('does not clear loaded cards on failure and retries the same page', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response(2));
    vi.stubGlobal('fetch', fetchMock);
    render(<LoadMoreProducts initial={initial} query={query} />);
    fireEvent.click(screen.getByRole('button', { name: /نمایش محصولات بیشتر/ }));
    await screen.findByRole('alert');
    expect(cards()).toHaveLength(28);
    fireEvent.click(screen.getByRole('button', { name: /تلاش مجدد/ }));
    await waitFor(() => expect(cards()).toHaveLength(56));
    expect(fetchMock.mock.calls[0][0]).toBe(fetchMock.mock.calls[1][0]);
  });

  it('prevents overlapping requests on rapid repeated clicks', async () => {
    let resolve!: (value: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<LoadMoreProducts initial={initial} query={query} />);
    const button = screen.getByRole('button', { name: /نمایش محصولات بیشتر/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      resolve(response(2));
    });
    await waitFor(() => expect(cards()).toHaveLength(56));
  });

  it('resets to 28 on filter changes and aborts stale responses', async () => {
    let resolve!: (value: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(
      <LoadMoreProducts key="a" initial={initial} query="categoryId=a" />,
    );
    fireEvent.click(screen.getByRole('button', { name: /نمایش محصولات بیشتر/ }));
    const signal = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal!;
    rerender(
      <LoadMoreProducts key="b" initial={{ ...initial, items: items(101) }} query="categoryId=b" />,
    );
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve(response(2));
    });
    expect(cards()).toHaveLength(28);
    expect(screen.queryByText('محصول 29')).toBeNull();
    expect(screen.getByText('محصول 101')).toBeTruthy();
  });

  it('restores appended products and scroll when returning from a product', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(2)));
    const { unmount } = render(<LoadMoreProducts initial={initial} query={query} />);
    fireEvent.click(screen.getByRole('button', { name: /نمایش محصولات بیشتر/ }));
    await waitFor(() => expect(cards()).toHaveLength(56));
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1200 });
    fireEvent(window, new Event('pagehide'));
    unmount();
    vi.mocked(performance.getEntriesByType).mockReturnValue([
      { type: 'back_forward' },
    ] as PerformanceNavigationTiming[]);
    render(<LoadMoreProducts initial={initial} query={query} />);
    await waitFor(() => expect(cards()).toHaveLength(56));
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith(0, 1200));
  });

  it('does not restore the previous listing on a fresh visit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(2)));
    const { unmount } = render(<LoadMoreProducts initial={initial} query={query} />);
    fireEvent.click(screen.getByRole('button', { name: /نمایش محصولات بیشتر/ }));
    await waitFor(() => expect(cards()).toHaveLength(56));
    fireEvent(window, new Event('pagehide'));
    unmount();
    render(<LoadMoreProducts initial={initial} query={query} />);
    expect(cards()).toHaveLength(28);
  });

  it('keeps next/previous links on category and vehicle paths', () => {
    render(
      <LoadMoreProducts
        initial={{ ...initial, page: 2 }}
        query="categoryId=cat&page=2"
        pagePath="/category/parts"
      />,
    );
    expect(screen.getByRole('button', { name: /نمایش محصولات بیشتر/ }).getAttribute('href')).toBe(
      '/category/parts?categoryId=cat&page=3#catalog',
    );
    expect(screen.getByRole('link', { name: 'مشاهدهٔ محصولات قبلی' }).getAttribute('href')).toBe(
      '/category/parts?categoryId=cat&page=1#catalog',
    );
  });
});
