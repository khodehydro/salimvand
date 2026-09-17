import type { Prisma } from '@prisma/client';

/** Who triggered a sale-price change — used for the history rows' `source`. */
export type PriceChangeSource = 'panel' | 'android' | 'bulk';

/** Records one sale-price change row inside the caller's transaction.
 *
 * No-op safe: a change that keeps the same number never writes a row, and a
 * brand-new line only gets an opening entry when its price is actually set
 * (a zero "no price yet" would only pollute the timeline). The Prisma
 * delegate is probed defensively so unit tests with partial mocks (and any
 * Prisma-less context) simply skip the write instead of crashing. */
export async function recordSalePriceChange(
  tx: Prisma.TransactionClient | Prisma.TransactionClient['inventoryItem'],
  input: {
    itemId: string;
    oldSalePrice?: bigint | null;
    newSalePrice: bigint;
    userId?: string;
    source: PriceChangeSource;
    operationId?: string;
  },
): Promise<void> {
  if (input.oldSalePrice != null && input.oldSalePrice === input.newSalePrice) return;
  if (input.oldSalePrice == null && input.newSalePrice === 0n) return;
  const delegate = (
    tx as unknown as {
      inventoryPriceHistory?: { create?: (args: unknown) => Promise<unknown> };
    }
  ).inventoryPriceHistory;
  if (!delegate?.create) return;
  await delegate.create({
    data: {
      itemId: input.itemId,
      oldSalePrice: input.oldSalePrice ?? null,
      newSalePrice: input.newSalePrice,
      userId: input.userId ?? null,
      source: input.source,
      operationId: input.operationId ?? null,
    },
  });
}
