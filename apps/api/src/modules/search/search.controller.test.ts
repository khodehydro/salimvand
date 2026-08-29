import { describe, expect, it, vi } from 'vitest';
import { SearchController } from './search.controller';

describe('SearchController', () => {
  it('uses an empty default query and forwards supplied queries', async () => {
    const all = vi.fn(async (query: string) => ({ ok: true, data: { query } }));
    const controller = new SearchController({ all } as never);
    await expect(controller.all()).resolves.toEqual({ ok: true, data: { query: '' } });
    await expect(controller.all('لنت')).resolves.toEqual({ ok: true, data: { query: 'لنت' } });
    expect(all).toHaveBeenNthCalledWith(1, '');
    expect(all).toHaveBeenNthCalledWith(2, 'لنت');
  });
});
