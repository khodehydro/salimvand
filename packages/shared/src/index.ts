export const APP_NAME = 'فروشگاه سلیم وند';
export const STORE_BRAND = 'فروشگاه آذین خودرو سلیم وند';
export const API_PREFIX = '/api/v1';

export type InventoryAvailability =
  'in_stock' | 'low_stock' | 'out_of_stock' | 'coming_soon' | 'discontinued';
export type UserRole = 'super_admin' | 'manager' | 'seller' | 'warehouse' | 'accountant';

export function formatPersianNumber(value: number | string): string {
  return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)] ?? digit);
}

export function formatRial(value: number): string {
  return `${formatPersianNumber(new Intl.NumberFormat('fa-IR').format(value))} ریال`;
}

export function createSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\u200c\s]+/g, '-')
    .replace(/[^\u0600-\u06ff\u0041-\u005a\u0061-\u007a\u0030-\u0039-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function buildProductSeo(product: {
  name: string;
  categoryName?: string;
  vehicleNames?: string[];
  slug?: string;
}) {
  const vehicles = product.vehicleNames?.slice(0, 3).join('، ');
  const context = vehicles ? ` مناسب ${vehicles}` : '';
  return {
    slug: product.slug ?? createSlug(`${product.name}${vehicles ? ` ${vehicles}` : ''}`),
    seoTitle: `${product.name}${context} | فروشگاه سلیم وند میاندوآب`,
    seoDescription: `معرفی و استعلام ${product.name}${context} از فروشگاه آذین خودرو سلیم وند در میاندوآب، آذربایجان غربی.`,
    seoKeywords: [product.name, ...(product.vehicleNames ?? []), 'سلیم وند', 'میاندوآب'],
  };
}

/** Convert Persian (۰-۹) and Arabic (٠-٩) digits to ASCII digits. Needed for
 * phone dial links: operators type numbers with a Persian keyboard layout. */
export function normalizeDigits(value: string): string {
  return value
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

/** Extract a working iframe embed URL from whatever the operator pasted into
 * the settings: a full `<iframe src="...">` tag from Google Maps "Embed a
 * map", a bare embed URL, or a bare `pb=` code. Google Maps share links
 * (maps.app.goo.gl / /maps/place/…) refuse framing, so they are rejected and
 * the caller falls back to a default map instead of a blank frame. */
export function extractMapEmbedUrl(...inputs: Array<string | null | undefined>): string {
  for (const input of inputs) {
    const raw = String(input ?? '').trim();
    if (!raw) continue;
    // A pasted iframe/embed tag: take its src attribute and recurse.
    const srcMatch = raw.match(/src\s*=\s*["']([^"']+)["']/i);
    if (srcMatch) {
      const fromSrc = extractMapEmbedUrl(srcMatch[1]);
      if (fromSrc) return fromSrc;
      continue;
    }
    if (/^https?:\/\/\S+$/i.test(raw)) {
      try {
        const url = new URL(raw);
        const isGoogleMaps =
          /(^|\.)google\.[a-z.]+$/i.test(url.hostname) && url.pathname.startsWith('/maps');
        const isShortLink = /^maps\.app\.goo\.gl$/i.test(url.hostname);
        if (isShortLink || (isGoogleMaps && !/^\/maps\/embed/.test(url.pathname))) continue;
      } catch {
        continue;
      }
      return raw;
    }
    // Bare Google Maps embed payload (e.g. "!1m18!1m12!1m3!1d…").
    if (raw.startsWith('!')) {
      return `https://www.google.com/maps/embed?pb=${encodeURIComponent(raw)}`;
    }
  }
  return '';
}

export function createEan13(seed: string): string {
  // Letter prefixes (e.g. BRK/FLT product codes) are folded into a base-26
  // number so codes that differ only by prefix never collide; purely numeric
  // seeds (e.g. Date.now()) keep their full 9-digit entropy.
  const letters = seed.replace(/[^A-Za-z]/g, '').toUpperCase();
  let alpha = 0;
  for (const ch of letters) {
    alpha = alpha * 26 + (ch.charCodeAt(0) - 64);
  }
  const numeric = seed.replace(/\D/g, '').padStart(4, '0').slice(-4);
  const digits = letters
    ? String(alpha * 1_000_000 + Number(numeric))
        .padStart(9, '0')
        .slice(-9)
    : seed.replace(/\D/g, '').padStart(9, '0').slice(-9);
  const base = `626${digits}`;
  const sum = base
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${base}${(10 - (sum % 10)) % 10}`;
}

export function formatJalaliDate(
  dateInput: Date | string | number,
  mode: 'date' | 'time' | 'dateTime' = 'date',
): string {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date.getTime())) return '';
  const options: Intl.DateTimeFormatOptions =
    mode === 'time'
      ? { hour: '2-digit', minute: '2-digit', hour12: false }
      : mode === 'dateTime'
        ? {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }
        : { year: 'numeric', month: '2-digit', day: '2-digit' };

  const formatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', options);
  return formatter.format(date);
}
