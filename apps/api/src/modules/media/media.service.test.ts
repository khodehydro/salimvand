import { describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));
vi.mock('sharp', () => ({ default: vi.fn() }));

import { MediaService } from './media.service';

describe('MediaService.uploadSiteAsset', () => {
  const file = (buffer: Buffer, mimetype = 'image/png') => ({
    buffer,
    mimetype,
    originalname: 'a.png',
  });

  it('rejects unknown asset kinds and invalid payloads', async () => {
    const service = new MediaService({} as never);
    await expect(service.uploadSiteAsset('banner', file(Buffer.from('x')))).rejects.toThrow(
      'نوع تصویر نامعتبر است',
    );
    await expect(service.uploadSiteAsset('logo', file(Buffer.alloc(0)))).rejects.toThrow(
      'فایل تصویر معتبر نیست',
    );
  });

  it('rejects formats that are not embeddable safely (SVG) and oversized files', async () => {
    const service = new MediaService({} as never);
    await expect(
      service.uploadSiteAsset('logo', file(Buffer.from('<svg/>'), 'image/svg+xml')),
    ).rejects.toThrow('فرمت مجاز');
    await expect(
      service.uploadSiteAsset('favicon', file(Buffer.alloc(950 * 1024))),
    ).rejects.toThrow('۹۰۰ کیلوبایت');
  });

  it('writes the asset under uploads/site and returns the public path', async () => {
    const service = new MediaService({} as never);
    const result = await service.uploadSiteAsset('logo', file(Buffer.from('png-bytes')));
    expect(result.ok).toBe(true);
    expect(result.data.path).toMatch(/^\/uploads\/site\/logo-[0-9a-f]{8}\.png$/);
  });
});
