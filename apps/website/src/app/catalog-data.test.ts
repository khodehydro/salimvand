import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCatalogPage } from './catalog-data';
import { GET } from './catalog/products/route';

const body = { data: [], meta: { page: 2, pageSize: 28, total: 80, totalPages: 3 } };
afterEach(() => vi.unstubAllGlobals());

describe('server-side public catalog facade', () => {
  it('uses the same 28-item query for SSR and browser requests', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json(body),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await getCatalogPage(new URLSearchParams('categoryId=cat&page=2&pageSize=500'));
    expect(result).toEqual({ items: [], page: 2, total: 80, totalPages: 3 });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('pageSize')).toBe('28');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('categoryId')).toBe('cat');
    const response = await GET(
      new Request('https://store.example/catalog/products?categoryId=cat&page=2'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: result });
  });
  it('sends only card fields while retaining public prices and image thumbnails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...body,
          data: [
            {
              slug: 'part',
              name: 'قطعه',
              code: 'P1',
              availability: 'in_stock',
              price: '100000',
              priceUpdatedAtJalali: '۱۴۰۵/۰۸/۰۳',
              description: 'large detail text',
              specs: { unused: true },
              images: [
                { path: '/large.webp', thumbnailPath: '/small.webp' },
                { path: '/extra.webp' },
              ],
            },
          ],
        }),
      ),
    );
    const result = await getCatalogPage(new URLSearchParams('page=2'));
    expect(result.items[0]).toMatchObject({ price: '100000', priceUpdatedAtJalali: '۱۴۰۵/۰۸/۰۳' });
    expect(result.items[0].images).toHaveLength(1);
    expect(result.items[0].images?.[0].thumbnailPath).toBe('/small.webp');
    expect(result.items[0]).not.toHaveProperty('description');
    expect(result.items[0]).not.toHaveProperty('specs');
  });

  it('reports upstream errors as retryable errors, not empty success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unavailable', { status: 500 })),
    );
    const result = await GET(new Request('https://store.example/catalog/products?page=2'));
    expect(result.status).toBe(503);
    expect(await result.json()).toHaveProperty('error');
  });
  it('rejects a response for the wrong page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ...body, meta: { ...body.meta, page: 1 } })),
    );
    await expect(getCatalogPage(new URLSearchParams('page=2'))).rejects.toThrow(
      'Invalid catalog response',
    );
  });
});
