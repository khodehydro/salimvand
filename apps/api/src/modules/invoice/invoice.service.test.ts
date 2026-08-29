import { describe, expect, it, vi } from 'vitest';
import { InvoiceService } from './invoice.service';
import { matchesPublicToken } from './public-token';

describe('InvoiceService', () => {
  it('builds an immutable invoice draft with secure public token', () => {
    const draft = new InvoiceService({} as never).buildDraft('INV-0001', [
      { inventoryItemId: 'i1', productName: 'قاب ستون', quantity: 2, unitPrice: 125000n },
    ]);
    expect(draft).toMatchObject({
      number: 'INV-0001',
      subtotal: 250000n,
      total: 250000n,
      items: [{ lineTotal: 250000n }],
    });
    expect(matchesPublicToken(draft.publicToken, draft.publicTokenHash)).toBe(true);
  });
  it('keeps product name and unit price as invoice snapshots', () => {
    const line = {
      inventoryItemId: 'i1',
      productName: 'قاب اولیه',
      quantity: 1,
      unitPrice: 90000n,
    };
    const draft = new InvoiceService({} as never).buildDraft('INV-0002', [line]);
    line.productName = 'نام تغییرکرده';
    line.unitPrice = 1n;
    expect(draft.items[0]).toMatchObject({
      productName: 'قاب اولیه',
      unitPrice: 90000n,
      lineTotal: 90000n,
    });
  });
  it('returns a public invoice without internal inventory identifiers', async () => {
    const invoice = {
      id: 'inv-1',
      number: 'INV-0005',
      status: 'issued',
      publicTokenExpiresAt: new Date(Date.now() + 86_400_000),
      customerName: 'علی',
      customerMobile: '0912',
      subtotal: 100n,
      discount: 0n,
      total: 100n,
      paymentStatus: 'unpaid',
      paymentMethod: null,
      paidAmount: 0n,
      paidAt: null,
      issuedAt: new Date(),
      voidedAt: null,
      items: [
        {
          productName: 'لنت',
          quantity: 1,
          unitPrice: 100n,
          lineTotal: 100n,
          inventoryItem: { brand: { name: 'اصلی' } },
        },
      ],
    };
    const prisma = { invoice: { findFirst: async () => invoice } };
    const result = await new InvoiceService(prisma as never).getPublic('short-code');
    expect(result.data.items[0]).toMatchObject({ productName: 'لنت', brand: 'اصلی' });
    expect(result.data.items[0]).not.toHaveProperty('inventoryItemId');
    expect(result.data).not.toHaveProperty('id');
  });
  it('rejects malformed or unsafe invoice drafts', () => {
    const service = new InvoiceService({} as never);
    const line = { inventoryItemId: 'i1', productName: 'قطعه', quantity: 1, unitPrice: 100n };
    expect(() => service.buildDraft('bad', [line])).toThrow();
    expect(() => service.buildDraft('INV-0003', [])).toThrow();
    expect(() => service.buildDraft('INV-0004', [line, line])).toThrow(
      'قلم موجودی نمی‌تواند در چند ردیف تکرار شود',
    );
  });
  it('atomically decrements every stock item before creating the invoice', async () => {
    const invoiceCreate = vi.fn(async () => ({ id: 'invoice-1', number: 'INV-000001', items: [] }));
    const decrements = vi.fn(async (_args: unknown) => ({ count: 1 }));
    const tx = {
      counter: { upsert: vi.fn(async () => ({ lastValue: 1 })) },
      inventoryItem: {
        updateMany: decrements,
        findUniqueOrThrow: vi.fn(async () => ({ quantity: 3 })),
      },
      invoice: { create: invoiceCreate },
      inventoryTransaction: { create: vi.fn(), updateMany: vi.fn() },
    };
    const prisma = {
      inventoryItem: {
        findMany: vi.fn(async () => [
          { id: 'item-1', product: { name: 'لنت' } },
          { id: 'item-2', product: { name: 'فیلتر' } },
        ]),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const result = await new InvoiceService(prisma as never).create(
      {
        items: [
          { inventoryItemId: 'item-1', quantity: 2, unitPrice: 100 },
          { inventoryItemId: 'item-2', quantity: 1, unitPrice: 200 },
        ],
      },
      'user-1',
    );
    expect(result.data.number).toBe('INV-000001');
    expect(decrements).toHaveBeenCalledTimes(2);
    expect(decrements.mock.calls[0][0]).toMatchObject({
      where: { id: 'item-1', quantity: { gte: 2 }, isActive: true },
    });
    expect(decrements.mock.calls[1][0]).toMatchObject({
      where: { id: 'item-2', quantity: { gte: 1 }, isActive: true },
    });
    expect(invoiceCreate).toHaveBeenCalledTimes(1);
  });

  it('does not create an invoice when a later stock decrement fails', async () => {
    const invoiceCreate = vi.fn();
    let call = 0;
    const tx = {
      counter: { upsert: vi.fn(async () => ({ lastValue: 2 })) },
      inventoryItem: { updateMany: vi.fn(async () => ({ count: ++call === 1 ? 1 : 0 })) },
      invoice: { create: invoiceCreate },
      inventoryTransaction: { create: vi.fn(), updateMany: vi.fn() },
    };
    const prisma = {
      inventoryItem: {
        findMany: vi.fn(async () => [
          { id: 'item-1', product: { name: 'لنت' } },
          { id: 'item-2', product: { name: 'فیلتر' } },
        ]),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    await expect(
      new InvoiceService(prisma as never).create(
        {
          items: [
            { inventoryItemId: 'item-1', quantity: 2, unitPrice: 100 },
            { inventoryItemId: 'item-2', quantity: 1, unitPrice: 200 },
          ],
        },
        'user-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_STOCK' } });
    expect(invoiceCreate).not.toHaveBeenCalled();
    expect(tx.inventoryItem.updateMany).toHaveBeenCalledTimes(2);
  });
  it('rejects a payment that would exceed the invoice total', async () => {
    const update = vi.fn();
    const tx = {
      invoice: {
        findUnique: vi.fn(async () => ({
          id: 'invoice-1',
          status: 'issued',
          paidAmount: 800n,
          total: 1000n,
        })),
        update,
      },
      payments: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    await expect(
      new InvoiceService(prisma as never).pay('invoice-1', 201, 'cash', 'user-1'),
    ).rejects.toThrow('مجموع پرداخت بیشتر از مبلغ فاکتور است');
    expect(update).not.toHaveBeenCalled();
  });

  it('records a partial payment atomically', async () => {
    const update = vi.fn(async () => ({
      id: 'invoice-1',
      paymentStatus: 'partial',
      paidAmount: 600n,
      items: [],
    }));
    const executeRaw = vi.fn(async () => 1);
    const tx = {
      invoice: {
        findUnique: vi.fn(async () => ({
          id: 'invoice-1',
          number: 'INV-1',
          status: 'issued',
          paidAmount: 500n,
          total: 1000n,
          paymentStatus: 'unpaid',
          customerMobile: null,
        })),
        update,
      },
      payments: { create: vi.fn() },
      $executeRawUnsafe: executeRaw,
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const result = await new InvoiceService(prisma as never).pay(
      'invoice-1',
      100,
      'card',
      'user-1',
    );
    expect(result.data.paymentStatus).toBe('partial');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paidAmount: 600n,
          paymentStatus: 'partial',
          paymentMethod: 'card',
        }),
      }),
    );
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects a return greater than the purchased quantity', async () => {
    const tx = {
      invoice: {
        findUnique: vi.fn(async () => ({
          status: 'issued',
          items: [{ id: 'line-1', quantity: 2, unitPrice: 100n, inventoryItemId: 'item-1' }],
        })),
      },
      returnRecord: {
        aggregate: vi.fn(async () => ({ _sum: { quantity: 2, refundAmount: 200n } })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    await expect(
      new InvoiceService(prisma as never).returnItems(
        'invoice-1',
        { invoiceItemId: 'line-1', quantity: 1, reason: 'تعویض' },
        'user-1',
      ),
    ).rejects.toThrow('تعداد مرجوعی بیشتر از تعداد خریداری‌شده است');
  });

  it('restocks a valid partial return inside the transaction', async () => {
    const inventoryUpdate = vi.fn(async () => ({ quantity: 6 }));
    const returnCreate = vi.fn(async () => ({ id: 'return-1', quantity: 1, refundAmount: 100n }));
    const tx = {
      invoice: {
        findUnique: vi.fn(async () => ({
          id: 'invoice-1',
          status: 'issued',
          items: [{ id: 'line-1', quantity: 2, unitPrice: 100n, inventoryItemId: 'item-1' }],
        })),
      },
      returnRecord: {
        aggregate: vi.fn(async () => ({ _sum: { quantity: 0, refundAmount: 0n } })),
        create: returnCreate,
      },
      inventoryItem: { update: inventoryUpdate },
      inventoryTransaction: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const result = await new InvoiceService(prisma as never).returnItems(
      'invoice-1',
      { invoiceItemId: 'line-1', quantity: 1, reason: 'تعویض' },
      'user-1',
    );
    expect(result.data.quantityAfter).toBe(6);
    expect(inventoryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'item-1' }, data: { quantity: { increment: 1 } } }),
    );
    expect(returnCreate).toHaveBeenCalledTimes(1);
  });

  it('restores all invoice quantities when voiding', async () => {
    const updates = vi.fn(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      quantity: 4,
    }));
    const invoiceUpdate = vi.fn(async () => ({ id: 'invoice-1', status: 'voided', items: [] }));
    const tx = {
      inventoryItem: { update: updates },
      inventoryTransaction: { create: vi.fn() },
      invoice: { update: invoiceUpdate },
    };
    const prisma = {
      invoice: {
        findUnique: vi.fn(async () => ({
          id: 'invoice-1',
          status: 'issued',
          number: 'INV-1',
          items: [
            { inventoryItemId: 'item-1', quantity: 2 },
            { inventoryItemId: 'item-2', quantity: 1 },
          ],
        })),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const result = await new InvoiceService(prisma as never).void('invoice-1', 'user-1');
    expect(result.data.status).toBe('voided');
    expect(updates).toHaveBeenCalledTimes(2);
    expect(invoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'voided' }) }),
    );
  });
});

