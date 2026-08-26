import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class LocationService {
  constructor(private readonly prisma: PrismaService) {}
  async list() { return { ok: true, data: await this.prisma.location.findMany({ orderBy: { code: 'asc' }, include: { children: true } }) }; }
  async create(input: { name?: string; code?: string; type?: string; parentId?: string }) {
    if (!input.name || !input.code || !input.type) throw new BadRequestException('نام، کد و نوع محل الزامی است');
    return { ok: true, data: await this.prisma.location.create({ data: { name: input.name.trim(), code: input.code.trim(), type: input.type as never, parentId: input.parentId || null } }) };
  }
}
