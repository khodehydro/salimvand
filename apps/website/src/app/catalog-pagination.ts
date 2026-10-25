import type { CardProduct } from './ProductCard';

export const CATALOG_PAGE_SIZE = 28;
export type CatalogPage = { items: CardProduct[]; page: number; total: number; totalPages: number };
const FILTER_KEYS = ['q', 'categoryId', 'vehicleModelId', 'vehicleTrimId', 'brandId'] as const;

export function catalogPageNumber(value: string | null | undefined): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 100_000 ? page : 1;
}

/** Only supported public filters cross the server-side API boundary. Page size
 * is fixed, regardless of any pageSize supplied in the browser's address bar. */
export function catalogApiQuery(params: URLSearchParams, page: number): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = params.get(key)?.trim();
    if (value) query.set(key, value);
  }
  if (params.get('inStock') === 'true') query.set('inStock', 'true');
  query.set('page', String(catalogPageNumber(String(page))));
  query.set('pageSize', String(CATALOG_PAGE_SIZE));
  return query;
}

export function catalogCanonicalPath(path: string, query: string): string {
  const input = new URLSearchParams(query);
  const page = catalogPageNumber(input.get('page'));
  const params = catalogApiQuery(input, page);
  params.delete('pageSize');
  if (page === 1) params.delete('page');
  return params.size ? `${path}?${params}` : path;
}

export function catalogPageHref(path: string, query: string, page: number): string {
  const params = new URLSearchParams(query);
  params.delete('pageSize');
  params.set('page', String(page));
  return `${path}?${params.toString()}#catalog`;
}

export function appendCatalogProducts(
  current: CardProduct[],
  incoming: CardProduct[],
): CardProduct[] {
  const seen = new Set(current.map((product) => product.slug));
  return [
    ...current,
    ...incoming.filter((product) => {
      if (seen.has(product.slug)) return false;
      seen.add(product.slug);
      return true;
    }),
  ];
}
