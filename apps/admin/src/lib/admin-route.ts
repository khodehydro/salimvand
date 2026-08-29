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

export function hashForPage(page: AdminPage): string {
  return `#/${page}`;
}
