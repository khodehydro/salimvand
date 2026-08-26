import { describe, expect, it } from 'vitest';
import { PurchaseService } from './purchase.service';
import type { PrismaService } from '../../prisma.service';

describe('PurchaseService validation', () => {
  const service = new PurchaseService({} as PrismaService);

  it('requires a supplier and at least one line', async () => {
    await expect(service.create('', [], 0, 'actor-id')).rejects.toThrow('تأمین‌کننده و حداقل یک قلم خرید الزامی است');
  });

  it('rejects non-integer rial prices before opening a transaction', async () => {
    await expect(service.create('supplier-id', [{ inventoryItemId: 'item-id', quantity: 1, unitPrice: '12.5' }], 0, 'actor-id')).rejects.toThrow('قیمت خرید معتبر نیست');
  });

  it('rejects negative paid amounts', async () => {
    await expect(service.create('supplier-id', [{ inventoryItemId: 'item-id', quantity: 1, unitPrice: 100 }], -1, 'actor-id')).rejects.toThrow('مبلغ پرداخت معتبر نیست');
  });
});
