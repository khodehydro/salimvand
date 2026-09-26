/** Placement labels: locations are a three-level tree — an «انبار» (warehouse)
 * holds «قفسه» shelves, each shelf may hold «سبد» baskets, and inventory items
 * always show their full address «انبار · قفسه · سبد». */

export type LocationLike = {
  code: string;
  name: string;
  parent?: { name: string } | null;
};

export type BasketLike = {
  code: string;
  name?: string;
};

/** Full label for selects and detail sheets: «انبار اصلی · A-03 — قفسه جلو». */
export function locationLabel(location: LocationLike): string {
  return location.parent
    ? `${location.parent.name} · ${location.code} — ${location.name}`
    : `${location.code} — ${location.name}`;
}

/** Compact chip for tight rows (stock lists): «انبار اصلی · A-03». */
export function locationChip(location: LocationLike): string {
  return location.parent ? `${location.parent.name} · ${location.code}` : location.code;
}

/** «سبد ۲» — the basket half of an item's address. */
export function basketLabel(basket: BasketLike): string {
  const name = (basket.name ?? '').trim();
  if (!name) return `سبد ${basket.code}`;
  // Most bins are named after their own number («سبد ۲» with code «۲» or
  // «2») — printing «سبد ۲ — سبد ۲» would just repeat it, so the name alone
  // wins when the digits match (Persian and ASCII digits compared equal).
  const digits = (value: string) =>
    value.replace(/[۰-۹٠-٩]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(d) % 10));
  const normalized = digits(name);
  if (normalized === digits(basket.code) || normalized === digits(`سبد ${basket.code}`))
    return name;
  return `سبد ${basket.code} — ${name}`;
}

/** The full address of a stock line: «انبار اصلی · A-03 — قفسه جلو · سبد ۲». */
export function placementLabel(item: {
  location?: LocationLike | null;
  basket?: BasketLike | null;
}): string {
  const parts: string[] = [];
  if (item.location) parts.push(locationLabel(item.location));
  if (item.basket) parts.push(basketLabel(item.basket));
  return parts.join(' · ');
}

/** Compact address for dense rows: «انبار اصلی · A-03 · سبد ۲». */
export function placementChip(item: {
  location?: LocationLike | null;
  basket?: BasketLike | null;
}): string {
  const parts: string[] = [];
  if (item.location) parts.push(locationChip(item.location));
  if (item.basket) parts.push(basketLabel(item.basket));
  return parts.join(' · ');
}
