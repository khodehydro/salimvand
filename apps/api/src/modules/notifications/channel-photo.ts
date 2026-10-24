import { lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { BlockList, isIP } from 'node:net';
import { join, resolve, sep } from 'node:path';
import sharp = require('sharp');

export type ChannelBrand = { name?: string; faviconUrl?: string; logoUrl?: string };

const FONT = join(__dirname, '..', '..', '..', 'assets', 'fonts', 'Vazirmatn-Regular.ttf');
const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_OPTIONS = { limitInputPixels: 40_000_000 };
const privateAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['192.0.0.0', 24],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const)
  privateAddresses.addSubnet(address, prefix, 'ipv4');

/** Never interpret a database image path as an arbitrary local file. */
async function imageBytes(path: string): Promise<Buffer> {
  const uploadRoot = resolve(
    process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads', 'products'),
    '..',
  );
  if (path.startsWith('/uploads/')) {
    const file = resolve(uploadRoot, path.slice('/uploads/'.length));
    if (!file.startsWith(uploadRoot + sep)) throw new Error('Invalid upload path');
    const data = await readFile(file);
    if (data.length > MAX_BYTES) throw new Error('Image is too large');
    return data;
  }

  // Imported product images and branding may be hosted externally. Do not
  // follow redirects or allow these URLs to access private network services.
  const url = new URL(path);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
    throw new Error('Invalid image URL');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) =>
      isIP(address) === 4
        ? privateAddresses.check(address, 'ipv4')
        : !/^[23][0-9a-f]{3}:/i.test(address),
    )
  )
    throw new Error('Private image URL is not allowed');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.body) throw new Error('Could not read image');
  if (Number(response.headers.get('content-length')) > MAX_BYTES)
    throw new Error('Image is too large');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX_BYTES) {
      await response.body.cancel().catch(() => undefined);
      throw new Error('Image is too large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function escapeMarkup(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function iconPng(bytes: Buffer, size: number): Promise<Buffer> {
  // Site settings also accept ICO. libvips cannot read ICO directly, so
  // decode its largest frame first (both PNG and BMP frames are supported).
  if (bytes.length >= 6 && bytes.readUInt32LE(0) === 0x00010000) {
    const decode = require('decode-ico') as (data: Buffer) => Array<{
      width: number;
      height: number;
      type: string;
      data: Uint8Array;
    }>;
    const frame = decode(bytes).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!frame) throw new Error('Empty icon');
    return sharp(
      Buffer.from(frame.data),
      frame.type === 'bmp'
        ? { ...IMAGE_OPTIONS, raw: { width: frame.width, height: frame.height, channels: 4 } }
        : IMAGE_OPTIONS,
    )
      .resize(size, size, { fit: 'contain', background: '#00000000' })
      .png()
      .toBuffer();
  }
  return sharp(bytes, IMAGE_OPTIONS)
    .resize(size, size, {
      fit: 'contain',
      background: '#00000000',
    })
    .png()
    .toBuffer();
}

/** Only used by channel publishing: produces a JPEG in memory, never writes
 * a derivative to uploads and never changes the product's stored image path. */
export async function createChannelPhoto(path: string, brand: ChannelBrand): Promise<Buffer> {
  const base = await sharp(await imageBytes(path), IMAGE_OPTIONS)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .png()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = base.info;
  // Lay out at a readable design size, then shrink as a unit for tiny images.
  const name = (brand.name?.trim() || 'فروشگاه سلیم وند').slice(0, 120);
  const text = await sharp({
    text: {
      text: `<span foreground="#172033">${escapeMarkup(name)}</span>`,
      font: 'Vazirmatn 28',
      fontfile: FONT,
      rgba: true,
    },
  })
    .resize({ width: 420, height: 48, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  const iconSize = 44;
  let icon: Buffer | undefined;
  for (const url of [brand.faviconUrl, brand.logoUrl]) {
    if (!url?.trim()) continue;
    try {
      icon = await iconPng(await imageBytes(url.trim()), iconSize);
      break;
    } catch {
      /* Try logo next. */
    }
  }
  if (!icon) {
    // Match the storefront's «س» brand mark when no usable site icon exists.
    icon = await sharp({
      text: {
        text: '<span foreground="#172033">س</span>',
        font: 'Vazirmatn 32',
        fontfile: FONT,
        rgba: true,
      },
    })
      .resize(iconSize, iconSize, { fit: 'contain', background: '#00000000' })
      .png()
      .toBuffer();
  }
  const badgeWidth = 16 + iconSize + 12 + text.info.width + 16;
  const badgeHeight = 68;
  const badge = await sharp({
    create: {
      width: badgeWidth,
      height: badgeHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0.84 },
    },
  })
    .composite([
      { input: icon, left: 16, top: 12 },
      {
        input: text.data,
        left: 16 + iconSize + 12,
        top: Math.floor((badgeHeight - text.info.height) / 2),
      },
    ])
    .png()
    .toBuffer();
  const margin = Math.max(0, Math.min(16, Math.floor(Math.min(width, height) * 0.025)));
  const fittedBadge = await sharp(badge)
    .resize({
      width: Math.max(1, Math.min(badgeWidth, width - margin * 2, Math.round(width * 0.65))),
      height: Math.max(1, height - margin * 2),
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  return sharp(base.data)
    .composite([{ input: fittedBadge, top: margin, left: margin }])
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 90 })
    .toBuffer();
}
