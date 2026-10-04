import { describe, expect, it, vi } from 'vitest';
import { PublicAnalyticsController } from './analytics.controller';
import type { AnalyticsService } from './analytics.service';

describe('PublicAnalyticsController.track', () => {
  const makeService = () => ({ record: vi.fn(async () => undefined) }) as unknown as AnalyticsService;

  it('records the storefront convention: path as query param with an empty body', async () => {
    const service = makeService();
    const controller = new PublicAnalyticsController(service);
    const result = await controller.track('/category/brakes', {});
    expect(result).toEqual({ ok: true, data: { recorded: true } });
    expect(service.record).toHaveBeenCalledWith({
      kind: 'page',
      path: '/category/brakes',
      term: null,
      productId: null,
    });
  });

  it('still accepts the JSON body convention', async () => {
    const service = makeService();
    const controller = new PublicAnalyticsController(service);
    await controller.track(undefined, { path: '/product/x', kind: 'product', productId: 'p1' });
    expect(service.record).toHaveBeenCalledWith({
      kind: 'product',
      path: '/product/x',
      term: null,
      productId: 'p1',
    });
  });

  it('refuses to record when no path arrives at all', async () => {
    const service = makeService();
    const controller = new PublicAnalyticsController(service);
    const result = await controller.track(undefined, {});
    expect(result).toEqual({ ok: true, data: { recorded: false } });
    expect(service.record).not.toHaveBeenCalled();
  });
});
