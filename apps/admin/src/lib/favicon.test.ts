import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyStoreFavicon } from './favicon';

/** The panel tab icon follows the operator-configured store favicon. The
 * storefront bakes it into SSR metadata; the panel is a SPA, so the helper
 * fetches the public /public/meta payload and rewrites <link rel="icon"> —
 * with no token required (login screen) and relative /uploads paths kept
 * same-origin, exactly like production Nginx serves them. */
type FakeLink = { rel: string; href: string };

const storage = new Map<string, string>();
let appended: FakeLink[];
let existing: FakeLink | null;

const metaResponse = (profile: Record<string, unknown>) =>
  new Response(JSON.stringify({ ok: true, data: { profile } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  storage.clear();
  appended = [];
  existing = null;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('document', {
    head: { appendChild: (node: FakeLink) => void appended.push(node) },
    createElement: (): FakeLink => ({ rel: '', href: '' }),
    querySelector: (): FakeLink | null => existing,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('applyStoreFavicon (panel tab icon)', () => {
  it('creates the icon link from the configured favicon upload path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(metaResponse({ faviconUrl: '/uploads/site/favicon-1.webp' })),
    );
    await applyStoreFavicon();
    expect(appended).toHaveLength(1);
    expect(appended[0].rel).toBe('icon');
    expect(appended[0].href).toBe('/uploads/site/favicon-1.webp');
  });

  it('keeps absolute favicon URLs untouched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(metaResponse({ faviconUrl: 'https://cdn.example.com/icon.png' })),
    );
    await applyStoreFavicon();
    expect(appended[0].href).toBe('https://cdn.example.com/icon.png');
  });

  it('reuses the existing icon link instead of adding a second one', async () => {
    existing = { rel: 'icon', href: '/uploads/site/old.webp' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(metaResponse({ faviconUrl: '/uploads/site/new.webp' })),
    );
    await applyStoreFavicon();
    expect(appended).toHaveLength(0);
    expect(existing.href).toBe('/uploads/site/new.webp');
  });

  it('leaves the tab icon alone when no favicon is configured', async () => {
    existing = { rel: 'icon', href: '/uploads/site/old.webp' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(metaResponse({})));
    await applyStoreFavicon();
    expect(appended).toHaveLength(0);
    expect(existing.href).toBe('/uploads/site/old.webp');
  });

  it('never fails panel startup when the meta endpoint is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(applyStoreFavicon()).resolves.toBeUndefined();
    expect(appended).toHaveLength(0);
  });
});
