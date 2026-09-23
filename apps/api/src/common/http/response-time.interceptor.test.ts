import { describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { ResponseTimeInterceptor } from './response-time.interceptor';

function harness() {
  const headers: Record<string, string> = {};
  const response = {
    headersSent: false,
    setHeader: vi.fn((key: string, value: string) => {
      headers[key] = value;
    }),
  };
  const request = { method: 'POST', originalUrl: '/api/v1/sync/operations' };
  const context = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  };
  return { headers, response, request, context };
}

describe('ResponseTimeInterceptor', () => {
  it('sets an X-Response-Time header on successful responses', async () => {
    const { headers, context } = harness();
    await new Promise<void>((resolve) =>
      new ResponseTimeInterceptor()
        .intercept(context as never, { handle: () => of({ ok: true }) })
        .subscribe({ next: () => resolve() }),
    );
    expect(headers['X-Response-Time']).toMatch(/^\d+(\.\d+)?ms$/);
  });

  it('sets the header on the error path too (before the exception filter answers)', async () => {
    const { headers, context } = harness();
    await new Promise<void>((resolve) =>
      new ResponseTimeInterceptor()
        .intercept(context as never, { handle: () => throwError(() => new Error('boom')) })
        .subscribe({ error: () => resolve() }),
    );
    expect(headers['X-Response-Time']).toMatch(/^\d+(\.\d+)?ms$/);
  });

  it('warns once, naming the route, when handling exceeds the slow threshold', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hrtime = vi.spyOn(process.hrtime, 'bigint');
    // start = 0ns, end = 350ms
    hrtime.mockReturnValueOnce(0n).mockReturnValueOnce(350_000_000n);
    const { headers, context } = harness();
    await new Promise<void>((resolve) =>
      new ResponseTimeInterceptor()
        .intercept(context as never, { handle: () => of({ ok: true }) })
        .subscribe({ next: () => resolve() }),
    );
    expect(headers['X-Response-Time']).toBe('350.0ms');
    expect(warn).toHaveBeenCalledWith('[slow] POST /api/v1/sync/operations took 350.0ms');
    hrtime.mockRestore();
    warn.mockRestore();
  });

  it('never touches an already-sent response', async () => {
    const { response, context } = harness();
    response.headersSent = true;
    await new Promise<void>((resolve) =>
      new ResponseTimeInterceptor()
        .intercept(context as never, { handle: () => of({ ok: true }) })
        .subscribe({ next: () => resolve() }),
    );
    expect(response.setHeader).not.toHaveBeenCalled();
  });
});
