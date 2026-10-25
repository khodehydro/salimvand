import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp = require('sharp');
import { createChannelPhoto, storeChannelPhoto } from './channel-photo';

let root: string;
const previousUploadDir = process.env.UPLOAD_DIR;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'channel-photo-'));
  process.env.UPLOAD_DIR = join(root, 'products');
  await mkdir(join(root, 'products'));
  await mkdir(join(root, 'site'));
});
afterEach(async () => {
  if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = previousUploadDir;
  await rm(root, { recursive: true, force: true });
});

async function solid(width: number, height: number, background: string) {
  return sharp({ create: { width, height, channels: 3, background } })
    .png()
    .toBuffer();
}

async function pixel(image: Buffer, left: number, top: number): Promise<number[]> {
  return [
    ...(await sharp(image)
      .extract({ left, top, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()),
  ];
}

describe('channel-only photo watermark', () => {
  it('places site icon and Persian store name at top left without changing originals', async () => {
    const original = await solid(900, 600, '#203060');
    const icon = await solid(48, 48, '#ff0000');
    await writeFile(join(root, 'products', 'original.png'), original);
    await writeFile(join(root, 'site', 'icon.png'), icon);
    const output = await createChannelPhoto('/uploads/products/original.png', {
      name: 'فروشگاه سلیم وند',
      faviconUrl: '/uploads/site/icon.png',
    });
    expect(await sharp(output).metadata()).toMatchObject({
      format: 'jpeg',
      width: 900,
      height: 600,
    });
    const iconPixel = await pixel(output, 40, 40);
    expect(iconPixel[0]).toBeGreaterThan(220);
    expect(iconPixel[1]).toBeLessThan(30);
    // The bottom right remains the product image, not another watermark.
    const untouched = await pixel(output, 850, 550);
    expect(untouched[0]).toBeCloseTo(32, -1);
    expect(untouched[2]).toBeCloseTo(96, -1);
    expect(await readFile(join(root, 'products', 'original.png'))).toEqual(original);
    expect(await readFile(join(root, 'site', 'icon.png'))).toEqual(icon);
    // Name text is part of the rendered image, not the caption.
    const renamed = await createChannelPhoto('/uploads/products/original.png', {
      name: 'نام دیگر & <فروشگاه>',
      faviconUrl: '/uploads/site/icon.png',
    });
    expect(output.equals(renamed)).toBe(false);
  });

  it('reads PNG-backed ICO favicons', async () => {
    await writeFile(join(root, 'products', 'p.png'), await solid(900, 600, '#203060'));
    const png = await solid(32, 32, '#00ff00');
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header[6] = 32;
    header[7] = 32;
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(png.length, 14);
    header.writeUInt32LE(22, 18);
    await writeFile(join(root, 'site', 'icon.ico'), Buffer.concat([header, png]));
    const output = await createChannelPhoto('/uploads/products/p.png', {
      faviconUrl: '/uploads/site/icon.ico',
    });
    const color = await pixel(output, 40, 40);
    expect(color[1]).toBeGreaterThan(220);
    expect(color[0]).toBeLessThan(30);
  });

  it('falls back to the logo if the favicon is unusable', async () => {
    await writeFile(join(root, 'products', 'p.png'), await solid(900, 600, '#203060'));
    await writeFile(join(root, 'site', 'logo.png'), await solid(48, 48, '#0000ff'));
    const output = await createChannelPhoto('/uploads/products/p.png', {
      faviconUrl: '/uploads/site/missing.ico',
      logoUrl: '/uploads/site/logo.png',
    });
    expect((await pixel(output, 40, 40))[2]).toBeGreaterThan(220);
  });

  it.each([
    [80, 40],
    [1, 1],
    [2400, 1800],
  ])('fits branding into %i × %i images', async (width, height) => {
    await writeFile(join(root, 'products', 'p.png'), await solid(width, height, '#203060'));
    const output = await createChannelPhoto('/uploads/products/p.png', {});
    const metadata = await sharp(output).metadata();
    expect(metadata.width).toBeLessThanOrEqual(1600);
    expect(metadata.height).toBeLessThanOrEqual(1600);
    expect(metadata.format).toBe('jpeg');
  });

  it('rejects traversal, private URLs and invalid image files', async () => {
    await writeFile(join(root, 'products', 'bad.png'), 'not an image');
    await expect(createChannelPhoto('/uploads/../../secret', {})).rejects.toThrow(
      'Invalid upload path',
    );
    await expect(createChannelPhoto('https://127.0.0.1/p.png', {})).rejects.toThrow(
      'Private image URL',
    );
    await expect(createChannelPhoto('https://[::1]/p.png', {})).rejects.toThrow(
      'Private image URL',
    );
    await expect(createChannelPhoto('/uploads/products/bad.png', {})).rejects.toThrow();
  });
});

describe('Telegram public channel derivatives', () => {
  it('stores only the branded copy in a separate public directory', async () => {
    const original = await solid(900, 600, '#203060');
    await writeFile(join(root, 'products', 'original.png'), original);
    const branded = await createChannelPhoto('/uploads/products/original.png', {});
    const url = await storeChannelPhoto(branded, 'https://salimvand.ir/');
    const path = new URL(url).pathname;
    expect(url).toMatch(/^https:\/\/salimvand\.ir\/uploads\/channel-posts\/[a-f0-9]{64}\.jpg$/);
    const file = join(root, path.slice('/uploads/'.length));
    expect(await readFile(file)).toEqual(branded);
    expect((await stat(file)).mode & 0o777).toBe(0o644);
    expect(await readFile(join(root, 'products', 'original.png'))).toEqual(original);
    expect(await readdir(join(root, 'products'))).toEqual(['original.png']);
  });

  it('reuses content-addressed filenames and changes them when the watermark changes', async () => {
    const photo = Buffer.from('branded JPEG');
    const first = await storeChannelPhoto(photo, 'https://salimvand.ir');
    expect(await storeChannelPhoto(photo, 'https://salimvand.ir/')).toBe(first);
    expect(
      await storeChannelPhoto(Buffer.from('updated branding'), 'https://salimvand.ir'),
    ).not.toBe(first);
    expect(await readdir(join(root, 'channel-posts'))).toHaveLength(2);
  });

  it('publishes concurrent writes atomically without leaving temporary files', async () => {
    const photo = await solid(900, 600, '#203060');
    const urls = await Promise.all(
      Array.from({ length: 5 }, () => storeChannelPhoto(photo, 'https://salimvand.ir')),
    );
    expect(new Set(urls).size).toBe(1);
    const files = await readdir(join(root, 'channel-posts'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{64}\.jpg$/);
    expect(await readFile(join(root, 'channel-posts', files[0]))).toEqual(photo);
  });

  it('works with a provisioned channel directory even when its parent is not writable', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    // Production uploads can be owned by root: the service can write into
    // pre-created children but must not need to create siblings under uploads.
    const dir = join(root, 'channel-posts');
    await chmod(root, 0o555);
    try {
      await expect(
        storeChannelPhoto(Buffer.from('photo'), 'https://salimvand.ir'),
      ).rejects.toMatchObject({ code: 'EACCES' });
      await chmod(root, 0o755);
      await mkdir(dir, { mode: 0o755 });
      await chmod(root, 0o555);
      const photo = Buffer.from('branded copy');
      const url = await storeChannelPhoto(photo, 'https://salimvand.ir');
      expect(await readFile(join(dir, new URL(url).pathname.split('/').pop()!))).toEqual(photo);
    } finally {
      await chmod(root, 0o755);
    }
  });

  it('rejects invalid public URLs before writing files', async () => {
    await expect(storeChannelPhoto(Buffer.from('photo'), 'file:///tmp')).rejects.toThrow(
      'Invalid public site URL',
    );
    await expect(
      storeChannelPhoto(Buffer.from('photo'), 'https://user:password@example.com'),
    ).rejects.toThrow('Invalid public site URL');
    expect(await readdir(root)).toEqual(['products', 'site']);
  });
});
