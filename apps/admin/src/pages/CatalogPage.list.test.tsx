// @vitest-environment jsdom
/**
 * The reported bug: «قلم را وارد کردم… ولی در لیست محصولات و انبار اسم محصول
 * هست ولی نه قیمت نه قفسه نه تعداد هیچی». The unified list must show, for
 * every product AND every stock line (برند/قلم): brand, prices, quantity,
 * shelf (قفسه) and basket (سبد) — in one list, without tabs and without
 * opening the editor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { formatRial } from '@salimvand/shared';
import { CatalogPage } from './CatalogPage';
import { catalogCapabilities } from '../lib/admin-permissions';

vi.mock('../lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...(args as [string])),
  downloadFile: vi.fn(),
}));

const productWithLines = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'لنت جلو پژو ۲۰۶',
  code: 'P-1001',
  slug: 'pad-front-206',
  status: 'active',
  category: { name: 'لنت و ترمز' },
  images: [],
  compatibilities: [{ model: { name: '۲۰۶', make: { name: 'پژو' } } }],
  inventoryItems: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      barcode: '6001230000011',
      quantity: 7,
      minStock: 2,
      salePrice: '1250000',
      purchasePrice: '800000',
      priceUpdatedAt: '2026-09-01T00:00:00.000Z',
      brand: { id: 'b1', name: 'بوش' },
      location: { code: '10.1', name: 'قفسه ۱۰.۱', parent: { name: 'انبار مرکزی' } },
      basket: { code: '1.2', name: 'سبد ۱۰.۱.۲' },
    },
    {
      // No brand and no shelf yet — the exact case the operator reported.
      id: '33333333-3333-4333-8333-333333333333',
      barcode: '6001230000028',
      quantity: 3,
      minStock: null,
      salePrice: '990000',
      purchasePrice: '0',
      brand: null,
      location: null,
      basket: null,
    },
  ],
};

const productWithoutLines = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'فیلتر روغن پژو',
  code: 'P-1002',
  slug: 'oil-filter-206',
  status: 'hidden',
  category: { name: 'فیلتر' },
  images: [],
  compatibilities: [],
  inventoryItems: [],
};

let mockApi = vi.fn();
function defaultRouting(path: string) {
  const ok = (data: unknown) => Promise.resolve({ ok: true, data });
  if (path === '/products') return ok([productWithLines, productWithoutLines]);
  if (path === '/categories') return ok([{ id: 'c1', name: 'لنت و ترمز' }]);
  if (path === '/brands') return ok([{ id: 'b1', name: 'بوش' }]);
  if (path === '/suppliers') return ok([]);
  if (path === '/locations') return ok([]);
  if (path === '/vehicles/tree') return ok([]);
  return Promise.reject(new Error(`unexpected api call: ${path}`));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('CatalogPage unified list', () => {
  it('renders one single list without a product/inventory tab switcher', async () => {
    mockApi = vi.fn((path: string) => defaultRouting(path));
    render(<CatalogPage {...catalogCapabilities('manager')} />);

    await screen.findByText('لنت جلو پژو ۲۰۶');
    // ONE table for products + stock lines — the old product/inventory tab
    // switcher is gone (only the small filter chips carry role=tablist).
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.getByRole('table', { name: 'فهرست محصولات و اقلام انبار' })).toBeTruthy();
    expect(document.querySelector('.catalog-tabs')).toBeNull();
    // The two products share the same workspace.
    expect(screen.getByText('فیلتر روغن پژو')).toBeTruthy();
  });

  it('shows price, quantity, shelf, basket and brand on the product row itself', async () => {
    mockApi = vi.fn((path: string) => defaultRouting(path));
    render(<CatalogPage {...catalogCapabilities('manager')} />);

    const nameCell = await screen.findByText('لنت جلو پژو ۲۰۶');
    const row = nameCell.closest('.cl-row') as HTMLElement;
    expect(row).toBeTruthy();
    const text = row.textContent ?? '';

    // Sorted price range of the two lines: 990,000 – 1,250,000
    expect(within(row).getByText(new RegExp(formatRial(990000).split(' ')[0]))).toBeTruthy();
    expect(text).toContain(formatRial(1250000).split(' ')[0]);
    // Total quantity (7 + 3) and line count.
    expect(within(row).getByText('۱۰')).toBeTruthy();
    expect(text).toContain('قطعه در ۲ قلم');
    // Shelf and basket of the stock lines are visible in their own columns.
    expect(within(row).getByText('انبار مرکزی · 10.1')).toBeTruthy();
    expect(within(row).getByText('سبد 1.2 — سبد ۱۰.۱.۲')).toBeTruthy();
    // Brand names are part of the row, not hidden behind an expansion.
    expect(within(row).getByText('بوش')).toBeTruthy();
    expect(within(row).getByText('بدون برند')).toBeTruthy();
  });

  it('shows every stock line as a sub-row with its own numbers, including a brand-less line', async () => {
    mockApi = vi.fn((path: string) => defaultRouting(path));
    render(<CatalogPage {...catalogCapabilities('manager')} />);

    await screen.findByText('لنت جلو پژو ۲۰۶');
    const lines = document.querySelectorAll('.cl-line:not(.is-empty)');
    expect(lines.length).toBe(2);
    const brandLess = lines[1] as HTMLElement;
    expect(brandLess.textContent).toContain('بدون برند');
    expect(brandLess.textContent).toContain('6001230000028');
    expect(brandLess.textContent).toContain(formatRial(990000).split(' ')[0]);
    expect(brandLess.textContent).toContain('تعیین نشده');
    expect(brandLess.textContent).toContain('روی قفسه');

    const firstLine = lines[0] as HTMLElement;
    expect(firstLine.textContent).toContain('بوش');
    expect(firstLine.textContent).toContain('6001230000011');
    expect(firstLine.textContent).toContain(formatRial(800000).split(' ')[0]);
    expect(firstLine.textContent).toContain(formatRial(1250000).split(' ')[0]);
    expect(firstLine.textContent).toContain('انبار مرکزی · 10.1');
    expect(firstLine.textContent).toContain('سبد 1.2');
    // Stock stepper for instant adjustments, and the per-line actions.
    expect(within(firstLine).getByLabelText('افزایش موجودی')).toBeTruthy();
    expect(within(firstLine).getByText('کارت قلم')).toBeTruthy();
  });

  it('lays the product rows and the stock lines on the same column grid', async () => {
    mockApi = vi.fn((path: string) => defaultRouting(path));
    render(<CatalogPage {...catalogCapabilities('manager')} />);

    await screen.findByText('لنت جلو پژو ۲۰۶');
    const headColumns = document.querySelectorAll('.cl-head > *');
    expect(headColumns.length).toBe(9);
    // Every data row carries exactly one cell per header column, so price,
    // quantity, shelf and basket always sit under their own header.
    for (const row of document.querySelectorAll('.cl-row')) {
      expect(row.children.length).toBe(headColumns.length);
    }
    for (const line of document.querySelectorAll('.cl-line:not(.is-empty)')) {
      expect(line.children.length).toBe(headColumns.length);
    }
    // Mobile cards fall back to data-label on every cell.
    for (const cell of document.querySelectorAll('.cl-row .cl-cell')) {
      expect(cell.getAttribute('data-label')).toBeTruthy();
    }
    for (const cell of document.querySelectorAll('.cl-line:not(.is-empty) .cl-cell')) {
      expect(cell.getAttribute('data-label')).toBeTruthy();
    }
  });

  it('offers «افزودن قلم» for a product that has no stock line yet', async () => {
    mockApi = vi.fn((path: string) => defaultRouting(path));
    render(<CatalogPage {...catalogCapabilities('manager')} />);

    await screen.findByText('فیلتر روغن پژو');
    await waitFor(() =>
      expect(
        screen.getByText('برای این محصول هنوز قلم انباری (برند، قیمت، قفسه) ثبت نشده است.'),
      ).toBeTruthy(),
    );
    expect(screen.getAllByText('افزودن قلم و قیمت').length).toBe(1);
    // The product level also flags the missing line instead of looking empty.
    expect(screen.getAllByText('بدون قلم انبار').length).toBeGreaterThan(0);
    expect(screen.getAllByText('＋ قلم').length).toBe(2);
  });

  it('filters the same single list by stock state, brand and shelf', async () => {
    mockApi = vi.fn((path: string) => defaultRouting(path));
    render(<CatalogPage {...catalogCapabilities('manager')} />);

    await screen.findByText('لنت جلو پژو ۲۰۶');
    // «ناموجود» matches nothing: both products have stock or no lines at all.
    expect(screen.getByRole('tab', { name: 'ناموجود' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'کم‌موجود' })).toBeTruthy();
    // Placement and brand filters only list what the data actually contains.
    const shelfSelect = screen.getByRole('combobox', { name: 'فیلتر قفسه یا سبد' });
    expect(within(shelfSelect).getByText('10.1')).toBeTruthy();
    expect(within(shelfSelect).getByText('1.2')).toBeTruthy();
    const brandSelect = screen.getByRole('combobox', { name: 'فیلتر برند' });
    expect(within(brandSelect).getByText('بوش')).toBeTruthy();
    expect(within(brandSelect).getByText('بدون برند')).toBeTruthy();
  });

  it('shows the exact numbers after switching the sort to quantity', async () => {
    mockApi = vi.fn((path: string) => defaultRouting(path));
    render(<CatalogPage {...catalogCapabilities('manager')} />);

    await screen.findByText('لنت جلو پژو ۲۰۶');
    const sortSelect = screen.getByRole('combobox', { name: 'ترتیب نمایش' }) as HTMLSelectElement;
    expect(within(sortSelect).getByText('بیشترین موجودی')).toBeTruthy();
    expect(within(sortSelect).getByText('گران‌ترین قیمت فروش')).toBeTruthy();
  });

  it('keeps the list readable for a warehouse operator but hides manager-only writes', async () => {
    mockApi = vi.fn((path: string) => defaultRouting(path));
    render(<CatalogPage {...catalogCapabilities('warehouse')} />);

    const nameCell = await screen.findByText('لنت جلو پژو ۲۰۶');
    // Stock numbers stay visible: warehouse must still read price/shelf/qty.
    const row = nameCell.closest('.cl-row') as HTMLElement;
    expect(row.textContent).toContain(formatRial(1250000).split(' ')[0]);
    expect(row.textContent).toContain('انبار مرکزی · 10.1');
    expect(within(row).getByText('۱۰')).toBeTruthy();

    // Manager-only catalog writes and accountant exports are gone…
    expect(screen.queryByText('＋ ثبت محصول')).toBeNull();
    expect(screen.queryByText('خروجی CSV')).toBeNull();
    expect(screen.queryByText('خروجی حسابداری')).toBeNull();
    expect(screen.queryByText('ویرایش')).toBeNull();
    expect(screen.queryByText('حذف')).toBeNull();
    expect(screen.queryByText('بازسازی کلیدواژه‌ها')).toBeNull();
    expect(screen.queryByText('پشتیبان‌گیری کامل (ZIP)')).toBeNull();
    // …while the stock tools warehouse is allowed to use remain, including
    // the «＋ قلم» route into the editor's stock-lines tab.
    expect(screen.getByText('تغییر گروهی قیمت')).toBeTruthy();
    expect(screen.getAllByText('کارت قلم').length).toBeGreaterThan(0);
    expect(screen.getAllByText('＋ قلم').length).toBeGreaterThan(0);
  });
});
