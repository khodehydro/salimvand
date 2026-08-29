import { describe, expect, it } from 'vitest';
import { calculateSupplierDebt } from './suppliers.service';
import { SuppliersService } from './suppliers.service';
import type { PrismaService } from '../../prisma.service';

describe('SuppliersService', () => {
  const service = new SuppliersService({} as PrismaService);

  it('requires a supplier name before writing', async () => {
    await expect(service.create({ name: '  ' }, 'actor-id')).rejects.toThrow(
      'نام تأمین‌کننده الزامی است',
    );
  });

  it('rejects an empty update before writing', async () => {
    const prisma = {
      supplier: {
        findFirst: async () => ({ id: 'supplier-id', name: 'تأمین‌کننده', isActive: true }),
      },
    };
    await expect(
      new SuppliersService(prisma as unknown as PrismaService).update(
        'supplier-id',
        {},
        'actor-id',
      ),
    ).rejects.toThrow('تغییری برای ذخیره ارسال نشده است');
  });

  it('calculates outstanding supplier debt from purchase invoices', () => {
    expect(
      calculateSupplierDebt([
        { total: 5000n, paidAmount: 1000n },
        { total: 2000n, paidAmount: 2000n },
      ]),
    ).toBe(4000n);
  });

  it('does not report debt for fully paid purchases', () => {
    expect(calculateSupplierDebt([{ total: 5000n, paidAmount: 5000n }])).toBe(0n);
  });
});
