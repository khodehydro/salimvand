import type { CardProduct } from './ProductCard';
import { API_URL } from './config';
import {
  CATALOG_PAGE_SIZE,
  catalogApiQuery,
  catalogPageNumber,
  type CatalogPage,
} from './catalog-pagination';

export async function getCatalogPage(query: URLSearchParams): Promise<CatalogPage> {
  const page = catalogPageNumber(query.get('page'));
  const response = await fetch(`${API_URL}/public/products?${catalogApiQuery(query, page)}`, {
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Catalog unavailable');
  const body = await response.json();
  if (
    !Array.isArray(body?.data) ||
    body.data.length > CATALOG_PAGE_SIZE ||
    !body.meta ||
    body.meta.page !== page ||
    body.meta.pageSize !== CATALOG_PAGE_SIZE ||
    !Number.isSafeInteger(body.meta.total) ||
    body.meta.total < 0 ||
    !Number.isSafeInteger(body.meta.totalPages) ||
    body.meta.totalPages < 0
  ) {
    throw new Error('Invalid catalog response');
  }
  // Cards do not need full descriptions, specs or SEO fields. Keep both SSR
  // hydration and every subsequent browser response small.
  const items = (body.data as CardProduct[]).map((product) => ({
    slug: product.slug,
    name: product.name,
    code: product.code,
    availability: product.availability,
    price: product.price,
    priceUpdatedAtJalali: product.priceUpdatedAtJalali,
    aparatVideoId: product.aparatVideoId,
    brands: product.brands?.slice(0, 4),
    compatibilities: product.compatibilities?.slice(0, 2),
    images: product.images?.slice(0, 1),
    category: product.category ? { name: product.category.name } : undefined,
  }));
  return { items, page, total: body.meta.total, totalPages: body.meta.totalPages };
}
