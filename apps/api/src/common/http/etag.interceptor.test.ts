import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { EtagInterceptor } from './etag.interceptor';

function harness(ifNoneMatch?: string) {
  const headers: Record<string, string> = {};
  const response = {
    setHeader: vi.fn((key: string, value: string) => {
      headers[key] = value;
    }),
    status: vi.fn(),
  };
  const context = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({
        headers: ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {},
      }),
    }),
  };
  return { headers, response, context };
}

function run(context: unknown, body: unknown) {
  let emitted: unknown;
  new EtagInterceptor()
    .intercept(context as never, { handle: () => of(body) })
    .subscribe({ next: (value) => (emitted = value) });
  return emitted;
}

describe('EtagInterceptor', () => {
  it('stamps the payload hash as ETag and tells clients to revalidate', () => {
    const { headers, context } = harness();
    run(context, { ok: true, data: [{ id: 'c1' }] });
    expect(headers['ETag']).toMatch(/^"[0-9a-f]{40}"$/);
    expect(headers['Cache-Control']).toBe('no-cache');
  });

  it('answers a matching If-None-Match with 304 and an empty body', () => {
    const first = harness();
    run(first.context, { data: 1 });
    const second = harness(first.headers['ETag']);
    const emitted = run(second.context, { data: 1 });
    expect(second.response.status).toHaveBeenCalledWith(304);
    expect(emitted).toBe('');
  });

  it('still returns the body when If-None-Match does not match (stale tag)', () => {
    const stale = harness('"stale-tag"');
    const emitted = run(stale.context, { data: 2 });
    expect(stale.response.status).not.toHaveBeenCalled();
    expect(emitted).toEqual({ data: 2 });
  });

  it('hashes bigint-safe JSON so the same numbers produce the same tag', () => {
    const first = harness();
    run(first.context, { quantity: 5n });
    const second = harness(first.headers['ETag']);
    run(second.context, { quantity: 5n });
    expect(second.response.status).toHaveBeenCalledWith(304);
  });
});
