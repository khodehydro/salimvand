export const APP_NAME = 'فروشگاه سلیم وند';
export const STORE_BRAND = 'فروشگاه آذین خودرو سلیم وند';
export const API_PREFIX = '/api/v1';

export type InventoryAvailability =
  'in_stock' | 'low_stock' | 'out_of_stock' | 'coming_soon' | 'discontinued';
export type UserRole = 'super_admin' | 'manager' | 'seller' | 'warehouse' | 'accountant' | 'wholesale';

export function formatPersianNumber(value: number | string): string {
  return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)] ?? digit);
}

/** Persian digits with 3-digit grouping and no unit — 1234567 → «۱٬۲۳۴٬۵۶۷».
 * Accepts bigint (Prisma money columns) and plain numeric strings too, so
 * every rial amount stays exact instead of losing precision through Number(). */
export function formatGroupedPersian(value: number | string | bigint): string {
  let numeric: number | bigint;
  if (typeof value === 'bigint') {
    numeric = value;
  } else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    numeric = BigInt(value.trim());
  } else {
    numeric = Number(value);
  }
  return new Intl.NumberFormat('fa-IR').format(numeric);
}

export function formatRial(value: number | string | bigint): string {
  return `${formatGroupedPersian(value)} ریال`;
}

/** Parse whatever an operator typed into a digit field — Persian/Arabic
 * keyboard digits, thousands separators, spaces — into a plain ASCII digit
 * string ('' when nothing numeric is left). This is the parse side of the
 * Persian-digit inputs: the UI shows ۱٬۲۰۰٬۰۰۰ while the app still receives
 * '1200000', exactly what a type=number input produced before. */
export function parseDigitsInput(raw: string): string {
  const digits = normalizeDigits(String(raw ?? '')).replace(/[^0-9]/g, '');
  if (!digits) return '';
  return digits.replace(/^0+(?=\d)/, '');
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

/** Generates contiguous one-word, two-word, three-word … search phrases.
 * This keeps Persian product search useful without asking the operator to
 * maintain a second keyword list by hand. */
export function buildProductKeywords(name: string, extraPhrases: string[] = []): string[] {
  const phrases = [name, ...extraPhrases]
    .map((value) => String(value ?? '').replace(/[،,؛;|/]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const phrase of phrases) {
    const words = phrase.split(' ');
    for (let size = 1; size <= words.length; size += 1)
      for (let start = 0; start + size <= words.length; start += 1) {
        const keyword = words.slice(start, start + size).join(' ').trim();
        if (keyword && !seen.has(keyword)) {
          seen.add(keyword);
          result.push(keyword);
        }
      }
  }
  for (const keyword of ['سلیم وند', 'میاندوآب']) if (!seen.has(keyword)) result.push(keyword);
  return result;
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
    seoKeywords: buildProductKeywords(product.name, product.vehicleNames ?? []),
  };
}

/** Extract an Aparat video hash from whatever the operator pasted: a bare
 * hash, a share link (aparat.com/v/HASH) or an embed URL
 * (aparat.com/video/video/embed/videohash/HASH/vt/frame). */
export function extractAparatVideoId(input: string | null | undefined): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  const embed = raw.match(/videohash\/([A-Za-z0-9_-]+)/i);
  if (embed) return embed[1];
  const share = raw.match(/aparat\.com\/(?:v|w)\/([A-Za-z0-9_-]+)/i);
  if (share) return share[1];
  if (/^[A-Za-z0-9_-]{4,}$/.test(raw)) return raw;
  return '';
}

/** Parse a coordinate typed by the operator; returns null when invalid.
 * Accepts Persian/Arabic digits (operators use a Persian keyboard layout). */
export function parseCoordinate(value: string | null | undefined): number | null {
  const raw = normalizeDigits(String(value ?? '')).trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Neshan smart link: with an origin it opens a full drive route inside the
 * Neshan app (or neshan.org on the web); without one it opens the store's
 * location so routing starts from the visitor's current position. */
export function neshanRouteUrl(
  lat: number,
  lng: number,
  origin?: { lat: number; lng: number } | null,
): string {
  const destination = `${lat},${lng}`;
  if (origin) {
    return `https://nshn.ir/maps?origin=${origin.lat},${origin.lng}&destination=${destination}&type=drive`;
  }
  return `https://nshn.ir/?lat=${lat}&lng=${lng}`;
}

/** Balad driving directions to the store. The operator-confirmed link format:
 * destination takes lng,lat (Balad's order) and the fragment centers the map
 * at zoom/lat/lng. Opens Balad's web directions in the browser and is picked
 * up by the Balad app when installed; the app sets the origin automatically.
 * Coordinates come from the admin settings (navLat/navLng). */
export function baladDirectionsUrl(lat: number, lng: number): string {
  return `https://balad.ir/directions/driving?destination=${encodeURIComponent(
    `${lng},${lat}`,
  )}#15/${lat}/${lng}`;
}

/** Standard Android geo: intent — opens a chooser listing every installed map
 * app (Balad, Neshan, …); each app then routes from the current position. */
export function geoIntentUrl(lat: number, lng: number, label?: string): string {
  if (!label) return `geo:${lat},${lng}`;
  return `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`;
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

/** Canonical offline operation contract shared by Android, web and API.
 * operationId is generated by the client and must remain stable across retries. */
export const SYNC_OPERATION_TYPES = [
  'inventory.receive', 'inventory.adjust', 'inventory.transfer', 'product.create',
  'product.update', 'invoice.create', 'invoice.pay', 'purchase.create', 'purchase.pay',
] as const;
export type SyncOperationType = (typeof SYNC_OPERATION_TYPES)[number];
export type SyncOperationStatus = 'pending' | 'applied' | 'conflict' | 'failed';
export interface SyncOperationEnvelope<TPayload = Record<string, unknown>> {
  operationId: string; deviceId: string; type: SyncOperationType; payload: TPayload;
}
export interface InventoryReceivePayload { itemId: string; quantity: number; reason?: string }
export interface InventoryAdjustPayload extends InventoryReceivePayload {}
export interface InventoryTransferPayload { itemId: string; locationId: string }
export interface InvoiceCreatePayload { items: Array<Record<string, unknown>>; [key: string]: unknown }
export interface InvoicePayPayload { invoiceId: string; amount: string; method: 'cash' | 'card' | 'transfer' | 'credit'; checks?: Array<Record<string, unknown>> }
export interface PurchaseCreatePayload { supplierId: string; lines: Array<Record<string, unknown>>; paidAmount?: string }
export interface PurchasePayPayload { invoiceId: string; amount: string; method: 'cash' | 'card' | 'transfer' | 'credit'; notes?: string; check?: Record<string, unknown> }
const operationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/;
const deviceIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,99}$/;
/** Validates an operation before it enters a mobile local queue. */
export function validateSyncOperationEnvelope(input: unknown):
  | { ok: true; value: SyncOperationEnvelope }
  | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'operation must be an object' };
  const value = input as Record<string, unknown>;
  if (typeof value.operationId !== 'string' || !operationIdPattern.test(value.operationId)) return { ok: false, error: 'operationId must be 8-100 safe characters' };
  if (typeof value.deviceId !== 'string' || !deviceIdPattern.test(value.deviceId)) return { ok: false, error: 'deviceId is invalid' };
  if (typeof value.type !== 'string' || !(SYNC_OPERATION_TYPES as readonly string[]).includes(value.type)) return { ok: false, error: 'operation type is unsupported' };
  if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) return { ok: false, error: 'payload must be an object' };
  return { ok: true, value: value as unknown as SyncOperationEnvelope };
}
