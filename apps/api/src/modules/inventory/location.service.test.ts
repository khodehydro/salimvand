import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LocationService } from './location.service';

/** Minimal location row shaped like the Prisma model. */
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'loc-1',
  name: 'قفسه جلو',
  code: 'A-03',
  type: 'shelf',
  parentId: null,
  ...overrides,
});

function makeService(overrides: Record<string, unknown> = {}) {
  const prisma = {
    location: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => row(data)),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => row(data)),
      delete: vi.fn(async () => row()),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    ...overrides,
  };
  return { service: new LocationService(prisma as never), prisma };
}

describe('LocationService', () => {
  it('lists locations with their warehouse parent, children and item counts', async () => {
    const { service, prisma } = makeService();
    prisma.location.findMany.mockResolvedValue([
      row({ id: 'wh-1', name: 'انبار اصلی', type: 'warehouse', children: [] }),
    ]);
    const result = await service.list();
    expect(prisma.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          parent: true,
          children: expect.objectContaining({ include: { _count: { select: { items: true } } } }),
          _count: { select: { items: true } },
        }),
      }),
    );
    expect(result.data[0].name).toBe('انبار اصلی');
  });

  it('creates a shelf inside a warehouse (parentId) and audits it', async () => {
    const { service, prisma } = makeService();
    prisma.location.findUnique.mockResolvedValue(
      row({ id: 'wh-1', name: 'انبار اصلی', type: 'warehouse' }),
    );
    const result = await service.create({
      name: 'قفسه جلو',
      code: 'A-03',
      parentId: 'wh-1',
      userId: 'u1',
    });
    expect(result.ok).toBe(true);
    expect(prisma.location.create).toHaveBeenCalledWith({
      data: { name: 'قفسه جلو', code: 'A-03', type: 'shelf', parentId: 'wh-1' },
    });
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('rejects a missing name/code or an unknown type', async () => {
    const { service } = makeService();
    await expect(service.create({ name: '', code: 'A-1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.create({ name: 'x', code: '' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.create({ name: 'x', code: 'A-1', type: 'garage' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects duplicate codes within the same warehouse', async () => {
    const { service, prisma } = makeService();
    prisma.location.findUnique.mockResolvedValue(row({ id: 'wh-1', type: 'warehouse' }));
    prisma.location.findFirst.mockResolvedValue(row({ id: 'other', parentId: 'wh-1' }));
    await expect(service.create({ name: 'قفسه', code: 'A-03', parentId: 'wh-1' })).rejects.toThrow(
      'این کد قبلاً در همین انبار ثبت شده است',
    );
  });

  it('only allows a top-level warehouse as parent — never itself or another shelf', async () => {
    const { service, prisma } = makeService();
    prisma.location.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id === 'wh-1' ? row({ id: 'wh-1', type: 'warehouse' }) : null,
    );
    await expect(
      service.create({ name: 'قفسه', code: 'B-01', parentId: 'wh-1' }),
    ).resolves.toBeTruthy();
    prisma.location.findUnique.mockResolvedValue(row({ id: 'loc-1' }));
    await expect(service.update('loc-1', { parentId: 'loc-1' })).rejects.toThrow(
      'محل نمی‌تواند والد خودش باشد',
    );
    prisma.location.findUnique.mockResolvedValue(row({ id: 'shelf-2', parentId: 'wh-1' }));
    await expect(service.update('loc-1', { parentId: 'shelf-2' })).rejects.toThrow(
      'والد باید یک انبار (سطح اول) باشد',
    );
  });

  it('updates name/code and moves a shelf to another warehouse', async () => {
    const { service, prisma } = makeService();
    prisma.location.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) => {
      if (where.id === 'loc-1') return row({ id: 'loc-1', parentId: 'wh-1' });
      if (where.id === 'wh-2') return row({ id: 'wh-2', name: 'انبار دوم', type: 'warehouse' });
      return null;
    });
    const result = await service.update('loc-1', {
      name: 'قفسه عقب',
      code: 'B-09',
      parentId: 'wh-2',
    });
    expect(result.data.name).toBe('قفسه عقب');
    expect(prisma.location.update).toHaveBeenCalledWith({
      where: { id: 'loc-1' },
      data: { name: 'قفسه عقب', code: 'B-09', type: 'shelf', parentId: 'wh-2' },
    });
  });

  it('detaching a shelf (بدون انبار) sends parentId null', async () => {
    const { service, prisma } = makeService();
    prisma.location.findUnique.mockResolvedValue(row({ parentId: 'wh-1' }));
    await service.update('loc-1', { parentId: null });
    expect(prisma.location.update).toHaveBeenCalledWith({
      where: { id: 'loc-1' },
      data: expect.objectContaining({ parentId: null }),
    });
  });

  it('a warehouse with shelves cannot become a shelf itself', async () => {
    const { service, prisma } = makeService();
    prisma.location.findUnique.mockResolvedValue(row({ id: 'wh-1', type: 'warehouse' }));
    prisma.location.count.mockResolvedValue(3);
    await expect(service.update('wh-1', { parentId: 'wh-2' })).rejects.toThrow(
      'این انبار قفسه دارد و نمی‌تواند زیرمجموعهٔ انبار دیگری شود',
    );
  });

  it('deleting a shelf reports how many items were detached', async () => {
    const { service, prisma } = makeService();
    prisma.location.findUnique.mockResolvedValue({
      ...row(),
      _count: { items: 4, children: 0 },
    });
    const result = await service.remove('loc-1', 'u1');
    expect(prisma.location.delete).toHaveBeenCalledWith({ where: { id: 'loc-1' } });
    expect(result.data).toEqual({ id: 'loc-1', detachedItems: 4 });
  });

  it('deleting a warehouse with shelves is blocked', async () => {
    const { service, prisma } = makeService();
    prisma.location.findUnique.mockResolvedValue({
      ...row({ type: 'warehouse' }),
      _count: { items: 0, children: 2 },
    });
    await expect(service.remove('loc-1')).rejects.toThrow(
      'ابتدا قفسه‌های این انبار را حذف یا به انبار دیگری منتقل کنید',
    );
    expect(prisma.location.delete).not.toHaveBeenCalled();
  });

  it('updating or deleting an unknown location returns 404', async () => {
    const { service } = makeService();
    await expect(service.update('nope', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
