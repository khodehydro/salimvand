import { afterEach, describe, expect, it, vi } from 'vitest';

/** The storefront origin baked into customer-facing links (invoice short
 * links, QR codes). The panel itself lives on cms.<domain>, so the links must
 * never fall back to the panel origin — that is exactly the bug where
 * customers got cms.salimvand.ir/i/<code> and hit a login wall. */
const loadPublicSiteUrl = async () => {
  vi.resetModules();
  const module = await import('./public-site');
  return module.publicSiteUrl;
};

const stubPanelHost = (hostname: string, origin: string) =>
  vi.stubGlobal('window', { location: { protocol: 'https:', hostname, port: '', origin } });

afterEach(() => {
  vi.unstubAllGlobals();
  delete (import.meta.env as Record<string, unknown>).VITE_PUBLIC_SITE_URL;
});

describe('public storefront URL used in customer links', () => {
  it('prefers VITE_PUBLIC_SITE_URL from the build environment', async () => {
    (import.meta.env as Record<string, unknown>).VITE_PUBLIC_SITE_URL = 'https://salimvand.ir/';
    stubPanelHost('cms.salimvand.ir', 'https://cms.salimvand.ir');
    expect(await loadPublicSiteUrl()).toBe('https://salimvand.ir');
  });

  it('strips the cms subdomain when no env value is baked in', async () => {
    stubPanelHost('cms.salimvand.ir', 'https://cms.salimvand.ir');
    expect(await loadPublicSiteUrl()).toBe('https://salimvand.ir');
  });

  it('keeps localhost origins for local development', async () => {
    stubPanelHost('localhost', 'http://localhost:5173');
    expect(await loadPublicSiteUrl()).toBe('http://localhost:5173');
  });
});
