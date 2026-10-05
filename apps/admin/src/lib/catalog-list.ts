/**
 * Pure helpers behind the unified «محصولات و انبار» list. Everything the
 * table shows for a product — price range, total quantity, shelves, baskets,
 * brands — is derived from the stock lines of the product row, so the product
 * level never hides the numbers the operator needs (the reported «قیمت و
 * قفسه و تعداد نمایش داده نمی‌شود» bug).
 */
import type { InventoryLine, Location, ProductRow } from './catalog-types';
import { basketLabel, locationChip } from './location-label';

/** Prices arrive as strings (BigInt → JSON string) or numbers; never NaN. */
export function priceOf(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type StockTone = 'ok' | 'low' | 'out';

/** Semantic stock state of ONE stock line — same colours everywhere. */
export function lineTone(line: InventoryLine): StockTone {
  if (line.quantity <= 0) return 'out';
  const min = line.minStock ?? 0;
  if (min > 0 && line.quantity <= min) return 'low';
  return 'ok';
}

export const stockToneLabel: Record<StockTone, string> = {
  ok: 'در دسترس',
  low: 'کم‌موجود',
  out: 'ناموجود',
};

export type PriceRange = { min: number | null; max: number | null };

export type ProductAggregate = {
  /** Number of stock lines (قلم) of this product. */
  lines: number;
  totalQuantity: number;
  sale: PriceRange;
  purchase: PriceRange;
  brands: string[];
  /** Shelf codes (for filters) and their human addresses («انبار · 10.1»). */
  shelves: string[];
  shelfLabels: string[];
  baskets: string[];
  basketLabels: string[];
  suppliers: string[];
  vehicles: string[];
  tone: StockTone | 'empty';
  lowLines: number;
  outLines: number;
  /** «۴−۱ قلم»-style summary used in the count column. */
  averageSale: number | null;
};

const rangeOf = (values: number[]): PriceRange =>
  values.length ? { min: Math.min(...values), max: Math.max(...values) } : { min: null, max: null };

const unique = (values: Array<string | undefined | null>): string[] => {
  const seen = new Set<string>();
  for (const value of values) {
    const text = (value ?? '').trim();
    if (text) seen.add(text);
  }
  return [...seen];
};

export function aggregateProduct(product: ProductRow): ProductAggregate {
  const lines = product.inventoryItems ?? [];
  const salePrices = lines.map((line) => priceOf(line.salePrice)).filter((value) => value > 0);
  const purchasePrices = lines
    .map((line) => priceOf(line.purchasePrice))
    .filter((value) => value > 0);
  const tones = lines.map(lineTone);
  const totalQuantity = lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
  const outLines = tones.filter((tone) => tone === 'out').length;
  const lowLines = tones.filter((tone) => tone === 'low').length;
  const tone: ProductAggregate['tone'] = !lines.length
    ? 'empty'
    : outLines === lines.length
      ? 'out'
      : lowLines + outLines > 0
        ? 'low'
        : 'ok';
  return {
    lines: lines.length,
    totalQuantity,
    sale: rangeOf(salePrices),
    purchase: rangeOf(purchasePrices),
    brands: unique(lines.map((line) => line.brand?.name ?? 'بدون برند')),
    shelves: unique(lines.map((line) => line.location?.code)),
    shelfLabels: unique(
      lines.map((line) => (line.location ? locationChip(line.location) : undefined)),
    ),
    baskets: unique(lines.map((line) => line.basket?.code)),
    basketLabels: unique(lines.map((line) => (line.basket ? basketLabel(line.basket) : undefined))),
    suppliers: unique([product.supplier?.name, ...lines.map((line) => line.supplier?.name)]),
    vehicles: unique(
      (product.compatibilities ?? []).map(
        (entry) => `${entry.model.make.name} ${entry.model.name}`,
      ),
    ),
    tone,
    lowLines,
    outLines,
    averageSale: salePrices.length
      ? Math.round(salePrices.reduce((sum, value) => sum + value, 0) / salePrices.length)
      : null,
  };
}

export type CatalogFilters = {
  query: string;
  category: string;
  brand: string;
  vehicle: string;
  placement: string;
  status: string;
  /** «همه» / «کم‌موجود» / «ناموجود» view chips. */
  stock: '' | 'low' | 'out';
};

export const emptyFilters: CatalogFilters = {
  query: '',
  category: '',
  brand: '',
  vehicle: '',
  placement: '',
  status: '',
  stock: '',
};

/** Everything one product can be searched by: name, code, part number, SEO
 *  keywords, vehicles, brands, barcodes, shelf and basket codes. */
export function catalogSearchText(product: ProductRow): string {
  const lines = product.inventoryItems ?? [];
  return [
    product.name,
    product.code,
    product.partNumber ?? '',
    (product.seoKeywords ?? []).join(' '),
    product.category?.name ?? '',
    (product.compatibilities ?? [])
      .map((entry) => `${entry.model.make.name} ${entry.model.name}`)
      .join(' '),
    lines.map((line) => line.brand?.name ?? '').join(' '),
    lines.map((line) => line.barcode ?? '').join(' '),
    lines.map((line) => line.location?.code ?? '').join(' '),
    lines.map((line) => line.location?.name ?? '').join(' '),
    lines.map((line) => line.basket?.code ?? '').join(' '),
  ]
    .join(' ')
    .toLocaleLowerCase('fa');
}

/** Digits are compared in a Persian-friendly way: «۱۰.۱» matches «10.1». */
export function normalizeDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(digit) % 10));
}

