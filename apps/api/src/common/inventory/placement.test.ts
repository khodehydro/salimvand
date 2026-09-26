import { describe, expect, it } from 'vitest';
import { resolvePlacement } from './placement';

/** In-memory stand-in for the two Prisma calls the helper makes. */
const tree = [
  { id: 'wh-1', type: 'warehouse', parentId: null },
  { id: 'shelf-1', type: 'shelf', parentId: 'wh-1' },
  { id: 'shelf-2', type: 'shelf', parentId: 'wh-1' },
  { id: 'basket-1', type: 'basket', parentId: 'shelf-1' },
  { id: 'basket-2', type: 'basket', parentId: 'shelf-2' },
];

const client = {
  location: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      tree.find((row) => row.id === where.id) ?? null,
  },
};

describe('resolvePlacement (قفسه + سبد)', () => {
  it('keeps a shelf-only line as-is', async () => {
    await expect(
      resolvePlacement(client, { locationId: 'shelf-1' }, { locationId: null, basketId: null }),
    ).resolves.toEqual({ locationId: 'shelf-1', basketId: null, changed: true });
  });

  it('accepts a basket that belongs to the line shelf', async () => {
    await expect(
      resolvePlacement(
        client,
        { locationId: 'shelf-1', basketId: 'basket-1' },
        { locationId: 'shelf-1', basketId: null },
      ),
    ).resolves.toEqual({ locationId: 'shelf-1', basketId: 'basket-1', changed: true });
  });

  it('fills the shelf in from the basket when only the basket is sent', async () => {
    await expect(
      resolvePlacement(client, { basketId: 'basket-2' }, { locationId: null, basketId: null }),
    ).resolves.toEqual({ locationId: 'shelf-2', basketId: 'basket-2', changed: true });
  });

  it('rejects a basket of another shelf', async () => {
    await expect(
      resolvePlacement(
        client,
        { locationId: 'shelf-2', basketId: 'basket-1' },
        { locationId: 'shelf-1', basketId: null },
      ),
    ).rejects.toThrow('سبد انتخاب‌شده متعلق به این قفسه نیست');
  });

  it('rejects a shelf or an unknown id used as a basket', async () => {
    await expect(resolvePlacement(client, { basketId: 'shelf-1' })).rejects.toThrow(
      'محل انتخاب‌شده برای سبد معتبر نیست',
    );
    await expect(resolvePlacement(client, { basketId: 'basket-void' })).rejects.toThrow(
      'سبد انتخاب‌شده پیدا نشد',
    );
  });

  it('clearing the shelf clears the basket with it', async () => {
    await expect(
      resolvePlacement(
        client,
        { locationId: null },
        { locationId: 'shelf-1', basketId: 'basket-1' },
      ),
    ).resolves.toEqual({ locationId: null, basketId: null, changed: true });
  });

  it('clearing only the basket keeps the shelf', async () => {
    await expect(
      resolvePlacement(
        client,
        { basketId: null },
        { locationId: 'shelf-1', basketId: 'basket-1' },
      ),
    ).resolves.toEqual({ locationId: 'shelf-1', basketId: null, changed: true });
  });

  it('reports no change when the placement is untouched', async () => {
    await expect(
      resolvePlacement(
        client,
        { locationId: 'shelf-1' },
        { locationId: 'shelf-1', basketId: 'basket-1' },
      ),
    ).resolves.toEqual({ locationId: 'shelf-1', basketId: 'basket-1', changed: false });
  });

  it('treats an empty string as «no placement»', async () => {
    await expect(
      resolvePlacement(client, { locationId: '', basketId: '' }),
    ).resolves.toEqual({ locationId: null, basketId: null, changed: false });
  });
});
