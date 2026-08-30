import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
    const images = await this.prisma.productImage.findMany({
      orderBy: { sort: 'asc' },
      include: { product: { select: { id: true, name: true, slug: true } } },
    });
    return { ok: true, data: images };
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
    const dir = join(this.uploadRoot, '..', 'site');
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
