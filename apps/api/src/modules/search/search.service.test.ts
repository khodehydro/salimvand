import { describe, expect, it, vi } from 'vitest';
import { SearchService } from './search.service';

describe('SearchService', () => {
  it('returns empty grouped results for blank queries', async () => {
    const service = new SearchService({} as never);
    await expect(service.all('   ')).resolves.toEqual({
      ok: true,
      data: { products: [], customers: [], invoices: [], brands: [], locations: [] },
    });
  });

  it('rejects unreasonably long queries before database access', async () => {
    const prisma = { product: { findMany: vi.fn() } };
    await expect(new SearchService(prisma as never).all('x'.repeat(101))).rejects.toThrow(
      'عبارت جست‌وجو بیش از حد مجاز است',
    );
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});
