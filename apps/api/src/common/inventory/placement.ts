import { BadRequestException } from '@nestjs/common';

/**
 * Placement rules shared by every write path (panel, Android sync, product
 * create/update). The tree is exactly three levels deep:
 *
 *   انبار (warehouse) › قفسه (shelf) › سبد (basket)
 *
 * A stock line always owns its shelf (InventoryItem.locationId) and may own
 * one basket of that shelf (InventoryItem.basketId). The basket is never a
 * free-text field: it is a real Location of type `basket`, so it shows up in
 * the panel, in shelf/basket labels and in the Android bootstrap payload.
 */

/** Minimal client shape (PrismaClient and TransactionClient both satisfy it). */
type PlacementClient = {
  location: {
    findUnique(args: {
      where: { id: string };
    }): Promise<{ id: string; type: string; parentId: string | null } | null>;
  };
};

export type PlacementInput = {
  locationId?: string | null;
  basketId?: string | null;
};

export type PlacementState = {
  locationId: string | null;
  basketId: string | null;
};

export type ResolvedPlacement = PlacementState & {
  /** True when at least one of the two pointers actually moves. */
  changed: boolean;
};

/** `basket` locations are bins; everything non-warehouse behaves as a shelf. */
export const isBasketType = (type: string) => type === 'basket';
export const isWarehouseType = (type: string) => type === 'warehouse';

/**
 * Validates and normalizes shelf + basket pointers.
 *
 * - a basket must exist, be of type `basket` and sit inside a shelf;
 * - it must belong to the line's shelf (an explicit shelf that does not own
 *   the basket is a 400, not a silent mismatch);
 * - picking a basket without a shelf fills the shelf in from the basket, so
 *   «هر کالا قفسه و سبد خودش را دارد» holds even when only one was sent.
 */
export async function resolvePlacement(
  tx: PlacementClient,
  input: PlacementInput,
  current: PlacementState = { locationId: null, basketId: null },
): Promise<ResolvedPlacement> {
  let locationId = input.locationId !== undefined ? input.locationId : current.locationId;
  let basketId = input.basketId !== undefined ? input.basketId : current.basketId;
  if (basketId === '') basketId = null;
  if (locationId === '') locationId = null;
  // «بدون قفسه» clears the whole address: a basket without its shelf is not
  // somewhere a picker can walk to.
  if (input.locationId === null) basketId = null;

  if (basketId) {
    const basket = await tx.location.findUnique({ where: { id: basketId } });
    if (!basket) throw new BadRequestException('سبد انتخاب‌شده پیدا نشد');
    if (!isBasketType(basket.type))
      throw new BadRequestException('محل انتخاب‌شده برای سبد معتبر نیست — فقط سبدهای داخل قفسه قابل انتخاب است');
    // A basket always lives inside a shelf; that shelf is the line's shelf.
    if (locationId && locationId !== basket.parentId)
      throw new BadRequestException('سبد انتخاب‌شده متعلق به این قفسه نیست');
    locationId = basket.parentId ?? locationId;
  }

  const changed = locationId !== current.locationId || basketId !== current.basketId;
  return { locationId, basketId, changed };
}

/** Reads the current placement of a stock line (used before applying an edit). */
export async function readPlacement(
  tx: PlacementClient & {
    inventoryItem: {
      findUnique(args: {
        where: { id: string };
      }): Promise<{ locationId: string | null; basketId: string | null } | null>;
    };
  },
  itemId: string,
): Promise<PlacementState> {
  const item = await tx.inventoryItem.findUnique({ where: { id: itemId } });
  return { locationId: item?.locationId ?? null, basketId: item?.basketId ?? null };
}
