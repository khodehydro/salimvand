import { api } from './api';

/**
 * Applies the operator-configured store favicon (تنظیمات → پروفایل فروشگاه →
 * آیکون سایت) to the panel browser tab. The storefront reads the same value
 * server-side from /public/meta; the panel is a client-side SPA, so it fetches
 * that public endpoint once on startup and points <link rel="icon"> at the
 * saved file. /public/meta needs no token, so the icon also appears on the
 * login screen, and relative /uploads/... paths work because Nginx (and the
 * Vite dev proxy) serve /uploads on the panel origin too. Absolute URLs pass
 * through unchanged. Failures are swallowed: the tab icon is cosmetic and must
 * never break panel startup.
 */
export async function applyStoreFavicon(): Promise<void> {
  try {
    const result = await api<{ data?: { profile?: { faviconUrl?: unknown } } }>('/public/meta');
    const raw = result.data?.profile?.faviconUrl;
    const faviconUrl = typeof raw === 'string' ? raw.trim() : '';
    if (!faviconUrl) return;
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = faviconUrl;
  } catch {
    // Cosmetic only — network/API errors must not surface in the panel.
  }
}
