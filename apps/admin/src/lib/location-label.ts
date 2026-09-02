/** Placement labels: locations are a two-level tree — an «انبار» (warehouse
 * group) holds «قفسه» shelves, and inventory items always show both. */

export type LocationLike = {
  code: string;
  name: string;
  parent?: { name: string } | null;
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
