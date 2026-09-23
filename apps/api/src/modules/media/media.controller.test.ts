import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MediaController } from './media.controller';
import { INTERCEPTORS_METADATA } from '../../common/http/multipart.constants';

const source = readFileSync(join(__dirname, 'media.controller.ts'), 'utf8');

const file = (buffer = Buffer.from('png-bytes'), mimetype = 'image/png') => ({
  buffer,
  mimetype,
  originalname: 'brake-pad.png',
});

describe('MediaController multipart contract', () => {
  it('uploads product images with the multipart part named "file" (Android uploads depend on it)', () => {
    // Static pin of the interceptor field name: FileInterceptor('file').
    expect(source).toContain("@UseInterceptors(FileInterceptor('file')) upload(");
    expect(source).toContain("@Post('settings/:kind/upload')");
    expect(source).toContain("@UseInterceptors(FileInterceptor('file'))");
    // And the runtime metadata must agree with the source: the interceptor
    // class created by FileInterceptor('file') must be registered on upload.
    const interceptors = Reflect.getMetadata(
      INTERCEPTORS_METADATA,
      MediaController.prototype.upload,
    );
    expect(Array.isArray(interceptors)).toBe(true);
    expect(interceptors).toHaveLength(1);
    expect(String((interceptors as Array<unknown>)[0])).toContain('this.multer = multer(');
  });

  it('routes the uploaded file and alt text to the media service', async () => {
    const upload = vi.fn(async () => ({
      ok: true,
      data: { path: '/uploads/products/x/large.webp' },
    }));
    const controller = new MediaController({ upload } as never);
    const result = await controller.upload('product-1', file(), 'لنت ترمز جلو');
    expect(result).toEqual({ ok: true, data: { path: '/uploads/products/x/large.webp' } });
    expect(upload).toHaveBeenCalledWith(
      'product-1',
      expect.objectContaining({ originalname: 'brake-pad.png' }),
      'لنت ترمز جلو',
    );
  });

  it('rejects nothing at the controller level for site assets and keeps the same part name', async () => {
    const uploadSiteAsset = vi.fn(async () => ({
      ok: true,
      data: { path: '/uploads/site/logo-ab12cd34.png' },
    }));
    const controller = new MediaController({ uploadSiteAsset } as never);
    await controller.uploadSiteAsset('logo', file());
    expect(uploadSiteAsset).toHaveBeenCalledWith(
      'logo',
      expect.objectContaining({ mimetype: 'image/png' }),
    );
  });
});
