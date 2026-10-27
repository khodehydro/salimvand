// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { unzipSync, strFromU8 } from 'fflate';
import { DEFAULT_STUDIO_SETTINGS, type StudioSnapshot } from '@salimvand/shared';
import { exportStudio } from './export';
vi.mock('./render', async (original) => {
  const actual = await original<typeof import('./render')>();
  return {
    ...actual,
    StudioRenderer: class {
      warnings = new Set();
      dispose() {}
      async render() {
        return document.createElement('canvas');
      }
    },
    studioJpeg: async () => new Blob(['test-jpeg']),
  };
});
const snapshot: StudioSnapshot = {
  capturedAt: '2026-10-27T10:00:00Z',
  branding: {
    name: 'فروشگاه',
    logo: '',
    phones: '',
    website: 'https://shop.test',
    telegram: '',
    bale: '',
    address: '',
  },
  products: [
    {
      id: 'p',
      name: 'آبگیر',
      code: 'P1',
      category: 'آبگیر',
      image: '',
      available: true,
      vehicles: [],
      variants: [{ id: 'v', name: 'برند', price: null, available: true }],
    },
  ],
};
beforeEach(() => vi.stubGlobal('Blob', NodeBlob));
afterEach(() => vi.unstubAllGlobals());
describe('studio ZIP packaging', () => {
  it('writes numbered images into UTF-8 category/size folders with exact progress and no private snapshot', async () => {
    const progress = vi.fn(),
      controller = new AbortController();
    const result = await exportStudio(
      snapshot,
      { ...DEFAULT_STUDIO_SETTINGS, formats: ['portrait', 'story'] },
      {},
      'آبگیر',
      controller.signal,
      progress,
    );
    const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
    expect(Object.keys(files)).toEqual([
      'آبگیر/portrait-1080x1350/001-cover.jpg',
      'آبگیر/portrait-1080x1350/002-list.jpg',
      'آبگیر/story-1080x1920/001-cover.jpg',
      'آبگیر/story-1080x1920/002-list.jpg',
      'آبگیر/راهنمای-خروجی.txt',
    ]);
    expect(strFromU8(files['آبگیر/راهنمای-خروجی.txt'])).toContain('استعلام');
    expect(result.filename).toBe('آبگیر.zip');
    expect(progress.mock.calls).toEqual([
      [0, 4],
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
  });
  it('rejects empty lists, changed brand selections and cancellation without a partial ZIP', async () => {
    const controller = new AbortController();
    await expect(
      exportStudio(
        { ...snapshot, products: [] },
        DEFAULT_STUDIO_SETTINGS,
        {},
        'x',
        controller.signal,
        vi.fn(),
      ),
    ).rejects.toThrow('حداقل');
    await expect(
      exportStudio(
        snapshot,
        DEFAULT_STUDIO_SETTINGS,
        { p: 'missing' },
        'x',
        controller.signal,
        vi.fn(),
      ),
    ).rejects.toThrow('برند');
    controller.abort();
    await expect(
      exportStudio(snapshot, DEFAULT_STUDIO_SETTINGS, {}, 'x', controller.signal, vi.fn()),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
