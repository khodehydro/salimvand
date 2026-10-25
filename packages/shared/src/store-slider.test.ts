import { describe, expect, it } from 'vitest';
import { parseStoreSlider } from './store-slider';

const slide = { path: '/uploads/site/slide-ab12cd34.webp', alt: ' نمای فروشگاه ' };
describe('store slider settings', () => {
  it('accepts an empty gallery and preserves ordering with trimmed descriptions', () => {
    expect(parseStoreSlider({ slides: [] })).toEqual({ slides: [] });
    const second = { path: '/uploads/site/slide-1234abcd.webp', alt: '' };
    expect(parseStoreSlider({ slides: [second, slide] })).toEqual({
      slides: [second, { ...slide, alt: 'نمای فروشگاه' }],
    });
  });
  it.each([
    undefined,
    null,
    {},
    { slides: 'bad' },
    { slides: [null] },
    { slides: [{ ...slide, path: 'https://evil.example/slide.webp' }] },
    { slides: [{ ...slide, path: '/uploads/site/../secret.webp' }] },
    { slides: [{ ...slide, path: '/uploads/site/slide-ab12cd34.svg' }] },
    { slides: [{ ...slide, alt: 'a'.repeat(161) }] },
    { slides: [slide, slide] },
    { slides: Array(11).fill(slide) },
  ])('rejects malformed, unsafe or unbounded settings: %j', (value) => {
    expect(parseStoreSlider(value)).toBeNull();
  });
});
