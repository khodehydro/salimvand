export const STORE_SLIDER_LIMIT = 10;
export type StoreSlide = { path: string; alt: string };
export type StoreSliderSettings = { slides: StoreSlide[] };

/** Only locally uploaded, decoded/re-encoded slider assets may be published. */
export function parseStoreSlider(value: unknown): StoreSliderSettings | null {
  if (!value || typeof value !== 'object') return null;
  const slides = (value as Record<string, unknown>).slides;
  if (!Array.isArray(slides) || slides.length > STORE_SLIDER_LIMIT) return null;
  const seen = new Set<string>();
  const result: StoreSlide[] = [];
  for (const item of slides) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.path !== 'string' ||
      !/^\/uploads\/site\/slide-[a-f0-9]{8}\.webp$/.test(item.path) ||
      typeof item.alt !== 'string' ||
      item.alt.length > 160 ||
      seen.has(item.path)
    )
      return null;
    seen.add(item.path);
    result.push({ path: item.path, alt: item.alt.trim() });
  }
  return { slides: result };
}
