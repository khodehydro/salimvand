/** Shared site config used by server components and metadata. */
export const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir').replace(
  /\/$/,
  '',
);

export const API_URL = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';
