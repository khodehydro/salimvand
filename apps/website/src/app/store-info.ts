import { PUBLIC_SITE_URL } from './config';

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
  mapUrl: string;
  mapCode: string;
  telegram: string;
  bale: string;
  instagram: string;
  trustVideo: string | null;
};

export async function getStoreInfo(): Promise<StoreInfo> {
  const apiUrl = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';
  const fallback: StoreInfo = {
    name: 'فروشگاه سلیم وند',
    phones: [],
    address: 'میاندوآب، آذربایجان غربی',
    open: '09:00',
    close: '20:00',
    workingHours: 'شنبه تا پنجشنبه · ۹ تا ۲۰',
    mapUrl:
      process.env.MAP_EMBED_URL ??
      'https://www.openstreetmap.org/export/embed.html?bbox=46.06%2C36.94%2C46.16%2C37.00&layer=mapnik&marker=36.9692%2C46.1027',
    mapCode: '',
    telegram: 'https://t.me/',
    bale: 'https://ble.ir/',
    instagram: 'https://instagram.com/',
    trustVideo: null,
  };
  try {
    const response = await fetch(`${apiUrl}/public/meta`, { next: { revalidate: 300 } });
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
    // When only a Google Maps code is provided, keep mapUrl empty so the
    // renderer expands the code into a full embed link (see fullMapUrl).
    const resolvedMapUrl = mapUrl || (mapCode ? '' : fallback.mapUrl);
    return {
      name: asString(profile.name ?? '') || fallback.name,
      phones,
      address: asString(profile.address ?? '') || fallback.address,
      open,
      close,
      workingHours: open && close ? `${open} تا ${close} · شنبه تا پنجشنبه` : fallback.workingHours,
      mapUrl: resolvedMapUrl,
      mapCode,
      telegram: telegramLink || fallback.telegram,
      bale: baleLink || fallback.bale,
      instagram: instagram || fallback.instagram,
      trustVideo: data.trustVideo ?? null,
    };
  } catch {
    return fallback;
  }
}

export function primaryPhone(info: StoreInfo): string {
  return info.phones[0] ?? '';
}

export function telHref(info: StoreInfo): string {
  const phone = primaryPhone(info).replace(/[^0-9+]/g, '');
  return phone ? `tel:${phone}` : '#contact';
}

export function fullMapUrl(mapUrl: string, mapCode?: string): string {
  if (mapUrl && /^https?:\/\//i.test(mapUrl)) return mapUrl;
  // A shortened Google Maps "code" (e.g. from the share iframe) is expanded
  // into a full embed link so the admin can paste just the code.
  if (mapCode?.trim()) {
    const q = encodeURIComponent(mapCode.trim());
    return `https://www.google.com/maps/embed?pb=${q}`;
  }
  return PUBLIC_SITE_URL + '/#contact';
}

function asString(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(asString).join('، ');
  return String(value);
}
