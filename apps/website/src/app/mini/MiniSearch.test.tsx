// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MiniSearch } from './MiniSearch';
import { MiniFilters } from './MiniFilters';
import { CATALOG_LEAVE_EVENT } from '../catalog-return';
const { state, push } = vi.hoisted(() => ({
  state: { path: '/mini/telegram', search: '' },
  push: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(state.search),
}));
beforeEach(() => {
  state.path = '/mini/telegram';
  state.search = '';
  push.mockClear();
});
afterEach(cleanup);
describe('persistent mini search', () => {
  for (const platform of ['telegram', 'bale']) {
    it(`searches ${platform}, preserves active filters and resets pagination`, () => {
      const base = `/mini/${platform}`;
      state.path = base;
      state.search = 'categoryId=c&brandId=b&vehicleModelId=v&inStock=true&page=3&q=old';
      const leave = vi.fn();
      window.addEventListener(CATALOG_LEAVE_EVENT, leave);
      render(<MiniSearch base={base} />);
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  آبگیر ۲۰۶  ' } });
      fireEvent.submit(screen.getByRole('search'));
      const url = new URL(push.mock.calls[0][0], 'https://shop.test');
      expect(url.pathname).toBe(base);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        categoryId: 'c',
        brandId: 'b',
        vehicleModelId: 'v',
        inStock: 'true',
        q: 'آبگیر ۲۰۶',
      });
      expect(push.mock.calls[0][1]).toEqual({ scroll: true });
      expect(leave).toHaveBeenCalledOnce();
      window.removeEventListener(CATALOG_LEAVE_EVENT, leave);
    });
  }
  it('searches the catalog from a detail page, without carrying detail-page parameters', () => {
    state.path = '/mini/bale/product/pump';
    state.search = 'unrelated=1';
    render(<MiniSearch base="/mini/bale" />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pump' } });
    fireEvent.click(screen.getByRole('button', { name: 'جست‌وجو' }));
    expect(push).toHaveBeenCalledWith('/mini/bale?q=pump', { scroll: true });
  });
  it('clears the query and keeps the field in sync with URL/back navigation', () => {
    state.search = 'categoryId=c&page=2&q=old';
    const view = render(<MiniSearch base="/mini/telegram" />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '   ' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(push).toHaveBeenCalledWith('/mini/telegram?categoryId=c', { scroll: true });
    state.search = 'q=restored';
    view.rerender(<MiniSearch base="/mini/telegram" />);
    expect(screen.getByRole('searchbox')).toHaveProperty('value', 'restored');
  });
  it('keeps the submitted search when changing a filter, without a duplicate search box', () => {
    const { container } = render(
      <MiniFilters
        base="/mini/bale"
        filters={{ categories: [{ id: 'c', name: 'قطعات' }], brands: [], vehicles: [] }}
        params={{ q: 'آبگیر', brandId: 'b' }}
      />,
    );
    expect(screen.queryByRole('searchbox')).toBeNull();
    fireEvent.change(screen.getByLabelText('دسته‌بندی'), { target: { value: 'c' } });
    const query = new URL(push.mock.calls[0][0], 'https://shop.test').searchParams;
    expect(query.get('q')).toBe('آبگیر');
    expect(query.get('categoryId')).toBe('c');
    fireEvent.click(screen.getByRole('button', { name: 'پاک کردن فیلترها ×' }));
    expect(push).toHaveBeenLastCalledWith('/mini/bale', { scroll: false });
    expect(container.querySelector('#mini-search')).toBeNull();
  });
});
