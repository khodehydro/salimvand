import { describe, expect, it } from 'vitest';
import {
  appendCatalogProducts,
  catalogApiQuery,
  catalogCanonicalPath,
  catalogPageNumber,
} from './catalog-pagination';

describe('catalog pagination contract', () => {
  it('always requests exactly 28, ignoring arbitrary sizes and upstream URLs', () => {
    const query = catalogApiQuery(
      new URLSearchParams(
        'pageSize=9999&url=http://localhost&categoryId=cat&vehicleMakeId=make&inStock=false',
      ),
      2,
    );
    expect(query.toString()).toBe('categoryId=cat&page=2&pageSize=28');
  });
  it.each(['NaN', 'Infinity', '-2', '0', '1.5', '1000000000000', undefined])(
    'normalizes unsafe page %s',
    (value) => {
      expect(catalogPageNumber(value)).toBe(1);
    },
  );
  it('retains valid numbered-page access for crawlers and direct links', () => {
    expect(catalogPageNumber('3')).toBe(3);
  });
  it('gives numbered pages their own canonical URL without exposing implementation page sizes', () => {
    expect(catalogCanonicalPath('/', 'page=2&pageSize=999&categoryId=cat')).toBe(
      '/?categoryId=cat&page=2',
    );
    expect(catalogCanonicalPath('/category/parts', 'page=1')).toBe('/category/parts');
    expect(catalogCanonicalPath('/vehicle/car', 'page=3')).toBe('/vehicle/car?page=3');
  });

  it('does not duplicate overlapping products between pages', () => {
    const product = (slug: string) => ({ slug, name: slug, code: slug, availability: 'in_stock' });
    expect(
      appendCatalogProducts([product('a')], [product('a'), product('b'), product('b')]).map(
        (p) => p.slug,
      ),
    ).toEqual(['a', 'b']);
  });
});
