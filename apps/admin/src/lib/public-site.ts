/**
 * Absolute origin of the public storefront (https://salimvand.ir).
 *
 * The panel itself is served from a different host (cms.salimvand.ir), so
 * links that are handed to customers — invoice short links, QR codes, debt
 * reminders — must NEVER fall back to the panel's own origin: a customer
 * opening cms.salimvand.ir/i/<code> would land on the admin SPA (or a login
 * wall), not on their invoice.
 *
 * Resolution order:
 *  1. VITE_PUBLIC_SITE_URL baked in at build time (deploy.sh exports it from
 *     the server's PUBLIC_SITE_URL .env value).
 *  2. On a cms.<domain> host, strip the subdomain → https://<domain>.
 *  3. Anything else (local dev) → the current origin, where the website and
 *     panel are both served from localhost.
 */
function resolvePublicSiteUrl(): string {
  const fromEnv = import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined;
  if (fromEnv?.trim()) return fromEnv.trim().replace(/\/$/, '');
  const { protocol, hostname, port, origin } = window.location;
  if (hostname.startsWith('cms.')) {
    return `${protocol}//${hostname.slice('cms.'.length)}${port ? `:${port}` : ''}`;
  }
  return origin;
}

export const publicSiteUrl = resolvePublicSiteUrl();
