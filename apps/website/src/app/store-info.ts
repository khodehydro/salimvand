import {
  extractAparatVideoId,
  extractMapEmbedUrl,
  formatPersianNumber,
  normalizeDigits,
  parseCoordinate,
} from '@salimvand/shared';

/**
 * Shared, server-side storefront meta. Every SEO/landing page reads the same
 * /public/meta payload and renders the same contact/footer so that the phone
 * numbers and social IDs set in the admin panel actually appear on the site.
 */
export type StoreInfo = {
  name: string;
  phones: string[];
  address: string;
  open: string;
  close: string;
  workingHours: string;
  shippingMethods: string[];
  mapUrl: string;
  mapCode: string;
  logoUrl: string;
  faviconUrl: string;
  /** Store coordinates for the mobile navigation button (Neshan / Balad). */
  nav: {
    lat: number | null;
    lng: number | null;
    app: 'neshan' | 'balad' | 'both';
  };
  /** Operator-editable header texts (logo tagline, CTA label, nav labels). */
  header: {
    tagline: string;
    cta: string;
    navCatalog: string;
    navVideo: string;
    navContact: string;
  };
  telegram: string;
  bale: string;
  instagram: string;
  trustVideo: string | null;
};

/** Shown when the operator has not configured a map embed yet. */
export const DEFAULT_MAP_EMBED_URL =
  'https://www.openstreetmap.org/export/embed.html?bbox=46.06%2C36.94%2C46.16%2C37.00&layer=mapnik&marker=36.9692%2C46.1027';

export async function getStoreInfo(): Promise<StoreInfo> {
  const apiUrl = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';
  const fallback: StoreInfo = {
    name: 'فروشگاه سلیم وند',
    phones: [],
    address: 'میاندوآب، آذربایجان غربی',
    open: '09:00',
    close: '20:00',
    workingHours: 'شنبه تا پنجشنبه · ۹ تا ۲۰',
    mapUrl: process.env.MAP_EMBED_URL ?? DEFAULT_MAP_EMBED_URL,
    mapCode: '',
    logoUrl: '',
    faviconUrl: '',
    nav: { lat: null, lng: null, app: 'both' },
    shippingMethods: ['باربری و پست پیشتاز'],
    header: {
      tagline: 'قطعات یدکی خودرو',
      cta: 'تماس سریع',
      navCatalog: 'کاتالوگ',
      navVideo: 'ویدئوی فروشگاه',
      navContact: 'تماس',
    },
    telegram: 'https://t.me/',
    bale: 'https://ble.ir/',
    instagram: 'https://instagram.com/',
    trustVideo: null,
  };
  try {
    const response = await fetch(`${apiUrl}/public/meta`, { next: { revalidate: 60 } });
    if (!response.ok) return fallback;
    const body = (await response.json()) as {
      data?: {
        profile?: Record<string, unknown>;
        trustVideo?: string | null;
        telegram?: Record<string, unknown>;
        bale?: Record<string, unknown>;
      };
    };
    const data = body.data ?? {};
    const profile = data.profile ?? {};
    const rawPhones = asString(profile.phones ?? '');
    const phones = rawPhones
      .split(/[،,;]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const open = asString(profile.open ?? '');
    const close = asString(profile.close ?? '');
    const telegramLink = asString((data.telegram ?? {}).link ?? '');
    const baleLink = asString((data.bale ?? {}).link ?? '');
    const instagram = asString(profile.instagram ?? '');
    const mapUrl = asString(profile.mapUrl ?? '');
    const mapCode = asString(profile.mapCode ?? '');
    // Coordinates are parsed first: when the operator picks the automatic
    // map (or pastes nothing embeddable) the site still shows a real map
    // centered on the store instead of the hardcoded default.
    const navLat = parseCoordinate(asString(profile.navLat ?? ''));
    const navLng = parseCoordinate(asString(profile.navLng ?? ''));
    const coordMapUrl = osmEmbedUrl(navLat, navLng);
    const pastedMapUrl = extractMapEmbedUrl(mapUrl, mapCode);
    const mapMode = asString(profile.mapSource ?? '') === 'coords' ? 'coords' : 'embed';
    const resolvedMapUrl =
      (mapMode === 'coords' && coordMapUrl) || pastedMapUrl || coordMapUrl || fallback.mapUrl;
    const rawShipping = asString(profile.shippingMethods ?? '');
    const shippingMethods = rawShipping
      .split(/[،,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const rawHeader = (profile.header ?? {}) as Record<string, unknown>;
    const headerText = (key: keyof StoreInfo['header'], fallbackValue: string) =>
      asString(rawHeader[key] ?? '').trim() || fallbackValue;
    return {
      name: asString(profile.name ?? '') || fallback.name,
      phones,
      address: asString(profile.address ?? '') || fallback.address,
      open,
      close,
      workingHours:
        open && close
          ? `${formatPersianNumber(open)} تا ${formatPersianNumber(close)} · شنبه تا پنجشنبه`
          : fallback.workingHours,
      shippingMethods: shippingMethods.length ? shippingMethods : fallback.shippingMethods,
      mapUrl: resolvedMapUrl,
      mapCode: mapCode && !pastedMapUrl ? mapCode : '',
      logoUrl: asString(profile.logoUrl ?? ''),
      faviconUrl: asString(profile.faviconUrl ?? ''),
      nav: {
        lat: navLat,
        lng: navLng,
        app:
          asString(profile.navApp ?? '') === 'neshan' || asString(profile.navApp ?? '') === 'balad'
            ? (asString(profile.navApp) as 'neshan' | 'balad')
            : 'both',
      },
      header: {
        tagline: headerText('tagline', fallback.header.tagline),
        cta: headerText('cta', fallback.header.cta),
        navCatalog: headerText('navCatalog', fallback.header.navCatalog),
        navVideo: headerText('navVideo', fallback.header.navVideo),
        navContact: headerText('navContact', fallback.header.navContact),
      },
      telegram: telegramLink || fallback.telegram,
      bale: baleLink || fallback.bale,
      instagram: instagram || fallback.instagram,
      // Operators paste either the bare hash or a full Aparat link — accept both.
      trustVideo: extractAparatVideoId(asString(data.trustVideo ?? '')) || null,
    };
  } catch {
    return fallback;
  }
}

export function primaryPhone(info: StoreInfo): string {
  return info.phones[0] ?? '';
}

export function telHref(info: StoreInfo): string {
  // Operators type phone numbers with a Persian keyboard, so normalize the
  // digits before building the dial link — otherwise every character would be
  // stripped and the "quick call" buttons would go nowhere.
  const phone = normalizeDigits(primaryPhone(info)).replace(/[^0-9+]/g, '');
  return phone ? `tel:${phone}` : '#contact';
}

/** OpenStreetMap embed centered on the store coordinates. Unlike Google
 * embeds it renders for every visitor, so it backs the automatic map mode. */
function osmEmbedUrl(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return '';
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.012}%2C${lat - 0.008}%2C${lng + 0.012}%2C${lat + 0.008}&layer=mapnik&marker=${lat}%2C${lng}`;
}

export function fullMapUrl(mapUrl: string, mapCode?: string): string {
  // Accepts whatever the operator pasted (full iframe tag, embed URL or a
  // bare pb code) and falls back to the default map when nothing embeds.
  return extractMapEmbedUrl(mapUrl, mapCode) || DEFAULT_MAP_EMBED_URL;
}

function asString(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(asString).join('، ');
  return String(value);
}
