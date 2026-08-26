import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReferenceService } from './reference.service';

function makeService() { const prisma = { category: { create: vi.fn() }, brand: { create: vi.fn() }, vehicleMake: { create: vi.fn(), findUnique: vi.fn() }, vehicleModel: { create: vi.fn() }, vehicleTrim: { create: vi.fn() } }; return { service: new ReferenceService(prisma as never), prisma }; }

describe('ReferenceService', () => {
  it('creates a category with a generated fallback slug', async () => { const { service, prisma } = makeService(); prisma.category.create.mockResolvedValue({ id: 'c1' }); await expect(service.createCategory({ name: 'داخلی خودرو', code: 'INT' })).resolves.toEqual({ ok: true, data: { id: 'c1' } }); expect(prisma.category.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: 'داخلی خودرو', code: 'INT', slug: expect.stringMatching(/^int-/) }) }); });
  it('rejects incomplete reference data', async () => { const { service } = makeService(); await expect(service.createBrand({})).rejects.toBeInstanceOf(BadRequestException); await expect(service.createModel('missing', {})).rejects.toBeInstanceOf(BadRequestException); });
  it('requires an existing vehicle make before creating a model', async () => { const { service, prisma } = makeService(); prisma.vehicleMake.findUnique.mockResolvedValue(null); await expect(service.createModel('missing', { name: '۲۰۶' })).rejects.toBeInstanceOf(NotFoundException); expect(prisma.vehicleModel.create).not.toHaveBeenCalled(); });
});
