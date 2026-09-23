import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, fetchAllPages, resolveApiUrl } from './api';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.restoreAllMocks();
});

describe('admin API client', () => {
  it('always uses the same-origin API path in production', () => {
    expect(resolveApiUrl('http://localhost:4000/api/v1', true)).toBe('/api/v1');
    expect(resolveApiUrl('https://api.example.com/api/v1', true)).toBe('/api/v1');
  });

  it('keeps an explicitly configured development API and strips trailing slashes', () => {
    expect(resolveApiUrl(' http://localhost:4000/api/v1/ ', false)).toBe(
      'http://localhost:4000/api/v1',
    );
    expect(resolveApiUrl(undefined, false)).toBe('/api/v1');
  });

  it('turns browser network failures into an actionable Persian message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api('/auth/login', { method: 'POST', body: '{}' })).rejects.toThrow(
      'ارتباط با سرور برقرار نشد',
    );
  });

  it('preserves API validation messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'نام کاربری یا رمز عبور نادرست است' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await expect(api('/auth/login', { method: 'POST', body: '{}' })).rejects.toThrow(
      'نام کاربری یا رمز عبور نادرست است',
    );
  });
});

describe('fetchAllPages (cursor-paginated lists)', () => {
  const page = (rows: unknown[], nextCursor: string | null) =>
    new Response(JSON.stringify({ ok: true, data: rows, nextCursor }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  it('drains the cursor chain and keeps any existing query params', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([{ id: 'a' }], 'cursor-1'))
      .mockResolvedValueOnce(page([{ id: 'b' }], null));
    vi.stubGlobal('fetch', fetchMock);
    const rows = await fetchAllPages<{ id: string }>('/inventory/items?q=لنت', { limit: 500 });
    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl, secondUrl] = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(firstUrl).toContain('/inventory/items?q=');
    expect(firstUrl).toContain('limit=500');
    expect(firstUrl).not.toContain('cursor=');
    expect(secondUrl).toContain('cursor=cursor-1');
  });

  it('stops at the page cap so a broken cursor loop cannot run forever', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => page([], 'same-cursor'));
    vi.stubGlobal('fetch', fetchMock);
    const rows = await fetchAllPages<{ id: string }>('/invoices', { maxPages: 3 });
    expect(rows).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
