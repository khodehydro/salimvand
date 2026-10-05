import { describe, expect, it } from 'vitest';
import {
  aggregateProduct,
  catalogSearchText,
  emptyFilters,
  filterOptions,
  lineTone,
  matchesCatalogFilters,
  normalizeDigits,
  priceOf,
  sortProducts,
} from './catalog-list';
import type { ProductRow } from './catalog-types';

const product = (overrides: Partial<ProductRow> = {}): ProductRow => ({
  id: 'p1',
  name: 'لنت جلو پژو ۲۰۶',
  code: 'P-1001',
  slug: 'pad-front-206',
  status: 'active',
  category: { name: 'لنت و ترمز' },
  compatibilities: [{ model: { name: '۲۰۶', make: { name: 'پژو' } } }],
  inventoryItems: [
    {
      id: 'l1',
      barcode: '6001230000011',
      quantity: 5,
      minStock: 2,
      salePrice: '1250000',
      purchasePrice: '800000',
      brand: { name: 'بوش' },
      location: { code: '10.1', name: 'قفسه ۱۰.۱', parent: { name: 'انبار مرکزی' } },
      basket: { code: '1.2', name: 'سبد ۱۰.۱.۲' },
    },
    {
      id: 'l2',
      barcode: '6001230000028',
      quantity: 1,
      minStock: 3,
      salePrice: '990000',
      purchasePrice: '0',
      brand: null,
      location: null,
      basket: null,
    },
  ],
  ...overrides,
});

describe('aggregateProduct', () => {
  it('sums quantities and reports sale/purchase price ranges', () => {
    const aggregate = aggregateProduct(product());
    expect(aggregate.lines).toBe(2);
    expect(aggregate.totalQuantity).toBe(6);
    expect(aggregate.sale).toEqual({ min: 990000, max: 1250000 });
    expect(aggregate.purchase).toEqual({ min: 800000, max: 800000 });
  });

  it('surfaces brands (including brand-less lines), shelves and baskets', () => {
    const aggregate = aggregateProduct(product());
    expect(aggregate.brands).toEqual(['بوش', 'بدون برند']);
    expect(aggregate.shelves).toEqual(['10.1']);
    expect(aggregate.shelfLabels).toEqual(['انبار مرکزی · 10.1']);
    expect(aggregate.baskets).toEqual(['1.2']);
    expect(aggregate.basketLabels).toEqual(['سبد 1.2 — سبد ۱۰.۱.۲']);
    expect(aggregate.vehicles).toEqual(['پژو ۲۰۶']);
  });

  it('marks low / out products so the row shows a warning', () => {
    // l2 is below its threshold → the product counts as low.
    expect(aggregateProduct(product()).tone).toBe('low');
    expect(aggregateProduct(product()).lowLines).toBe(1);
    // A product with no lines at all is its own state (no false «ناموجود»).
    expect(aggregateProduct(product({ inventoryItems: [] })).tone).toBe('empty');
  });

  it('treats non-numeric prices as zero instead of NaN', () => {
    expect(priceOf('1250000')).toBe(1250000);
    expect(priceOf(undefined)).toBe(0);
    expect(priceOf('abc')).toBe(0);
    expect(priceOf(null)).toBe(0);
  });

  it('classifies each line by quantity vs its minimum', () => {
    expect(lineTone({ id: 'a', quantity: 0, salePrice: '1' })).toBe('out');
    expect(lineTone({ id: 'b', quantity: 2, minStock: 2, salePrice: '1' })).toBe('low');
    expect(lineTone({ id: 'c', quantity: 9, minStock: 2, salePrice: '1' })).toBe('ok');
    expect(lineTone({ id: 'd', quantity: 9, minStock: null, salePrice: '1' })).toBe('ok');
  });
});

describe('filters', () => {
  it('searches across name, code, barcode, brand, vehicle and shelf', () => {
    const row = product();
    const haystack = catalogSearchText(row);
    expect(haystack).toContain('بوش');
    expect(haystack).toContain('6001230000011');
    expect(haystack).toContain('پژو ۲۰۶');
    expect(haystack).toContain('10.1');
  });

  it('matches filters, including the low / out views', () => {
    const row = product();
    expect(matchesCatalogFilters(row, { ...emptyFilters, query: 'بوش' })).toBe(true);
    expect(matchesCatalogFilters(row, { ...emptyFilters, query: 'ناموجود' })).toBe(false);
    expect(matchesCatalogFilters(row, { ...emptyFilters, brand: 'بدون برند' })).toBe(true);
    expect(matchesCatalogFilters(row, { ...emptyFilters, placement: '1.2' })).toBe(true);
    expect(matchesCatalogFilters(row, { ...emptyFilters, stock: 'low' })).toBe(true);
    expect(matchesCatalogFilters(row, { ...emptyFilters, stock: 'out' })).toBe(false);
    expect(
      matchesCatalogFilters(product({ inventoryItems: [] }), { ...emptyFilters, stock: 'low' }),
    ).toBe(false);
  });

  it('compares Persian and ASCII digits the same way', () => {
    expect(normalizeDigits('قفسه ۱۰.۱')).toBe('قفسه 10.1');
    expect(matchesCatalogFilters(product(), { ...emptyFilters, query: 'قفسه 10.1' })).toBe(true);
  });

  it('builds the toolbar option lists from the data', () => {
    const options = filterOptions([product()]);
    expect(options.categories).toEqual(['لنت و ترمز']);
    expect(options.brands).toEqual(['بدون برند', 'بوش']);
    expect(options.vehicles).toEqual(['پژو ۲۰۶']);
    expect(options.placements).toEqual(['1.2', '10.1']);
  });
});

describe('sort', () => {
  it('sorts by name, quantity and sale price', () => {
    const cheap = product({ id: 'p2', name: 'آب‌بند', inventoryItems: [] });
    const rows = [product(), cheap];
    expect(sortProducts(rows, 'name').map((row) => row.id)).toEqual(['p2', 'p1']);
    expect(sortProducts(rows, 'quantity-desc').map((row) => row.id)).toEqual(['p1', 'p2']);
    expect(sortProducts(rows, 'price-asc').map((row) => row.id)).toEqual(['p2', 'p1']);
  });

  it('never mutates the input array', () => {
    const rows = [product()];
    const sorted = sortProducts(rows, 'name');
    expect(sorted).not.toBe(rows);
    expect(rows[0].id).toBe('p1');
  });
});
