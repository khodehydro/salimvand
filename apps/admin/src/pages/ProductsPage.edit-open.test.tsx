// @vitest-environment jsdom
/**
 * Guards the «ویرایش» chain end-to-end in the real component tree:
 * row button → GET /products/:id → ProductEditor modal. This is the exact
 * path reported broken by operators («دکمهٔ ویرایش کار نمی‌کند») — a silent
 * failure here used to be invisible because openEditor had no catch.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProductsPage } from './ProductsPage';

vi.mock('../lib/api', () => ({ api: (...args: unknown[]) => mockApi(...args as [string]), downloadFile: vi.fn() }));

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
      model: { id: '55555555-5555-4555-8555-555555555555', name: '۲۰۶', make: { id: '66666666-6666-4666-8666-666666666666', name: 'پژو' } },
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
  if (path === `/products/${row.id}/publish`)
    return Promise.resolve({
      ok: true,
      data: { telegram: { ok: true }, bale: { skipped: true, reason: 'پیکربندی نشده' } },
    });
  return Promise.reject(new Error(`unexpected api call: ${path}`));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('ProductsPage edit button', () => {
  it('opens the product editor when ویرایش is clicked', async () => {
    mockApi = vi.fn((path: string) => defaultRouting(path));
    window.location.hash = '#/products';
    render(<ProductsPage />);

    // The row is rendered from the list payload.
    expect(await screen.findByText('لنت جلو پژو ۲۰۶')).toBeTruthy();
    const editButton = screen.getAllByText('ویرایش')[0];
    expect(editButton).toBeTruthy();

    fireEvent.click(editButton);

    // The editor dialog mounts with the product identity — this is the
    // assertion that failed (by not existing) when the button was «dead».
    const dialog = await screen.findByRole('dialog', { name: /ویرایش لنت جلو پژو ۲۰۶/ });
    expect(dialog).toBeTruthy();
    expect(await waitFor(() => screen.getByDisplayValue('لنت جلو پژو ۲۰۶'))).toBeTruthy();
    // The detail GET ran exactly once for the editor.
    expect(mockApi).toHaveBeenCalledWith(`/products/${row.id}`);
  });

  it('shows the failure reason instead of doing nothing when the detail load fails', async () => {
    mockApi = vi.fn((path: string) =>
      path === `/products/${row.id}`
        ? Promise.reject(new Error('پاسخ نامعتبر از سرور دریافت شد. لطفاً دوباره تلاش کنید.'))
        : defaultRouting(path),
    );
    window.location.hash = '#/products';
    render(<ProductsPage />);

    expect(await screen.findByText('لنت جلو پژو ۲۰۶')).toBeTruthy();
    fireEvent.click(screen.getAllByText('ویرایش')[0]);

    // The optimistic shell still OPENS, and the operator sees why the full
    // detail could not load (previously both silent).
    expect(await screen.findByRole('dialog', { name: /ویرایش لنت جلو پژو ۲۰۶/ })).toBeTruthy();
    expect(
      await screen.findByText(/ویرایشگر با اطلاعات لیست باز شد؛ دریافت کامل اطلاعات محصول ناموفق بود/),
    ).toBeTruthy();
  });

  it('shows price, quantity and shelf of a NO-BRAND line directly on the product row', async () => {
    mockApi = vi.fn((path: string) => {
      if (path === `/products/${row.id}`)
        return Promise.resolve({
          ok: true,
          data: {
            ...detail,
            inventoryItems: [
              {
                ...detail.inventoryItems[0],
                brandId: null,
                brand: null,
                location: { id: '88888888-8888-4888-8888-888888888888', code: '1.1', name: 'قفسه ۱.۱' },
              },
            ],
          },
        });
      if (path === '/products')
        return Promise.resolve({
          ok: true,
          data: [
            {
              ...row,
            inventoryItems: [
              {
                id: '22222222-2222-4222-8222-222222222222',
                quantity: 5,
                minStock: 2,
                salePrice: '1250000',
                purchasePrice: '800000',
                barcode: '6001230000011',
                brand: null,
                location: { id: '88888888-8888-4888-8888-888888888888', code: '1.1', name: 'قفسه ۱.۱' },
                basket: null,
              },
            ],
            },
          ],
        });
      return defaultRouting(path);
    });
    window.location.hash = '#/products';
    render(<ProductsPage />);

    expect(await screen.findByText('لنت جلو پژو ۲۰۶')).toBeTruthy();
    // Every number the operator cares about, at level 1, for a brand-less line.
    expect(screen.getAllByText('بدون برند').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/خرید/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/۸۰۰٬۰۰۰/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/۱٬۲۵۰٬۰۰۰/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/تعداد/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/(^|\s)1\.1(\s|$)/).length).toBeGreaterThan(0);
  });

  it('mounts the editor inside a fixed popup backdrop, not inline in the list', async () => {
    mockApi = vi.fn((path: string) => defaultRouting(path));
    window.location.hash = '#/products';
    render(<ProductsPage />);

    expect(await screen.findByText('لنت جلو پژو ۲۰۶')).toBeTruthy();
    fireEvent.click(screen.getAllByText('ویرایش')[0]);
    const dialog = await screen.findByRole('dialog', { name: /ویرایش لنت جلو پژو ۲۰۶/ });
    // Popup semantics: the dialog's container IS the modal-backdrop element.
    expect(dialog.parentElement?.className).toContain('modal-backdrop');
    // Regression guard for the old inline-editor override: the stylesheet
    // must keep .modal-backdrop fixed and must NOT force it static inside
    // .products-page (that turned the popup into a bottom-of-page block).
    const css = readFileSync('src/styles.css', 'utf8');
    expect(css).toMatch(/\.modal-backdrop\s*{[^}]*position:\s*fixed/s);
    expect(css).not.toMatch(/\.products-page > \.modal-backdrop[\s\S]{0,200}position:\s*static/);
    expect(css).not.toContain('.products-page:has(> .modal-backdrop) > .product-list');
  });

  it('publishes a product to the channels from the عملیات column and reports per-channel results', async () => {
    mockApi = vi.fn((path: string) => defaultRouting(path));
    window.location.hash = '#/products';
    render(<ProductsPage />);

    expect(await screen.findByText('لنت جلو پژو ۲۰۶')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'انتشار در کانال' }));

    // The endpoint ran and the message names both channels' outcome.
    expect(mockApi).toHaveBeenCalledWith(`/products/${row.id}/publish`, {
      method: 'POST',
    });
    expect(
      await screen.findByText(/انتشار «لنت جلو پژو ۲۰۶» — تلگرام: ارسال شد ✓ · بله: پیکربندی نشده/),
    ).toBeTruthy();
  });

  it('opens the کارت قلم sheet from the عملیات column button', async () => {
    mockApi = vi.fn((path: string) =>
      path === `/products/${row.id}` ? Promise.reject(new Error('x')) : defaultRouting(path),
    );
    window.location.hash = '#/products';
    render(<ProductsPage />);

    expect(await screen.findByText('لنت جلو پژو ۲۰۶')).toBeTruthy();
    // The actions column now hosts the card button (exactly one, next to
    // ویرایش/سایت/برچسب/حذف) — not the stock stepper cell.
    const cardButton = screen.getByRole('button', { name: 'کارت قلم' });
    const actionsCell = cardButton.closest('[data-label="عملیات"]');
    expect(actionsCell).toBeTruthy();
    fireEvent.click(cardButton);
    // The sheet mounts with the line identity + prices.
    expect(await screen.findByText(/کارت قلم — لنت جلو پژو ۲۰۶/)).toBeTruthy();
    expect(screen.getAllByText(/۸۰۰٬۰۰۰/).length).toBeGreaterThan(0);
  });

  it('opens the editor instantly from the row while the detail GET is in flight', async () => {
    mockApi = vi.fn((path: string) =>
      path === `/products/${row.id}` ? new Promise(() => {}) : defaultRouting(path),
    );
    window.location.hash = '#/products';
    render(<ProductsPage />);

    expect(await screen.findByText('لنت جلو پژو ۲۰۶')).toBeTruthy();
    fireEvent.click(screen.getAllByText('ویرایش')[0]);

    // No waiting for the detail call: the shell dialog is up immediately.
    expect(await screen.findByRole('dialog', { name: /ویرایش لنت جلو پژو ۲۰۶/ })).toBeTruthy();
    expect(screen.getByText('در حال دریافت کامل اطلاعات محصول…')).toBeTruthy();
  });
});
