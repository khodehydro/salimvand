import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ReferenceService } from './reference.service';

function makeService() {
  const prisma = {
    category: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    brand: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    vehicleMake: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    vehicleModel: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    vehicleTrim: { create: vi.fn(), update: vi.fn() },
  };
  return { service: new ReferenceService(prisma as never), prisma };
}

describe('ReferenceService', () => {
  it('creates a category with a normalized code and generated fallback slug', async () => {
    const { service, prisma } = makeService();
    prisma.category.create.mockResolvedValue({ id: 'c1' });
    await expect(service.createCategory({ name: 'داخلی خودرو', code: 'int' })).resolves.toEqual({
      ok: true,
      data: { id: 'c1' },
    });
    expect(prisma.category.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'داخلی خودرو',
        code: 'INT',
        slug: expect.stringMatching(/^int-/),
      }),
    });
  });
  it('rejects incomplete or malformed reference data', async () => {
    const { service } = makeService();
    await expect(service.createBrand({})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createCategory({ name: 'فیلتر', code: '!' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.createModel('missing', {})).rejects.toBeInstanceOf(BadRequestException);
  });
  it('requires existing parents before creating vehicle children', async () => {
    const { service, prisma } = makeService();
    prisma.vehicleMake.findUnique.mockResolvedValue(null);
    prisma.vehicleModel.findUnique.mockResolvedValue(null);
    await expect(service.createModel('missing', { name: '۲۰۶' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.createTrim('missing', { name: 'تیپ ۵' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.vehicleModel.create).not.toHaveBeenCalled();
    expect(prisma.vehicleTrim.create).not.toHaveBeenCalled();
  });
  it('updates and soft-disables categories instead of deleting referenced data', async () => {
    const { service, prisma } = makeService();
    prisma.category.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.category.update.mockResolvedValue({ id: 'c1', isActive: false });
    await expect(service.setCategoryActive('c1', false)).resolves.toEqual({
      ok: true,
      data: { id: 'c1', isActive: false },
    });
    expect(prisma.category.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { isActive: false },
    });
  });
  it('maps unique database violations to a safe conflict response', async () => {
    const { service, prisma } = makeService();
    prisma.brand.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.createBrand({ name: 'تکراری' })).rejects.toBeInstanceOf(ConflictException);
  });
});
