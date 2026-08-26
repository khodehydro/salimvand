import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp = require('sharp');
import { PrismaService } from '../../prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class MediaService {
  private readonly uploadRoot = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads', 'products');
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const images = await this.prisma.productImage.findMany({ orderBy: { sort: 'asc' }, include: { product: { select: { id: true, name: true, slug: true } } } });
    return { ok: true, data: images };
  }

  async upload(productId: string, file: { buffer: Buffer; mimetype: string; originalname: string }, alt?: string) {
    if (!file?.buffer?.length || !file.mimetype.startsWith('image/')) throw new BadRequestException('فایل تصویر معتبر نیست');
    if (file.buffer.length > 5 * 1024 * 1024) throw new BadRequestException('حجم تصویر نباید بیشتر از ۵ مگابایت باشد');
    await this.ensureProduct(productId);
    const id = randomUUID(); const dir = join(this.uploadRoot, id); await mkdir(dir, { recursive: true });
    await sharp(file.buffer).rotate().resize({ width: 900, withoutEnlargement: true }).webp({ quality: 82 }).toFile(join(dir, 'large.webp'));
    await sharp(file.buffer).rotate().resize({ width: 400, withoutEnlargement: true }).webp({ quality: 78 }).toFile(join(dir, 'small.webp'));
    const path = `/uploads/products/${id}/large.webp`;
    const image = await this.prisma.productImage.create({ data: { productId, path, alt: alt?.trim() || undefined, sort: 0, isPrimary: false } });
    return { ok: true, data: image };
  }

  async addFromUrl(productId: string, url: string, alt?: string) {
    if (!/^https:\/\//i.test(url)) throw new BadRequestException('آدرس تصویر باید با https شروع شود');
    await this.ensureProduct(productId);
    return { ok: true, data: await this.prisma.productImage.create({ data: { productId, path: url, alt: alt?.trim() || undefined, sort: 0, isPrimary: false } }) };
  }

  async selectExisting(productId: string, imageId: string, alt?: string) {
    await this.ensureProduct(productId);
    const source = await this.prisma.productImage.findUnique({ where: { id: imageId } });
    if (!source) throw new NotFoundException('رسانه پیدا نشد');
    return { ok: true, data: await this.prisma.productImage.create({ data: { productId, path: source.path, alt: alt?.trim() || source.alt || undefined, sort: 0, isPrimary: false } }) };
  }

  async makePrimary(productId: string, imageId: string) {
    await this.ensureProduct(productId);
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.productImage.updateMany({ where: { productId }, data: { isPrimary: false } });
      const image = await tx.productImage.update({ where: { id: imageId, productId }, data: { isPrimary: true } });
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
    const product = await this.prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
    if (!product) throw new NotFoundException('محصول پیدا نشد');
  }
}
