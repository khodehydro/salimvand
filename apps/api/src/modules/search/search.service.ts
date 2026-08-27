import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}
  async all(query: string) {
    const q = query.trim(); if (q.length > 100) throw new BadRequestException('عبارت جست‌وجو بیش از حد مجاز است'); if (!q) return { ok: true, data: { products: [], customers: [], invoices: [], brands: [], locations: [] } };
    const [products, customers, invoices, brands, locations] = await Promise.all([
      this.prisma.product.findMany({ where: { deletedAt: null, OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }, { partNumber: { contains: q, mode: 'insensitive' } }] }, take: 8, select: { id: true, name: true, code: true, slug: true, inventoryItems: { select: { quantity: true, brand: { select: { name: true } } } } } }),
      this.prisma.customer.findMany({ where: { isActive: true, OR: [{ name: { contains: q, mode: 'insensitive' } }, { mobile: { contains: q } }] }, take: 8, select: { id: true, name: true, mobile: true } }),
      this.prisma.invoice.findMany({ where: { OR: [{ number: { contains: q, mode: 'insensitive' } }, { customerName: { contains: q, mode: 'insensitive' } }, { customerMobile: { contains: q } }] }, take: 8, orderBy: { issuedAt: 'desc' }, select: { id: true, number: true, customerName: true, total: true, paymentStatus: true } }),
      this.prisma.brand.findMany({ where: { isActive: true, name: { contains: q, mode: 'insensitive' } }, take: 8, select: { id: true, name: true } }),
      this.prisma.location.findMany({ where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] }, take: 8, select: { id: true, name: true, code: true } }),
    ]);
    return { ok: true, data: { products, customers, invoices, brands, locations } };
  }
}
