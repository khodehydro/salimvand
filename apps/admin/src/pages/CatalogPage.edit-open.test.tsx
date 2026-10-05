// @vitest-environment jsdom
/**
 * Guards the «ویرایش» chain end-to-end in the real component tree:
 * row button → GET /products/:id → ProductEditor dialog. This is the exact
 * path reported broken by operators («دکمهٔ ویرایش کار نمی‌کند»), and the
 * dialog must appear as a FLOATING overlay — the editor used to be rendered
 * inline at the end of the list («باید تا پایین لیست اسکرول کنیم»).
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
  partNumber: 'PN-1',
  seoKeywords: ['لنت'],
  category: { name: 'لنت و ترمز' },
  images: [],
  compatibilities: [{ model: { name: '۲۰۶', make: { name: 'پژو' } } }],
  inventoryItems: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      quantity: 5,
      minStock: 2,
      salePrice: '1250000',
      purchasePrice: '800000',
      barcode: '6001230000011',
      brand: { name: 'بوش' },
    },
  ],
};

const detail = {
  ...row,
  description: 'توضیح',
  priceDisplay: 'inherit',
  categoryId: '33333333-3333-4333-8333-333333333333',
  category: { id: '33333333-3333-4333-8333-333333333333', name: 'لنت و ترمز' },
  seoTitle: null,
  seoDescription: null,
  aparatVideoId: null,
  supplierId: null,
  supplier: null,
  compatibilities: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      model: {
        id: '55555555-5555-4555-8555-555555555555',
        name: '۲۰۶',
        make: { id: '66666666-6666-4666-8666-666666666666', name: 'پژو' },
      },
      trim: null,
    },
  ],
  inventoryItems: [
    {
      ...row.inventoryItems[0],
      brandId: '77777777-7777-4777-8777-777777777777',
      brand: { id: '77777777-7777-4777-8777-777777777777', name: 'بوش' },
      supplier: null,
      location: null,
      basket: null,
    },
  ],
};

let mockApi = vi.fn();
function defaultRouting(path: string) {
  const ok = (data: unknown) => Promise.resolve({ ok: true, data });
  if (path === '/products') return ok([row]);
  if (path === '/products/seo-keywords/regenerate') return ok({});
  if (path === `/products/${row.id}`) return ok(detail);
  if (path === '/categories')
    return ok([{ id: '33333333-3333-4333-8333-333333333333', name: 'لنت و ترمز' }]);
  if (path === '/brands') return ok([{ id: '77777777-7777-4777-8777-777777777777', name: 'بوش' }]);
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

describe('CatalogPage edit button', () => {
  it('opens the product editor as a floating dialog when ویرایش is clicked', async () => {
    mockApi = vi.fn((path: string) => defaultRouting(path));
    window.location.hash = '#/products';
    render(<CatalogPage {...catalogCapabilities('manager')} />);

    expect(await screen.findByText('لنت جلو پژو ۲۰۶')).toBeTruthy();
    const editButton = screen.getAllByText('ویرایش')[0];
    expect(editButton).toBeTruthy();

    fireEvent.click(editButton);

    const dialog = await screen.findByRole('dialog', { name: /ویرایش لنت جلو پژو ۲۰۶/ });
    expect(dialog).toBeTruthy();
    // The dialog lives inside the fixed overlay — never inline in the list.
    expect(dialog.closest('.modal-backdrop')).toBeTruthy();
    expect(await waitFor(() => screen.getByDisplayValue('لنت جلو پژو ۲۰۶'))).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith(`/products/${row.id}`);
  });

  it('shows the failure reason instead of doing nothing when the detail load fails', async () => {
    mockApi = vi.fn((path: string) =>
      path === `/products/${row.id}`
        ? Promise.reject(new Error('پاسخ نامعتبر از سرور دریافت شد. لطفاً دوباره تلاش کنید.'))
        : defaultRouting(path),
    );
    window.location.hash = '#/products';
    render(<CatalogPage {...catalogCapabilities('manager')} />);

    expect(await screen.findByText('لنت جلو پژو ۲۰۶')).toBeTruthy();
    fireEvent.click(screen.getAllByText('ویرایش')[0]);

    expect(await screen.findByRole('dialog', { name: /ویرایش لنت جلو پژو ۲۰۶/ })).toBeTruthy();
    expect(
      await screen.findByText(
        /ویرایشگر با اطلاعات لیست باز شد؛ دریافت کامل اطلاعات محصول ناموفق بود/,
      ),
    ).toBeTruthy();
  });

  it('opens the editor instantly from the row while the detail GET is in flight', async () => {
    mockApi = vi.fn((path: string) =>
      path === `/products/${row.id}` ? new Promise(() => {}) : defaultRouting(path),
    );
    window.location.hash = '#/products';
    render(<CatalogPage {...catalogCapabilities('manager')} />);

    expect(await screen.findByText('لنت جلو پژو ۲۰۶')).toBeTruthy();
    fireEvent.click(screen.getAllByText('ویرایش')[0]);

    expect(await screen.findByRole('dialog', { name: /ویرایش لنت جلو پژو ۲۰۶/ })).toBeTruthy();
    expect(screen.getByText('در حال دریافت کامل اطلاعات محصول…')).toBeTruthy();
  });

  it('sends a warehouse operator straight to the stock-lines tab, without product tabs', async () => {
    mockApi = vi.fn((path: string) => defaultRouting(path));
    window.location.hash = '#/products';
    render(<CatalogPage {...catalogCapabilities('warehouse')} />);

    expect(await screen.findByText('لنت جلو پژو ۲۰۶')).toBeTruthy();
    fireEvent.click(screen.getAllByText('＋ قلم')[0]);

    const dialog = await screen.findByRole('dialog', { name: /ویرایش لنت جلو پژو ۲۰۶/ });
    await waitFor(() => expect(within(dialog).getByText('قلم‌ها، قیمت و موجودی')).toBeTruthy());
    // Product-level tabs would 403 for this role, so they are not offered.
    expect(within(dialog).queryByText('پایه و سئو')).toBeNull();
    expect(within(dialog).queryByText('تصاویر')).toBeNull();
    expect(within(dialog).queryByText('سازگاری خودرو')).toBeNull();
  });
});
