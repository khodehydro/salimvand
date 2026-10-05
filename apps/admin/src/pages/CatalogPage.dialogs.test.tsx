// @vitest-environment jsdom
/**
 * The unified page keeps every capability of the old محصولات and انبار tabs,
 * but each one opens as a FLOATING dialog over the single list:
 * «کارت قلم» (item card), «قفسه‌ها و سبدها» (placement manager) and
 * «＋ ثبت محصول» (create form — a button that used to do nothing at all).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CatalogPage } from './CatalogPage';
import { catalogCapabilities } from '../lib/admin-permissions';

vi.mock('../lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...(args as [string])),
  downloadFile: vi.fn(),
}));

const row = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'لنت جلو پژو ۲۰۶',
  code: 'P-1001',
  slug: 'pad-front-206',
  status: 'active',
  category: { name: 'لنت و ترمز' },
  images: [],
  compatibilities: [],
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
      location: { id: 'l1', code: '10.1', name: 'قفسه ۱۰.۱', parent: { name: 'انبار مرکزی' } },
      basket: { id: 'k1', code: '1.2', name: 'سبد ۱۰.۱.۲' },
    },
  ],
};

const locations = [
  { id: 'w1', code: 'W-01', name: 'انبار مرکزی', type: 'warehouse', parentId: null },
  {
    id: 'l1',
    code: '10.1',
    name: 'قفسه ۱۰.۱',
    type: 'shelf',
    parentId: 'w1',
    parent: { id: 'w1', name: 'انبار مرکزی' },
    children: [],
    _count: { items: 1 },
  },
  {
    id: 'k1',
    code: '1.2',
    name: 'سبد ۱۰.۱.۲',
    type: 'basket',
    parentId: 'l1',
    parent: { id: 'l1', name: 'قفسه ۱۰.۱' },
    _count: { basketItems: 1 },
  },
];

let mockApi = vi.fn();
function defaultRouting(path: string, options?: { method?: string }) {
  const ok = (data: unknown) => Promise.resolve({ ok: true, data });
  if (path === '/products') return ok([row]);
  if (path === '/categories') return ok([{ id: 'c1', name: 'لنت و ترمز' }]);
  if (path === '/brands') return ok([{ id: 'b1', name: 'بوش' }]);
  if (path === '/suppliers') return ok([{ id: 's1', name: 'پخش تهران' }]);
  if (path === '/locations') return ok(locations);
  if (path === '/vehicles/tree') return ok([]);
  if (path.endsWith('/transactions')) return ok([]);
  if (path.endsWith('/price-history')) return ok([]);
  if (path === '/locations' && options?.method === 'POST') return ok({ id: 'new' });
  return Promise.reject(new Error(`unexpected api call: ${path}`));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('CatalogPage dialogs', () => {
  it('opens the item card as a floating sheet with the line numbers', async () => {
    mockApi = vi.fn((path: string, options?: { method?: string }) => defaultRouting(path, options));
    render(<CatalogPage {...catalogCapabilities('manager')} />);

    await screen.findByText('لنت جلو پژو ۲۰۶');
    fireEvent.click(screen.getByText('کارت قلم'));

    const dialog = await screen.findByRole('dialog', { name: /کارت قلم/ });
    expect(dialog).toBeTruthy();
    expect(dialog.closest('.sv-backdrop')).toBeTruthy();
    const text = dialog.textContent ?? '';
    expect(text).toContain('بوش');
    expect(text).toContain('انبار مرکزی · 10.1');
    expect(text).toContain('سبد 1.2');
    expect(text).toContain('۷');
    expect(within(dialog).getByText('ثبت ورود کالا')).toBeTruthy();
    expect(within(dialog).getByText('حذف قلم از انبار')).toBeTruthy();
  });

  it('opens the placement manager over the list and creates a shelf', async () => {
    mockApi = vi.fn((path: string, options?: { method?: string }) => {
      if (path === '/locations' && options?.method === 'POST') return Promise.resolve({ ok: true });
      return defaultRouting(path, options);
    });
    render(<CatalogPage {...catalogCapabilities('manager')} />);

    await screen.findByText('لنت جلو پژو ۲۰۶');
    fireEvent.click(screen.getByText('قفسه‌ها و سبدها'));

    const dialog = await screen.findByRole('dialog', { name: 'قفسه‌ها و سبدها' });
    expect(dialog.closest('.modal-backdrop')).toBeTruthy();
    expect(within(dialog).getByText(/قفسه‌ها · /)).toBeTruthy();
    // The warehouse row and the shelf row both name their warehouse.
    expect(within(dialog).getAllByText('انبار مرکزی').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('قفسه ۱۰.۱').length).toBeGreaterThan(0);

    fireEvent.change(within(dialog).getByLabelText(/نام قفسه/), {
      target: { value: 'قفسه عقب' },
    });
    fireEvent.change(within(dialog).getByLabelText(/کد قفسه/), { target: { value: 'B-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'افزودن قفسه' }));

    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        '/locations',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('opens the product registration form from the toolbar button', async () => {
    mockApi = vi.fn((path: string, options?: { method?: string }) => defaultRouting(path, options));
    render(<CatalogPage {...catalogCapabilities('manager')} />);

    await screen.findByText('لنت جلو پژو ۲۰۶');
    fireEvent.click(screen.getByText('＋ ثبت محصول'));

    const dialog = await screen.findByRole('dialog', { name: 'ثبت محصول جدید' });
    expect(dialog.closest('.modal-backdrop')).toBeTruthy();
    expect(within(dialog).getByText('ثبت محصول جدید')).toBeTruthy();
  });

  it('opens the placement tree read-only for a warehouse operator', async () => {
    mockApi = vi.fn((path: string, options?: { method?: string }) => defaultRouting(path, options));
    render(<CatalogPage {...catalogCapabilities('warehouse')} />);

    await screen.findByText('لنت جلو پژو ۲۰۶');
    fireEvent.click(screen.getByText('قفسه‌ها و سبدها'));

    const dialog = await screen.findByRole('dialog', { name: 'قفسه‌ها و سبدها' });
    // The tree is visible (warehouse needs to know where things sit) …
    expect(within(dialog).getAllByText('قفسه ۱۰.۱').length).toBeGreaterThan(0);
    // … but location writes are manager-only on the API, so no forms/buttons.
    expect(within(dialog).queryByRole('button', { name: 'افزودن قفسه' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'افزودن انبار' })).toBeNull();
    expect(within(dialog).queryByText('ویرایش')).toBeNull();
    expect(within(dialog).queryByText('حذف')).toBeNull();
  });
});
