import { after } from 'next/server';
import { API_URL } from './config';

/**
 * Fire-and-forget page-visit tracking for the storefront. Runs after the
 * response is streamed (next/server `after`), POSTs nothing but the page
 * path to the public analytics endpoint, and can never break a render.
 * Product views and search terms are recorded API-side by the catalog
 * endpoints; this only counts generic page visits.
 */
export function trackVisit(path: string): void {
  try {
    const url = `${API_URL}/public/analytics/track?path=${encodeURIComponent(path)}`;
    after(async () => {
      try {
        await fetch(url, { method: 'POST', keepalive: true });
      } catch {
        // Analytics is best-effort.
      }
    });
  } catch {
    // Analytics is best-effort.
  }
}
