import { cache } from 'react';
import { API_URL } from '../config';
import type { CardProduct } from '../ProductCard';

export type MiniFilter = { id: string; name: string };
export type MiniFiltersData = {
  categories: MiniFilter[];
  brands: MiniFilter[];
  vehicles: Array<MiniFilter & { models: MiniFilter[] }>;
};
const named = (value: unknown): value is MiniFilter =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as MiniFilter).id === 'string' &&
  typeof (value as MiniFilter).name === 'string';
const namedList = (value: unknown): MiniFilter[] =>
  Array.isArray(value) ? value.filter(named).map(({ id, name }) => ({ id, name })) : [];

export async function getMiniFilters(): Promise<MiniFiltersData> {
  const response = await fetch(`${API_URL}/public/filters`, {
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Filters unavailable');
  const { data } = await response.json();
  return {
    categories: namedList(data?.categories),
    brands: namedList(data?.brands),
    vehicles: Array.isArray(data?.vehicles)
      ? data.vehicles.filter(named).map((make: MiniFilter & { models?: unknown }) => ({
          id: make.id,
          name: make.name,
          models: namedList(make.models),
        }))
      : [],
  };
}

export type MiniProduct = CardProduct & {
  description: string;
  partNumber: string;
  specs: Array<{ label: string; value: string }>;
};
export function miniSpecs(value: unknown): MiniProduct['specs'] {
  const rows = Array.isArray(value)
    ? value.map((entry) => [entry?.label ?? entry?.key, entry?.value])
    : value && typeof value === 'object'
      ? Object.entries(value)
      : [];
  return rows
    .filter(
      ([key, val]) =>
        typeof key === 'string' && ['string', 'number', 'boolean'].includes(typeof val),
    )
    .slice(0, 40)
    .map(([key, val]) => ({ label: String(key).slice(0, 120), value: String(val).slice(0, 500) }));
}

// Request-scoped memoization also deduplicates the detail metadata fetch.
export const getMiniProduct = cache(async (slug: string): Promise<MiniProduct | null> => {
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    /* literal percent in a slug */
  }
  if (!decoded || decoded.length > 300) return null;
  const response = await fetch(`${API_URL}/public/products/${encodeURIComponent(decoded)}`, {
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Product unavailable');
  const { data } = await response.json();
  if (!data || typeof data.name !== 'string' || typeof data.slug !== 'string')
    throw new Error('Invalid product');
  return {
    name: data.name,
    slug: data.slug,
    code: typeof data.code === 'string' ? data.code : '',
    availability: typeof data.availability === 'string' ? data.availability : 'out_of_stock',
    price: typeof data.price === 'string' && /^\d+(\.\d+)?$/.test(data.price) ? data.price : null,
    priceUpdatedAtJalali:
      typeof data.priceUpdatedAtJalali === 'string' ? data.priceUpdatedAtJalali : null,
    aparatVideoId: typeof data.aparatVideoId === 'string' ? data.aparatVideoId : null,
    description: typeof data.description === 'string' ? data.description.slice(0, 12000) : '',
    partNumber: typeof data.partNumber === 'string' ? data.partNumber : '',
    specs: miniSpecs(data.specs),
    category:
      data.category && typeof data.category.name === 'string'
        ? { name: data.category.name }
        : undefined,
    images: Array.isArray(data.images)
      ? data.images
          .filter((image: { path?: unknown }) => image && typeof image.path === 'string')
          .slice(0, 12)
          .map((image: { path: string; thumbnailPath?: string; alt?: string }) => ({
            path: image.path,
            thumbnailPath:
              typeof image.thumbnailPath === 'string' ? image.thumbnailPath : undefined,
            alt: typeof image.alt === 'string' ? image.alt : data.name,
          }))
      : [],
    brands: Array.isArray(data.brands)
      ? data.brands
          .filter((brand: { name?: unknown }) => brand && typeof brand.name === 'string')
          .slice(0, 24)
          .map((brand: { name: string; inStock?: boolean }) => ({
            name: brand.name,
            inStock: brand.inStock === true,
          }))
      : [],
    compatibilities: Array.isArray(data.compatibilities)
      ? data.compatibilities
          .filter(
            (item: { model?: { name?: unknown; make?: { name?: unknown } } }) =>
              item?.model &&
              typeof item.model.name === 'string' &&
              typeof item.model.make?.name === 'string',
          )
          .slice(0, 24)
          .map(
            (item: {
              model: { name: string; make: { name: string } };
              trim?: { name?: unknown };
            }) => ({
              model: { name: item.model.name, make: { name: item.model.make.name } },
              trim: typeof item.trim?.name === 'string' ? { name: item.trim.name } : undefined,
            }),
          )
      : [],
  };
});
