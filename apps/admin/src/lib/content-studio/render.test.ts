// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STUDIO_SETTINGS,
  STUDIO_FORMATS,
  studioFrames,
  type StudioFormat,
  type StudioSnapshot,
} from '@salimvand/shared';
import { StudioRenderer } from './render';
const snapshot: StudioSnapshot = {
  capturedAt: '2026-10-27T10:00:00Z',
  branding: {
    name: 'فروشگاه',
    logo: '',
    phones: '0912',
    website: 'https://shop.test',
    telegram: 'https://t.me/shop',
    bale: 'https://ble.ir/shop',
    address: 'نشانی فروشگاه',
  },
  products: Array.from({ length: 7 }, (_, i) => ({
    id: String(i),
    name: 'آبگیر پژو ۲۰۶ تیپ ۵',
    code: 'P' + i,
    image: '',
    category: 'آبگیر',
    vehicles: ['پژو ۲۰۶ تیپ ۵'],
    available: true,
    variants: [{ id: 'v', name: 'ایساکو', price: '1234567', available: true }],
  })),
};
let text: string[], coords: number[][];
beforeEach(() => {
  text = [];
  coords = [];
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { load: vi.fn().mockResolvedValue([]) },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        font: '',
        fillText: (v: string) => text.push(v),
        measureText: (v: string) => ({ width: v.length * 10 }),
        fillRect: () => {},
        roundRect: (...v: number[]) => coords.push(v),
        beginPath: () => {},
        fill: () => {},
        stroke: () => {},
        arc: () => {},
        createLinearGradient: () => ({ addColorStop: () => {} }),
        drawImage: () => {},
      }) as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => vi.restoreAllMocks());
describe('studio pixel renderer', () => {
  for (const format of Object.keys(STUDIO_FORMATS) as StudioFormat[])
    it(`renders cover, partial list and single at exact ${format} dimensions`, async () => {
      const settings = { ...DEFAULT_STUDIO_SETTINGS, title: 'آبگیر', allowMissingImages: true };
      const renderer = new StudioRenderer();
      const frames = studioFrames(snapshot.products, settings);
      for (const frame of [
        frames[0],
        frames[1],
        frames[2],
        studioFrames([snapshot.products[0]], { ...settings, mode: 'single' as const })[0],
      ]) {
        const canvas = await renderer.render(frame, format, snapshot, settings);
        expect([canvas.width, canvas.height]).toEqual([1080, STUDIO_FORMATS[format].height]);
      }
      expect(coords.every(([, y, w, h]) => y >= 0 && w >= 0 && h >= 0)).toBe(true);
      expect(text).toContain('استعلام قیمت');
      expect(text.some((t) => t.includes('۱٬۲۳۴٬۵۶۷'))).toBe(false);
      renderer.dispose();
    });
  it('draws explicit sale-price labels and real contact links rather than API internals', async () => {
    const settings = {
      ...DEFAULT_STUDIO_SETTINGS,
      title: 'آبگیر',
      showPrices: true,
      allowMissingImages: true,
    };
    const renderer = new StudioRenderer();
    await renderer.render(
      studioFrames(snapshot.products, settings)[1],
      'portrait',
      snapshot,
      settings,
    );
    expect(text).toContain('۱٬۲۳۴٬۵۶۷ ریال');
    expect(text).toContain('Telegram: t.me/shop');
    expect(text).toContain('Bale: ble.ir/shop');
    expect(text).toContain('PEUGEOT | SAMAND | DENA | NISSAN | PAYKAN | RANA');
  });
  it('honors a custom single-story heading without changing the product data', async () => {
    const settings = {
      ...DEFAULT_STUDIO_SETTINGS,
      title: 'انتخاب ویژه',
      mode: 'single' as const,
      allowMissingImages: true,
    };
    await new StudioRenderer().render(
      studioFrames([snapshot.products[0]], settings)[0],
      'story',
      snapshot,
      settings,
    );
    expect(text).toContain('انتخاب ویژه');
    expect(snapshot.products[0].name).toBe('آبگیر پژو ۲۰۶ تیپ ۵');
  });
  it('blocks missing photos on strict export unless explicitly allowed, and honors cancellation', async () => {
    const renderer = new StudioRenderer(),
      settings = { ...DEFAULT_STUDIO_SETTINGS, title: 'آبگیر' };
    await expect(
      renderer.render(
        studioFrames(snapshot.products, settings)[1],
        'portrait',
        snapshot,
        settings,
        {},
        true,
      ),
    ).rejects.toThrow('تصویر');
    const controller = new AbortController();
    controller.abort();
    await expect(
      new StudioRenderer(controller.signal).render(
        studioFrames(snapshot.products, settings)[0],
        'portrait',
        snapshot,
        settings,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