export function matchesCatalogFilters(product: ProductRow, filters: CatalogFilters): boolean {
  const query = normalizeDigits(filters.query.trim().toLocaleLowerCase('fa'));
  const haystack = normalizeDigits(catalogSearchText(product));
  if (query && !haystack.includes(query)) return false;
  if (filters.category && (product.category?.name ?? '') !== filters.category) return false;
  if (filters.status && product.status !== filters.status) return false;
  const aggregate = aggregateProduct(product);
  if (filters.brand && !aggregate.brands.includes(filters.brand)) return false;
  if (filters.vehicle && !aggregate.vehicles.includes(filters.vehicle)) return false;
  if (filters.placement) {
    const lines = product.inventoryItems ?? [];
    const inPlacement = lines.some(
      (line) =>
        line.location?.code === filters.placement ||
        line.location?.name === filters.placement ||
        line.basket?.code === filters.placement ||
        line.basket?.name === filters.placement,
    );
    if (!inPlacement) return false;
  }
  if (filters.stock === 'low' && !(aggregate.lowLines + aggregate.outLines > 0)) return false;
  if (filters.stock === 'out' && aggregate.outLines === 0) return false;
  return true;
}

export type CatalogSort =
  'newest' | 'name' | 'quantity-desc' | 'quantity-asc' | 'price-desc' | 'price-asc';

export const sortOptions: Array<{ id: CatalogSort; label: string }> = [
  { id: 'newest', label: 'تازه‌ترین' },
  { id: 'name', label: 'نام (الفبا)' },
  { id: 'quantity-desc', label: 'بیشترین موجودی' },
  { id: 'quantity-asc', label: 'کمترین موجودی' },
  { id: 'price-desc', label: 'گران‌ترین قیمت فروش' },
  { id: 'price-asc', label: 'ارزان‌ترین قیمت فروش' },
];

export function sortProducts(products: ProductRow[], sort: CatalogSort): ProductRow[] {
  const rows = [...products];
  const byName = (a: ProductRow, b: ProductRow) => a.name.localeCompare(b.name, 'fa');
  const salePrice = (product: ProductRow) => aggregateProduct(product).sale.min ?? 0;
  switch (sort) {
    case 'name':
      return rows.sort(byName);
    case 'quantity-desc':
      return rows.sort(
        (a, b) =>
          aggregateProduct(b).totalQuantity - aggregateProduct(a).totalQuantity || byName(a, b),
      );
    case 'quantity-asc':
      return rows.sort(
        (a, b) =>
          aggregateProduct(a).totalQuantity - aggregateProduct(b).totalQuantity || byName(a, b),
      );
    case 'price-desc':
      return rows.sort((a, b) => salePrice(b) - salePrice(a) || byName(a, b));
    case 'price-asc':
      return rows.sort((a, b) => salePrice(a) - salePrice(b) || byName(a, b));
    default:
      return rows;
  }
}

/** Shelf/basket options for the placement filter — codes plus names. */
export function placementOptions(locations: Location[]): Array<{ id: string; label: string }> {
  return locations
    .map((location) => ({
      id: location.code,
      label: location.parent ? `${location.parent.name} · ${location.code}` : location.code,
    }))
    .filter((entry) => Boolean(entry.id));
}

/**
 * Filter options that only make sense when the whole catalogue is known:
 * the distinct categories, brands, vehicles and placements of the loaded
 * rows. Keeps the toolbar dropdowns in sync with the data instead of an
 * empty hard-coded list.
 */
export function filterOptions(products: ProductRow[]) {
  return {
    categories: unique(products.map((product) => product.category?.name)).sort((a, b) =>
      a.localeCompare(b, 'fa'),
    ),
    brands: unique(
      products.flatMap((product) =>
        (product.inventoryItems ?? []).map((line) => line.brand?.name ?? 'بدون برند'),
      ),
    ).sort((a, b) => a.localeCompare(b, 'fa')),
    vehicles: unique(
      products.flatMap((product) =>
        (product.compatibilities ?? []).map(
          (entry) => `${entry.model.make.name} ${entry.model.name}`,
        ),
      ),
    ).sort((a, b) => a.localeCompare(b, 'fa')),
    placements: unique(
      products.flatMap((product) => [
        ...(product.inventoryItems ?? []).map((line) => line.location?.code),
        ...(product.inventoryItems ?? []).map((line) => line.basket?.code),
      ]),
    ).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
  };
}
