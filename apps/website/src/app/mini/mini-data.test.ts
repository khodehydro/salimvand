import { afterEach, describe, expect, it, vi } from 'vitest';
// React's request cache is supplied by Next's RSC runtime, not React DOM 18.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  cache: (fn: unknown) => fn,
}));
import { getMiniFilters, getMiniProduct, miniSpecs } from './mini-data';
const stub = (data: unknown, status = 200) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data }), { status })),
  );
afterEach(() => vi.unstubAllGlobals());
describe('mini app public data', () => {
  it('keeps only card/detail public fields, hidden prices stay hidden', async () => {
    stub({
      name: 'پمپ',
      slug: 'pump',
      code: 'P1',
      availability: 'in_stock',
      price: null,
      description: 'توضیح',
      specs: { جنس: 'فلز' },
      inventoryItems: [{ purchasePrice: 'secret' }],
      internalId: 'private',
      images: [{ path: '/uploads/p.webp', privateKey: 'secret' }],
      brands: [{ name: 'برند', inStock: true, quantity: 22 }],
      compatibilities: [
        {
          model: { name: '۲۰۶', make: { name: 'پژو' } },
          trim: { name: 'تیپ ۵' },
          warehouse: 'hidden',
        },
      ],
    });
    const product = await getMiniProduct('pump');
    expect(product?.price).toBeNull();
    expect(product?.compatibilities?.[0].trim).toEqual({ name: 'تیپ ۵' });
    expect(product?.specs).toEqual([{ label: 'جنس', value: 'فلز' }]);
    expect(JSON.stringify(product)).not.toMatch(
      /secret|internalId|purchasePrice|warehouse|quantity|privateKey/,
    );
  });
  it('keeps an explicitly public price and safely encodes a Persian slug', async () => {
    stub({
      name: 'پمپ',
      slug: 'پمپ',
      code: 'P',
      price: '1250000',
      priceUpdatedAtJalali: '۱۴۰۵/۰۸/۰۳',
    });
    const product = await getMiniProduct('پمپ');
    expect(product?.price).toBe('1250000');
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(encodeURIComponent('پمپ'));
  });
  it('distinguishes missing products from temporary server failure', async () => {
    stub(null, 404);
    expect(await getMiniProduct('missing')).toBeNull();
    stub(null, 503);
    await expect(getMiniProduct('pump')).rejects.toThrow('Product unavailable');
  });
  it('normalizes malformed filter arrays without leaking other fields', async () => {
    stub({
      categories: [null, { id: 'c', name: 'ترمز', secret: true }],
      brands: 'wrong',
      vehicles: [{ id: 'make', name: 'پژو', models: [{ id: 'model', name: '۲۰۶' }, null] }],
    });
    expect(await getMiniFilters()).toEqual({
      categories: [{ id: 'c', name: 'ترمز' }],
      brands: [],
      vehicles: [{ id: 'make', name: 'پژو', models: [{ id: 'model', name: '۲۰۶' }] }],
    });
  });
  it('accepts legacy spec formats and omits malformed nested values', () => {
    expect(
      miniSpecs([
        { key: 'برند', value: 'ایساکو' },
        null,
        { label: 'سایز', value: { invalid: true } },
      ]),
    ).toEqual([{ label: 'برند', value: 'ایساکو' }]);
  });
});
