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
      // assertChildren() reads the child types of a node before re-parenting.
      findMany: vi.fn(async () => []),
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
          // children of a warehouse are shelves, and each shelf carries its
          // own baskets — both levels report their stock counts.
          children: expect.objectContaining({
            include: expect.objectContaining({
              children: expect.objectContaining({
                include: { _count: { select: { items: true, basketItems: true } } },
              }),
              _count: { select: { items: true, basketItems: true, children: true } },
            }),
          }),
          _count: { select: { items: true, basketItems: true, children: true } },
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

  it('rejects a blank name or code on update, not just on create', async () => {
    const { service, prisma } = makeService();
    prisma.location.findUnique.mockResolvedValue(row());
    // نام یا کدِ خالی/فقط‌فاصله هرگز نباید به دیتابیس برسد — همین ردیف‌های
    // «بدون نام» قبلاً از این مسیر ایجاد شده بودند.
    await expect(service.update('loc-1', { name: '', code: 'A-03' })).rejects.toThrow(
      new BadRequestException('نام و کد محل الزامی است'),
    );
    await expect(service.update('loc-1', { name: 'قفسه جلو', code: '   ' })).rejects.toThrow(
      new BadRequestException('نام و کد محل الزامی است'),
    );
    expect(prisma.location.update).not.toHaveBeenCalled();
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

  it('an انبار can never hang under another location', async () => {
    const { service, prisma } = makeService();
    prisma.location.findUnique.mockResolvedValue(row({ id: 'wh-1', type: 'warehouse' }));
    prisma.location.count.mockResolvedValue(3);
    await expect(service.update('wh-1', { parentId: 'wh-2' })).rejects.toThrow(
      'انبار نمی‌تواند زیرمجموعهٔ محل دیگری باشد',
    );
    await expect(
      service.create({ name: 'انبار دوم', code: 'W-2', type: 'warehouse', parentId: 'wh-1' }),
    ).rejects.toThrow('انبار نمی‌تواند زیرمجموعهٔ محل دیگری باشد');
    expect(prisma.location.create).not.toHaveBeenCalled();
  });

  it('deleting a shelf reports how many items were detached', async () => {
    const { service, prisma } = makeService();
    prisma.location.findUnique.mockResolvedValue({
      ...row(),
      _count: { items: 4, basketItems: 2, children: 0 },
    });
    const result = await service.remove('loc-1', 'u1');
    expect(prisma.location.delete).toHaveBeenCalledWith({ where: { id: 'loc-1' } });
    // A shelf is referenced by items and (as a basket) by other lines.
    expect(result.data).toEqual({ id: 'loc-1', detachedItems: 6 });
  });

  it('deleting a warehouse with shelves is blocked', async () => {
    const { service, prisma } = makeService();
    prisma.location.findUnique.mockResolvedValue({
      ...row({ type: 'warehouse' }),
      _count: { items: 0, children: 2 },
    });
    await expect(service.remove('loc-1')).rejects.toThrow(
      'ابتدا سبدها و قفسه‌های این محل را حذف یا به محل دیگری منتقل کنید',
    );
    expect(prisma.location.delete).not.toHaveBeenCalled();
  });


  /* ——— سبد (basket): the third level of the placement tree ——— */

  it('creates a سبد inside a قفسه and rejects one without a shelf', async () => {
    const { service, prisma } = makeService();
    prisma.location.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) => {
      if (where.id === 'shelf-1') return row({ id: 'shelf-1', parentId: 'wh-1' });
      if (where.id === 'wh-1') return row({ id: 'wh-1', type: 'warehouse' });
      return null;
    });
    const created = await service.create({
      name: 'سبد ۲',
      code: 'B-2',
      type: 'basket',
      parentId: 'shelf-1',
    });
    expect(prisma.location.create).toHaveBeenCalledWith({
      data: { name: 'سبد ۲', code: 'B-2', type: 'basket', parentId: 'shelf-1' },
    });
    expect(created.ok).toBe(true);
    // A basket with no shelf has no address at all.
    await expect(service.create({ name: 'سبد', code: 'B-3', type: 'basket' })).rejects.toThrow(
      'سبد باید داخل یک قفسه تعریف شود',
    );
    // …and neither does a basket hung straight off a warehouse.
    await expect(
      service.create({ name: 'سبد', code: 'B-4', type: 'basket', parentId: 'wh-1' }),
    ).rejects.toThrow('سبد باید داخل یک قفسه تعریف شود، نه مستقیماً داخل انبار');
  });

  it('keeps the tree three levels deep: no shelf under a basket, no basket under a basket', async () => {
    const { service, prisma } = makeService();
    prisma.location.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) => {
      if (where.id === 'basket-1') return row({ id: 'basket-1', type: 'basket', parentId: 'shelf-1' });
      if (where.id === 'shelf-1') return row({ id: 'shelf-1', parentId: 'wh-1' });
      return null;
    });
    await expect(
      service.create({ name: 'قفسه', code: 'C-1', parentId: 'basket-1' }),
    ).rejects.toThrow('قفسه نمی‌تواند داخل سبد باشد');
    await expect(
      service.create({ name: 'سبد', code: 'B-9', type: 'basket', parentId: 'basket-1' }),
    ).rejects.toThrow('سبد نمی‌تواند داخل سبد دیگری باشد');
    // A shelf that already holds baskets may still move to another warehouse.
    prisma.location.findMany.mockResolvedValue([{ type: 'basket' }]);
    prisma.location.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) => {
      if (where.id === 'shelf-1') return row({ id: 'shelf-1', parentId: 'wh-1' });
      if (where.id === 'wh-2') return row({ id: 'wh-2', type: 'warehouse' });
      return null;
    });
    const moved = await service.update('shelf-1', { parentId: 'wh-2' });
    expect(moved.ok).toBe(true);
  });

  it('refuses to turn a shelf with shelves into a basket (or a basket with children into anything)', async () => {
    const { service, prisma } = makeService();
    prisma.location.findUnique.mockResolvedValue(row({ id: 'loc-1', parentId: 'wh-1' }));
    prisma.location.findMany.mockResolvedValue([{ type: 'shelf' }]);
    await expect(service.update('loc-1', { type: 'basket', parentId: 'shelf-9' })).rejects.toThrow(
      'این محل قفسه دارد و نمی‌تواند سبد شود',
    );
    prisma.location.findMany.mockResolvedValue([{ type: 'basket' }]);
    prisma.location.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) => {
      if (where.id === 'loc-1') return row({ id: 'loc-1', type: 'basket', parentId: 'shelf-1' });
      if (where.id === 'shelf-9') return row({ id: 'shelf-9', parentId: 'wh-1' });
      return null;
    });
    // A basket already holding baskets may not be moved to another shelf.
    await expect(service.update('loc-1', { name: 'سبد ۱', parentId: 'shelf-9' })).rejects.toThrow(
      'سبد نمی‌تواند زیرمجموعه داشته باشد',
    );
    expect(prisma.location.update).not.toHaveBeenCalled();
  });

  it('deleting a سبد detaches the lines filed in it and keeps their stock', async () => {
    const { service, prisma } = makeService();
    prisma.location.findUnique.mockResolvedValue({
      ...row({ type: 'basket', parentId: 'shelf-1' }),
      _count: { items: 0, basketItems: 5, children: 0 },
    });
    const result = await service.remove('loc-1', 'u1');
    expect(prisma.location.delete).toHaveBeenCalledWith({ where: { id: 'loc-1' } });
    expect(result.data).toEqual({ id: 'loc-1', detachedItems: 5 });
  });

  it('updating or deleting an unknown location returns 404', async () => {
    const { service } = makeService();
    await expect(service.update('nope', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('LocationService.list filters (پیکر قفسه/سبد در اپ)', () => {
  const makeList = () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { location: { findMany }, auditLog: { create: vi.fn() } };
    return { service: new LocationService(prisma as never), findMany };
  };

  it('returns only the requested level of the tree', async () => {
    const { service, findMany } = makeList();
    await service.list({ type: 'basket' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { type: 'basket' } }),
    );
  });

  it('narrows to the children of one location', async () => {
    const { service, findMany } = makeList();
    await service.list({ parentId: 'shelf-1' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { parentId: 'shelf-1' } }),
    );
  });

  it('rejects an unknown type instead of silently returning nothing', async () => {
    const { service } = makeList();
    await expect(service.list({ type: 'garage' })).rejects.toThrow('نوع محل معتبر نیست');
  });

  it('returns the whole tree when no filter is sent', async () => {
    const { service, findMany } = makeList();
    await service.list();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});
