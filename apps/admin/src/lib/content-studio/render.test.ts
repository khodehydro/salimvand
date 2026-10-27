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
import { studioPersianDigits } from './icons';
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
  vi.stubGlobal(
    'Path2D',
    class {
      constructor(readonly path: string) {}
    },
  );
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
        save: () => {},
        restore: () => {},
        clip: () => {},
        translate: () => {},
        scale: () => {},
      }) as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('studio pixel renderer', () => {
  it('localizes phone digits without dropping leading zeroes, separators or international prefixes', () => {
    expect(studioPersianDigits('0912 345 6789 | +98-٢١-۱۲۳')).toBe('۰۹۱۲ ۳۴۵ ۶۷۸۹ | +۹۸-۲۱-۱۲۳');
  });
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
    expect(text).toContain('t.me/shop');
    expect(text).not.toContain('Telegram: t.me/shop');
    expect(text).toContain('۰۹۱۲');
    expect(text).not.toContain('0912');
    expect(text).toContain('ble.ir/shop');
    expect(text).not.toContain('Bale: ble.ir/shop');
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
  it('normalizes the same product with different source sizes and white margins without stretching', async () => {
    class Photo {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private path = '';
      get src() {
        return this.path;
      }
      set src(value: string) {
        this.path = value;
        if (value) queueMicrotask(() => this.onload?.());
      }
      get naturalWidth() {
        return this.path.includes('padded') ? 1024 : 200;
      }
      get naturalHeight() {
        return this.path.includes('padded') ? 512 : 100;
      }
    }
    vi.stubGlobal('Image', Photo);
    const context = document.createElement('canvas').getContext('2d')!;
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context);
    let source: Photo;
    const destinations: number[][] = [];
    context.drawImage = vi.fn((...args: unknown[]) => {
      source = args[0] as Photo;
      if (args.length === 9) destinations.push(args.slice(5) as number[]);
    }) as typeof context.drawImage;
    context.getImageData = vi.fn((_x, _y, w, h) => {
      const data = new Uint8ClampedArray(w * h * 4).fill(255);
      const padded = source.src.includes('padded');
      for (let y = padded ? 100 : 0; y < (padded ? 150 : h); y++)
        for (let x = padded ? 200 : 0; x < (padded ? 300 : w); x++) {
          const i = (y * w + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 32;
        }
      return { data } as ImageData;
    });
    const settings = { ...DEFAULT_STUDIO_SETTINGS, mode: 'single' as const };
    const renderer = new StudioRenderer();
    for (const path of ['padded', 'tight']) {
      const product = { ...snapshot.products[0], image: `/uploads/${path}.png` };
      await renderer.render(
        studioFrames([product], settings)[0],
        'story',
        { ...snapshot, products: [product] },
        settings,
      );
    }
    expect(destinations).toHaveLength(2);
    destinations[0].forEach((coordinate, i) =>
      expect(coordinate).toBeCloseTo(destinations[1][i], 5),
    );
    expect(destinations[0][2] / destinations[0][3]).toBeCloseTo(2);
    renderer.dispose();
  });
  it('clips the logo itself to a circle and leaves a readable gap between CTA and Persian phones', async () => {
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 120;
        naturalHeight = 120;
        onload: (() => void) | null = null;
        set src(value: string) {
          if (value) queueMicrotask(() => this.onload?.());
        }
      },
    );
    const context = document.createElement('canvas').getContext('2d')!;
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context);
    const clip = vi.spyOn(context, 'clip');
    const draw = vi.spyOn(context, 'drawImage');
    const positions: Array<{ text: string; y: number }> = [];
    context.fillText = (value, _x, y) => {
      positions.push({ text: value, y });
    };
    const settings = {
      ...DEFAULT_STUDIO_SETTINGS,
      mode: 'single' as const,
      showAddress: true,
      allowMissingImages: true,
    };
    const renderer = new StudioRenderer();
    await renderer.render(
      studioFrames([snapshot.products[0]], settings)[0],
      'square',
      { ...snapshot, branding: { ...snapshot.branding, logo: '/uploads/logo.png' } },
      settings,
    );
    expect(clip).toHaveBeenCalledOnce();
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 120, 120, 936, 48, 84, 84);
    expect(coords.some(([x, y, w]) => x === 936 && y === 48 && w === 84)).toBe(false);
    const cta = positions.find((p) => p.text === settings.cta)!;
    const phone = positions.find((p) => p.text === '۰۹۱۲')!;
    expect(phone.y - cta.y).toBeGreaterThanOrEqual(46);
    expect(positions.some((p) => p.text === snapshot.branding.address)).toBe(true);
    renderer.dispose();
  });
  it('omits prices and inquiry labels in no-price mode for covers, lists and singles at every size', async () => {
    const settings = {
      ...DEFAULT_STUDIO_SETTINGS,
      showPriceInfo: false,
      showPrices: true,
      allowMissingImages: true,
    };
    for (const format of Object.keys(STUDIO_FORMATS) as StudioFormat[]) {
      const renderer = new StudioRenderer();
      for (const frame of [
        ...studioFrames(snapshot.products, settings),
        ...studioFrames([snapshot.products[0]], { ...settings, mode: 'single' as const }),
      ])
        await renderer.render(frame, format, snapshot, settings);
      renderer.dispose();
    }
    expect(text.some((t) => /قیمت|استعلام|ریال/.test(t))).toBe(false);
    expect(text).toContain('برای سفارش با ما در ارتباط باشید');
    expect(text).toContain('آبگیر پژو ۲۰۶ تیپ ۵');
  });
  it('puts the website and both networks on one shared footer baseline', async () => {
    const context = document.createElement('canvas').getContext('2d')!;
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context);
    const positions: Record<string, number> = {};
    context.fillText = (value, _x, y) => {
      positions[value] = y;
    };
    const settings = { ...DEFAULT_STUDIO_SETTINGS, allowMissingImages: true };
    await new StudioRenderer().render(
      studioFrames(snapshot.products, settings)[0],
      'portrait',
      snapshot,
      settings,
    );
    expect(positions['shop.test']).toBeDefined();
    expect(positions['shop.test']).toBe(positions['t.me/shop']);
    expect(positions['shop.test']).toBe(positions['ble.ir/shop']);
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
