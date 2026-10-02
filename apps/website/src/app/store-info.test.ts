import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStoreInfo } from './store-info';

/** Stub the /public/meta fetch for every test in this file. */
function stubMeta(profile: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, data: { profile } }), { status: 200 }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getStoreInfo SEO fields', () => {
  it('uses operator-configured seo title/description from the panel', async () => {
    stubMeta({
      name: 'فروشگاه سلیم وند',
      seo: { title: 'عنوان دلخواه من', description: 'توضیح دلخواه برای گوگل' },
    });
    const info = await getStoreInfo();
    expect(info.seo.title).toBe('عنوان دلخواه من');
    expect(info.seo.description).toBe('توضیح دلخواه برای گوگل');
  });

  it('falls back to defaults when seo values are empty or missing', async () => {
    stubMeta({ name: 'فروشگاه سلیم وند', seo: { title: '  ' } });
    const info = await getStoreInfo();
    expect(info.seo.title).toBe('قطعات یدکی خودرو');
    expect(info.seo.description).toContain('کاتالوگ قطعات یدکی خودرو');
  });
});
