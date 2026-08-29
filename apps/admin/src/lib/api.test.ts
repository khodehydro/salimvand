import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, resolveApiUrl } from './api';

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
