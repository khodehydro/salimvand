import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STUDIO_SETTINGS,
  STUDIO_FORMATS,
  parseStudioSettings,
  studioFolder,
  studioFrames,
  studioPrice,
  type StudioProduct,
} from './content-studio';
const product = (n: number): StudioProduct => ({
  id: String(n),
  name: 'آبگیر',
  code: 'P' + n,
  category: 'آبگیر',
  image: '',
  vehicles: [],
  available: true,
  variants: [
    { id: 'a', name: 'الف', available: true, price: '9999999999999999999' },
    { id: 'b', name: 'ب', available: false, price: '100' },
  ],
});
describe('content studio contracts', () => {
  it('uses exact integer sale prices, prioritizes available brands, and honors explicit brand selection', () => {
    expect(studioPrice(product(1))).toMatchObject({
      price: '9999999999999999999',
      from: true,
      available: true,
    });
    expect(studioPrice(product(1), 'b')).toMatchObject({
      price: '100',
      from: false,
      brand: 'ب',
      available: false,
    });
  });
  it('does not invent a price for absent, zero or invalid amounts', () => {
    expect(studioPrice({ ...product(1), variants: [] }).price).toBeNull();
    expect(
      studioPrice({
        ...product(1),
        variants: [
          { id: 'a', name: '', available: true, price: '0' },
          { id: 'b', name: '', available: true, price: 'invalid' },
        ],
      }).price,
    ).toBeNull();
  });
  it('keeps the unpriced selected brand in inquiry mode rather than borrowing another brand price', () => {
    const p = product(1);
    p.variants[1].price = null;
    expect(studioPrice(p, 'b').price).toBeNull();
  });
  it('plans a cover + five list frames for 25 products at six per page', () => {
    const frames = studioFrames(
      Array.from({ length: 25 }, (_, i) => product(i)),
      DEFAULT_STUDIO_SETTINGS,
    );
    expect(frames).toHaveLength(6);
    expect(frames[0].kind).toBe('cover');
    expect(frames[5]).toMatchObject({ number: 6, total: 6 });
    expect(frames[5].products).toHaveLength(1);
  });
  it('supports ordered single-product stories, no cover, empty results and hard bounds', () => {
    expect(
      studioFrames([product(3), product(1)], { ...DEFAULT_STUDIO_SETTINGS, mode: 'single' }).map(
        (f) => [f.kind, f.products[0].id],
      ),
    ).toEqual([
      ['single', '3'],
      ['single', '1'],
    ]);
    expect(studioFrames([product(1)], { ...DEFAULT_STUDIO_SETTINGS, cover: false })[0].kind).toBe(
      'list',
    );
    expect(studioFrames([], DEFAULT_STUDIO_SETTINGS)).toEqual([]);
    expect(() =>
      studioFrames(
        Array.from({ length: 301 }, (_, i) => product(i)),
        DEFAULT_STUDIO_SETTINGS,
      ),
    ).toThrow('۳۰۰');
  });
  it('normalizes preferences without accepting private/unknown fields or truthy string flags', () => {
    const settings = parseStudioSettings({
      showPrices: 'true',
      formats: ['story', '__proto__', 'story'],
      title: ' x\n y ',
      productIds: ['secret'],
      price: 'secret',
      perPage: 5,
    });
    expect(settings.showPrices).toBe(false);
    expect(settings.formats).toEqual(['story']);
    expect(settings.title).toBe('x  y');
    expect(settings.perPage).toBe(6);
    expect(JSON.stringify(settings)).not.toContain('secret');
    expect(parseStudioSettings({ formats: [] }).formats).toEqual(['portrait']);
  });
  it('keeps default collections immutable and provides the requested exact dimensions', () => {
    parseStudioSettings(null).formats.push('story');
    expect(DEFAULT_STUDIO_SETTINGS.formats).toEqual(['portrait']);
    expect(Object.values(STUDIO_FORMATS).map((v) => [v.width, v.height])).toEqual([
      [1080, 1350],
      [1080, 1080],
      [1080, 1920],
    ]);
  });
  it('preserves Persian folder names while blocking traversal, unsafe filenames and Windows reserved names', () => {
    expect(studioFolder('آبگیر')).toBe('آبگیر');
    expect(studioFolder('../../foo\\bar')).not.toMatch(/[\\/]|\.\./);
    expect(studioFolder('CON')).toBe('_CON');
    expect(studioFolder('  ')).toBe('محصولات');
  });
});
