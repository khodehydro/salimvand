import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class CompatibilityService {
  constructor(private readonly prisma: PrismaService) {}
  async replace(productId: string, rows: Array<{ modelId: string; trimId?: string | null }>) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
    if (!product) throw new NotFoundException('محصول پیدا نشد');
    if (!Array.isArray(rows)) throw new BadRequestException('فهرست خودرو معتبر نیست');
    const unique = Array.from(new Map(rows.map((row) => [`${row.modelId}:${row.trimId ?? ''}`, row])).values());
    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.productVehicleCompat.deleteMany({ where: { productId } });
      if (unique.length) await tx.productVehicleCompat.createMany({ data: unique.map((row) => ({ productId, modelId: row.modelId, trimId: row.trimId ?? null })) });
      return tx.productVehicleCompat.findMany({ where: { productId }, include: { model: { include: { make: true } }, trim: true } });
    });
    return { ok: true, data: result };
  }
}