describe('InvoiceService.resendSms', () => {
  const invoice = {
    id: 'inv-9',
    number: 'INV-000009',
    status: 'issued',
    total: 4_500_000n,
    customerMobile: '09123456789',
  };
  const harness = (record = invoice) => {
    const update = vi.fn(async (_args?: unknown) => record);
    const enqueue = vi.fn(async (_job?: unknown) => ({ id: 'job-1' }));
    const prisma = {
      invoice: { findUnique: async () => record, update },
      $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
        run({ invoice: { update }, auditLog: { create: async () => undefined } }),
    };
    const service = new InvoiceService(prisma as never, { enqueue } as never);
    return { service, update, enqueue };
  };

  it('rotates the public link and queues the SMS with the new short code', async () => {
    const { service, update, enqueue } = harness();
    const result = await service.resendSms('inv-9', 'user-1');
    const call = update.mock.calls[0][0] as {
      data: { publicShortCodeHash: string; publicTokenHash: string; publicTokenExpiresAt: Date };
    };
    expect(matchesPublicToken(result.data.publicShortCode, call.data.publicShortCodeHash)).toBe(
      true,
    );
    expect(matchesPublicToken(result.data.publicToken, call.data.publicTokenHash)).toBe(true);
    expect(call.data.publicTokenExpiresAt.getTime()).toBeGreaterThan(
      Date.now() + 29 * 24 * 60 * 60 * 1000,
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0] as any).toMatchObject({
      type: 'invoice.issued',
      invoiceId: 'inv-9',
      mobile: '09123456789',
    });
    expect((enqueue.mock.calls[0][0] as any).message).toContain(
      `/i/${result.data.publicShortCode}`,
    );
  });

  it('accepts a corrected mobile and stores it on the invoice', async () => {
    const { service, update, enqueue } = harness();
    await service.resendSms('inv-9', 'user-1', '09351112233');
    const call = update.mock.calls[0][0] as { data: { customerMobile?: string } };
    expect(call.data.customerMobile).toBe('09351112233');
    expect((enqueue.mock.calls[0][0] as any).mobile).toBe('09351112233');
  });

  it('refuses to send without a valid mobile number', async () => {
    const { service, enqueue } = harness({ ...invoice, customerMobile: '123' });
    await expect(service.resendSms('inv-9', 'user-1')).rejects.toThrow('شماره موبایل معتبری');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('refuses to resend a voided invoice', async () => {
    const { service, enqueue } = harness({ ...invoice, status: 'voided' });
    await expect(service.resendSms('inv-9', 'user-1')).rejects.toThrow('باطل‌شده');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('fails loudly when the notification queue is not wired', async () => {
    const prisma = {
      invoice: { findUnique: async () => invoice, update: vi.fn() },
      $transaction: vi.fn(),
    };
    await expect(new InvoiceService(prisma as never).resendSms('inv-9', 'user-1')).rejects.toThrow(
      'صف اعلان‌ها',
    );
  });
});

describe('InvoiceService.getPublic document payload', () => {
  const invoice = {
    id: 'inv-1',
    number: 'INV-0007',
    status: 'issued',
    publicTokenExpiresAt: new Date(Date.now() + 86_400_000),
    customerName: 'علی',
    customerMobile: '09123456789',
    subtotal: 300n,
    discount: 0n,
    total: 300n,
    paymentStatus: 'partial',
    paymentMethod: 'cash',
    paidAmount: 100n,
    paidAt: null,
    issuedAt: new Date(),
    voidedAt: null,
    items: [
      {
        productName: 'لنت',
        quantity: 1,
        unitPrice: 300n,
        lineTotal: 300n,
        inventoryItem: { brand: { name: 'اصلی' } },
      },
    ],
    payments: [{ amount: 100n, method: 'card', receivedAt: new Date('2026-08-20T10:00:00Z') }],
    issuedBy: { name: 'رضا سلیم‌وند' },
  };

  it('adds the sales person, the payment list and the link expiry', async () => {
    const prisma = { invoice: { findFirst: async () => invoice } };
    const { data } = await new InvoiceService(prisma as never).getPublic('short-code');
    expect(data.salesPerson).toBe('رضا سلیم‌وند');
    expect(data.payments).toEqual([
      { amount: 100n, method: 'card', paidAt: new Date('2026-08-20T10:00:00Z') },
    ]);
    expect(data.linkExpiresAt).toEqual(invoice.publicTokenExpiresAt);
  });

  it('still hides the row id and every token hash', async () => {
    const prisma = {
      invoice: {
        findFirst: async () => ({
          ...invoice,
          publicTokenHash: 'deadbeef',
          publicShortCodeHash: 'cafe',
        }),
      },
    };
    const { data } = await new InvoiceService(prisma as never).getPublic('short-code');
    expect(data).not.toHaveProperty('id');
    expect(data).not.toHaveProperty('publicTokenHash');
    expect(data).not.toHaveProperty('publicShortCodeHash');
    expect(
      JSON.stringify(data, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
    ).not.toContain('deadbeef');
  });
});
