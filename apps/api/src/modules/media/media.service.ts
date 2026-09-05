import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import sharp = require('sharp');
import { PrismaService } from '../../prisma.service';
import { Prisma } from '@prisma/client';

/** Allowed image types for the site logo / favicon (SVG is rejected on
 * purpose: served same-origin from /uploads it would allow script injection). */
const SITE_ASSET_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

@Injectable()
export class MediaService {
  private readonly uploadRoot =
    process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads', 'products');

  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const [images, siteAssets] = await Promise.all([
      this.prisma.productImage.findMany({
        orderBy: { sort: 'asc' },
        include: { product: { select: { id: true, name: true, slug: true } } },
      }),
      this.listSiteAssets(),
    ]);
    return { ok: true, data: [...images, ...siteAssets] };
  }

  /** Everything uploaded on the server must be visible in the media library:
   * site assets (logo / favicon stored under uploads/site) are listed next to
   * the product images so the operator can copy their link or remove them. */
  private async listSiteAssets() {
    const dir = this.siteAssetDir();
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }
    return files
      .filter((name) => /\.(png|jpe?g|webp|ico)$/i.test(name))
      .map((name) => ({
        id: `site:${name}`,
        path: `/uploads/site/${name}`,
        kind: 'site' as const,
        label: name.startsWith('logo')
          ? 'لوگوی سایت'
          : name.startsWith('favicon')
            ? 'آیکون سایت'
            : 'رسانهٔ سایت',
        alt: null,
        isPrimary: false,
        product: null,
      }));
  }

  /** Delete a site asset file (uploads/site/<name>). Only plain file names
   * are accepted — no traversal, no subdirectories. If the store profile
   * still references the file (logoUrl / faviconUrl), the reference is
   * cleared too so the site never renders a broken image. */
  async removeSiteAsset(name: string) {
    const safe = name ?? '';
    if (!safe || safe.includes('/') || safe.includes('\\') || safe !== basename(safe))
      throw new BadRequestException('نام فایل نامعتبر است');
    if (!/^[A-Za-z0-9._-]+$/.test(safe)) throw new BadRequestException('نام فایل نامعتبر است');
    await rm(join(this.siteAssetDir(), safe), { force: true });
    const path = `/uploads/site/${safe}`;
    const row = await this.prisma.setting.findUnique({ where: { key: 'store.profile' } });
    const profile = (row?.value ?? {}) as Record<string, unknown>;
    const fields = ['logoUrl', 'faviconUrl'];
    if (fields.some((field) => profile[field] === path)) {
      for (const field of fields) if (profile[field] === path) profile[field] = '';
      await this.prisma.setting.update({
        where: { key: 'store.profile' },
        data: { value: profile as Prisma.InputJsonValue },
      });
    }
    return { ok: true, data: { id: `site:${safe}` } };
  }

  private siteAssetDir() {
    return join(this.uploadRoot, '..', 'site');
  }

  /** Store logo / favicon uploads under uploads/site and return the public
   * path the operator saves into store.profile (logoUrl / faviconUrl). */
  async uploadSiteAsset(
    kind: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
  ) {
    if (kind !== 'logo' && kind !== 'favicon')
      throw new BadRequestException('نوع تصویر نامعتبر است (logo یا favicon)');
    if (!file?.buffer?.length) throw new BadRequestException('فایل تصویر معتبر نیست');
    const extension = SITE_ASSET_MIME[file.mimetype];
    if (!extension)
      throw new BadRequestException('فرمت مجاز: PNG، JPG، WebP یا ICO (حجم حداکثر ۱ مگابایت)');
    if (file.buffer.length > 1024 * 1024)
      throw new BadRequestException('حجم فایل نباید بیشتر از ۱ مگابایت باشد');
    // nginx caps the CMS proxy body at ~1MB; stay safely below it.
    if (file.buffer.length > 900 * 1024)
      throw new BadRequestException('حجم فایل باید کمتر از ۹۰۰ کیلوبایت باشد');
    const dir = this.siteAssetDir();
    await mkdir(dir, { recursive: true });
    // A fresh filename per upload acts as a cache-buster for browsers and CDN.
    const name = `${kind}-${randomUUID().slice(0, 8)}.${extension}`;
    await writeFile(join(dir, name), file.buffer);
    return { ok: true, data: { kind, path: `/uploads/site/${name}` } };
  }

  async upload(
    productId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
    alt?: string,
  ) {
    if (!file?.buffer?.length || !file.mimetype.startsWith('image/'))
      throw new BadRequestException('فایل تصویر معتبر نیست');
    if (file.buffer.length > 5 * 1024 * 1024)
      throw new BadRequestException('حجم تصویر نباید بیشتر از ۵ مگابایت باشد');
    await this.ensureProduct(productId);
    const id = randomUUID();
    const dir = join(this.uploadRoot, id);
    await mkdir(dir, { recursive: true });
    await sharp(file.buffer)
      .rotate()
      .resize({ width: 900, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(join(dir, 'large.webp'));
    await sharp(file.buffer)
      .rotate()
      .resize({ width: 400, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(join(dir, 'small.webp'));
    const path = `/uploads/products/${id}/large.webp`;
    const image = await this.prisma.productImage.create({
      data: { productId, path, alt: alt?.trim() || undefined, sort: 0, isPrimary: false },
    });
    return { ok: true, data: image };
  }

  async addFromUrl(productId: string, url: string, alt?: string) {
    if (!/^https:\/\//i.test(url))
      throw new BadRequestException('آدرس تصویر باید با https شروع شود');
    await this.ensureProduct(productId);
    return {
      ok: true,
      data: await this.prisma.productImage.create({
        data: { productId, path: url, alt: alt?.trim() || undefined, sort: 0, isPrimary: false },
      }),
    };
  }

  async selectExisting(productId: string, imageId: string, alt?: string) {
    await this.ensureProduct(productId);
    const source = await this.prisma.productImage.findUnique({ where: { id: imageId } });
    if (!source) throw new NotFoundException('رسانه پیدا نشد');
    return {
      ok: true,
      data: await this.prisma.productImage.create({
        data: {
          productId,
          path: source.path,
          alt: alt?.trim() || source.alt || undefined,
          sort: 0,
          isPrimary: false,
        },
      }),
    };
  }

  async reorder(productId: string, imageIds: string[]) {
    await this.ensureProduct(productId);
    const images = await this.prisma.productImage.findMany({ where: { productId }, select: { id: true } });
    const valid = new Set(images.map((image: { id: string }) => image.id));
    if (imageIds.length !== images.length || imageIds.some((id) => !valid.has(id)) || new Set(imageIds).size !== imageIds.length)
      throw new BadRequestException('ترتیب تصاویر نامعتبر است');
    await this.prisma.$transaction(imageIds.map((id, sort) => this.prisma.productImage.update({ where: { id }, data: { sort } })));
    return { ok: true, data: { imageIds } };
  }

  async makePrimary(productId: string, imageId: string) {
    await this.ensureProduct(productId);
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.productImage.updateMany({ where: { productId }, data: { isPrimary: false } });
      const image = await tx.productImage.update({
        where: { id: imageId, productId },
        data: { isPrimary: true },
      });
      return { ok: true, data: image };
    });
  }

  async remove(productId: string, imageId: string) {
    const image = await this.prisma.productImage.findFirst({ where: { id: imageId, productId } });
    if (!image) throw new NotFoundException('تصویر پیدا نشد');
    await this.prisma.productImage.delete({ where: { id: imageId } });
    return { ok: true, data: { id: imageId } };
  }

  private async ensureProduct(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
    });
    if (!product) throw new NotFoundException('محصول پیدا نشد');
  }
}
