export const pageIds = [
  'dashboard',
  'products',
  'inventory',
  'invoices',
  'media',
  'references',
  'reports',
  'settings',
  'users',
  'audit',
  'messaging',
  'customers',
  'suppliers',
  'purchases',
] as const;
export type AdminPage = (typeof pageIds)[number];

const pages = new Set<string>(pageIds);

export function pageFromHash(hash: string): AdminPage {
  const candidate = hash.replace(/^#\/?/, '').split(/[?&]/, 1)[0];
  return pages.has(candidate) ? (candidate as AdminPage) : 'dashboard';
}

export function hashForPage(page: AdminPage, params?: Record<string, string>): string {
  const query = params
    ? Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&')
    : '';
  return `#/${page}${query ? `?${query}` : ''}`;
}

/**
 * Reads the query params of the current hash route (e.g. `#/products?edit=42`
 * returns `{ edit: '42' }`) so pages can react to deep links from the global
 * palette and from other pages.
 */
export function paramsFromHash(hash: string): Record<string, string> {
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return {};
  const result: Record<string, string> = {};
  for (const part of hash.slice(queryIndex + 1).split('&')) {
    if (!part) continue;
    const [rawKey, ...rest] = part.split('=');
    const key = decodeURIComponent(rawKey ?? '');
    if (!key) continue;
    result[key] = decodeURIComponent(rest.join('='));
  }
  return result;
}
