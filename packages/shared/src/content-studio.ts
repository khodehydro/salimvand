/** Shared contract: export data contains sale prices only, never inventory internals. */
export const STUDIO_MAX_PRODUCTS = 300;
export const STUDIO_FORMATS = {
  portrait: { width: 1080, height: 1350, label: 'پست عمودی · ۴:۵' },
  square: { width: 1080, height: 1080, label: 'پست مربعی · ۱:۱' },
  story: { width: 1080, height: 1920, label: 'استوری / تیک‌تاک · ۹:۱۶' },
} as const;
export type StudioFormat = keyof typeof STUDIO_FORMATS;
export type StudioVariant = { id: string; name: string; price: string | null; available: boolean };
export type StudioProduct = {
  id: string;
  name: string;
  code: string;
  image: string;
  category: string;
  vehicles: string[];
  available: boolean;
  variants: StudioVariant[];
};
export type StudioBranding = {
  name: string;
  logo: string;
  phones: string;
  website: string;
  telegram: string;
  bale: string;
  address: string;
};
export type StudioSnapshot = {
  products: StudioProduct[];
  branding: StudioBranding;
  capturedAt: string;
};
export type StudioOptions = {
  categories: { id: string; name: string; parentId: string | null }[];
  vehicles: { id: string; name: string; make: { id?: string; name: string } }[];
  brands: { id: string; name: string }[];
};
export type StudioFilter = {
  categoryId?: string;
  vehicleMakeId?: string;
  vehicleModelId?: string;
  brandId?: string;
  q?: string;
  productIds?: string[];
  inStock?: boolean;
  showPrices: boolean;
};
export type StudioSettings = {
  title: string;
  subtitle: string;
  cta: string;
  vehicles: string;
  formats: StudioFormat[];
  mode: 'carousel' | 'single';
  perPage: 3 | 4 | 6;
  cover: boolean;
  showPrices: boolean;
  showCode: boolean;
  showBrands: boolean;
  showAvailability: boolean;
  showVehicles: boolean;
  showContacts: boolean;
  showAddress: boolean;
  showDate: boolean;
  allowMissingImages: boolean;
  trimImages: boolean;
  accent: 'green' | 'gold' | 'blue';
};
export const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  title: '',
  subtitle: 'قطعات خودرو، انتخاب مطمئن',
  cta: 'برای سفارش و استعلام با ما در ارتباط باشید',
  vehicles: 'PEUGEOT | SAMAND | DENA | NISSAN | PAYKAN | RANA',
  formats: ['portrait'],
  mode: 'carousel',
  perPage: 6,
  cover: true,
  showPrices: false,
  showCode: true,
  showBrands: true,
  showAvailability: true,
  showVehicles: true,
  showContacts: true,
  showAddress: false,
  showDate: true,
  allowMissingImages: false,
  trimImages: true,
  accent: 'green',
};
/** Preferences only; never persist prices, selected stock or credentials. */
export function parseStudioSettings(raw: unknown): StudioSettings {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result = { ...DEFAULT_STUDIO_SETTINGS, formats: [...DEFAULT_STUDIO_SETTINGS.formats] };
  for (const key of ['title', 'subtitle', 'cta', 'vehicles'] as const)
    if (typeof v[key] === 'string')
      result[key] = v[key]
        .slice(0, key === 'vehicles' ? 240 : key === 'subtitle' ? 160 : 96)
        .replace(/[\u0000-\u001f]/g, ' ')
        .trim();
  for (const key of [
    'cover',
    'showPrices',
    'showCode',
    'showBrands',
    'showAvailability',
    'showVehicles',
    'showContacts',
    'showAddress',
    'showDate',
    'allowMissingImages',
    'trimImages',
  ] as const)
    if (typeof v[key] === 'boolean') result[key] = v[key];
  if (v.mode === 'single') result.mode = 'single';
  if (v.perPage === 3 || v.perPage === 4 || v.perPage === 6) result.perPage = v.perPage;
  if (v.accent === 'green' || v.accent === 'gold' || v.accent === 'blue') result.accent = v.accent;
  if (Array.isArray(v.formats)) {
    const formats = [
      ...new Set(
        v.formats.filter(
          (f): f is StudioFormat =>
            typeof f === 'string' && Object.prototype.hasOwnProperty.call(STUDIO_FORMATS, f),
        ),
      ),
    ];
    if (formats.length) result.formats = formats;
  }
  return result;
}
export function studioPrice(product: StudioProduct, variantId?: string) {
  const selected = variantId ? product.variants.find((v) => v.id === variantId) : undefined;
  const candidates = selected
    ? [selected]
    : product.variants.some((v) => v.available && v.price !== null)
      ? product.variants.filter((v) => v.available)
      : product.variants;
  const priced = candidates.filter(
    (v) => v.price !== null && /^\d+$/.test(v.price) && BigInt(v.price) > 0n,
  );
  const cheapest = priced.reduce<StudioVariant | undefined>(
    (a, b) => (!a || BigInt(b.price!) < BigInt(a.price!) ? b : a),
    undefined,
  );
  return {
    price: cheapest?.price ?? null,
    from: !selected && product.variants.length > 1 && !!cheapest,
    brand:
      selected?.name ??
      (product.variants.length === 1 ? product.variants[0].name : 'برندهای متنوع'),
    available: selected?.available ?? product.available,
  };
}
export type StudioFrame = {
  kind: 'cover' | 'list' | 'single';
  products: StudioProduct[];
  number: number;
  total: number;
};
export function studioFrames(products: StudioProduct[], settings: StudioSettings): StudioFrame[] {
  if (!products.length) return [];
  if (products.length > STUDIO_MAX_PRODUCTS) throw new Error('حداکثر ۳۰۰ محصول در هر خروجی');
  const frames: Omit<StudioFrame, 'number' | 'total'>[] = [];
  if (settings.mode === 'single')
    for (const product of products) frames.push({ kind: 'single', products: [product] });
  else {
    if (settings.cover) frames.push({ kind: 'cover', products: products.slice(0, 3) });
    for (let i = 0; i < products.length; i += settings.perPage)
      frames.push({ kind: 'list', products: products.slice(i, i + settings.perPage) });
  }
  return frames.map((frame, i) => ({ ...frame, number: i + 1, total: frames.length }));
}
export function studioFolder(name: string): string {
  const cleaned =
    name
      .normalize('NFC')
      .replace(/[<>:"/\\|?*\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g, '-')
      .replace(/\.{2,}/g, '-')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 80) || 'محصولات';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned) ? `_${cleaned}` : cleaned;
}
