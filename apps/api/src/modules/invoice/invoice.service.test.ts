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
      // Row lock taken by returnItems before the over-return aggregate.
      $queryRaw: vi.fn(async () => [{ id: 'invoice-1' }]),
      invoice: {
        findUnique: vi.fn(async () => ({
          id: 'invoice-1',
          status: 'issued',
          paidAmount: 800n,
          total: 1000n,
        })),
        update,
      },
      returnRecord: { aggregate: vi.fn(async () => ({ _sum: { refundAmount: 0n } })) },
      payments: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    await expect(
      new InvoiceService(prisma as never).pay('invoice-1', 201, 'cash', 'user-1'),
    ).rejects.toThrow('مجموع پرداخت بیشتر از مبلغ فاکتور پس از برگشتی‌ها است');
    expect(update).not.toHaveBeenCalled();
  });

  it('records a partial payment atomically', async () => {
    const update = vi.fn(async () => ({
      id: 'invoice-1',
      paymentStatus: 'partial',
      paidAmount: 600n,
      items: [],
    }));
    const paymentCreate = vi.fn(async () => ({}));
    const tx = {
      // Row lock taken by returnItems before the over-return aggregate.
      $queryRaw: vi.fn(async () => [{ id: 'invoice-1' }]),
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
      returnRecord: { aggregate: vi.fn(async () => ({ _sum: { refundAmount: 0n } })) },
      payment: { create: paymentCreate },
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
    expect((result.data as { paymentStatus?: string }).paymentStatus).toBe('partial');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paidAmount: 600n,
          paymentStatus: 'partial',
          paymentMethod: 'card',
        }),
      }),
    );
    expect(paymentCreate).toHaveBeenCalledWith({
      data: {
        invoiceId: 'invoice-1',
        amount: 100n,
        method: 'card',
        receivedById: 'user-1',
      },
    });
  });

  it('rejects a return greater than the purchased quantity', async () => {
    const tx = {
      // Row lock taken by returnItems before the over-return aggregate.
      $queryRaw: vi.fn(async () => [{ id: 'invoice-1' }]),
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
    const invoiceUpdate = vi.fn();
    const tx = {
      // Row lock taken by returnItems before the over-return aggregate.
      $queryRaw: vi.fn(async () => [{ id: 'invoice-1' }]),
      invoice: {
        findUnique: vi.fn(async () => ({
          id: 'invoice-1',
          status: 'issued',
          total: 200n,
          paidAmount: 0n,
          paymentStatus: 'unpaid',
          paidAt: null,
          items: [{ id: 'line-1', quantity: 2, unitPrice: 100n, inventoryItemId: 'item-1' }],
        })),
        update: invoiceUpdate,
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
    // Unpaid invoice stays unpaid after a partial return — no phantom write.
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });

  it('locks the invoice row before reading previous returns (race safety)', async () => {
    const queryRaw = vi.fn(async () => [{ id: 'invoice-1' }]);
    const aggregate = vi.fn(async () => ({ _sum: { quantity: 0, refundAmount: 0n } }));
    const tx = {
      $queryRaw: queryRaw,
      invoice: {
        findUnique: vi.fn(async () => ({
          id: 'invoice-1',
          status: 'issued',
          total: 200n,
          paidAmount: 0n,
          paymentStatus: 'unpaid',
          paidAt: null,
          items: [{ id: 'line-1', quantity: 2, unitPrice: 100n, inventoryItemId: 'item-1' }],
        })),
        update: vi.fn(),
      },
      returnRecord: { aggregate, create: vi.fn(async () => ({ id: 'return-9' })) },
      inventoryItem: { update: vi.fn(async () => ({ quantity: 6 })) },
      inventoryTransaction: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    await new InvoiceService(prisma as never).returnItems(
      'invoice-1',
      { invoiceItemId: 'line-1', quantity: 1, reason: 'تعویض' },
      'user-1',
    );
    // The FOR UPDATE row lock is the first statement of the transaction, so a
    // concurrent return of the same invoice waits and then sees this one's
    // rows in its aggregate — two "return the last item" requests can never
    // both apply.
    const call = queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, string];
    expect(String(call[0])).toContain('FOR UPDATE');
    // One parameterized id: the template has a string before and after it.
    expect(call[0]).toHaveLength(2);
    expect(call[1]).toBe('invoice-1');
    expect(aggregate.mock.invocationCallOrder[0]).toBeGreaterThan(
      queryRaw.mock.invocationCallOrder[0],
    );
  });

  it('rejects a return on a voided invoice', async () => {
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: 'invoice-1' }]),
      invoice: { findUnique: vi.fn(async () => ({ status: 'voided', items: [] })) },
      returnRecord: { aggregate: vi.fn(), create: vi.fn() },
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
    ).rejects.toThrow('فاکتور فعال پیدا نشد');
    expect(tx.returnRecord.create).not.toHaveBeenCalled();
  });

  it('settles the payment status when a return covers the remaining debt', async () => {
    const invoiceUpdate = vi.fn(async () => ({ id: 'invoice-1' }));
    const returnCreate = vi.fn(async () => ({ id: 'return-3', quantity: 1, refundAmount: 100n }));
    // First aggregate = line guard (nothing returned yet); second aggregate =
    // the post-return recompute (100n refunded → net 100n, paid 100n → paid).
    const aggregate = vi
      .fn()
      .mockResolvedValueOnce({ _sum: { quantity: 0, refundAmount: 0n } })
      .mockResolvedValueOnce({ _sum: { quantity: 1, refundAmount: 100n } });
    const tx = {
      // Row lock taken by returnItems before the over-return aggregate.
      $queryRaw: vi.fn(async () => [{ id: 'invoice-1' }]),
      invoice: {
        findUnique: vi.fn(async () => ({
          id: 'invoice-1',
          status: 'issued',
          total: 200n,
          paidAmount: 100n,
          paymentStatus: 'partial',
          paidAt: null,
          items: [{ id: 'line-1', quantity: 2, unitPrice: 100n, inventoryItemId: 'item-1' }],
        })),
        update: invoiceUpdate,
      },
      returnRecord: { aggregate, create: returnCreate },
      inventoryItem: { update: vi.fn(async () => ({ quantity: 6 })) },
      inventoryTransaction: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    await new InvoiceService(prisma as never).returnItems(
      'invoice-1',
      { invoiceItemId: 'line-1', quantity: 1, reason: 'مغایرت' },
      'user-1',
    );
    expect(invoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'invoice-1' },
        data: expect.objectContaining({ paymentStatus: 'paid' }),
      }),
    );
  });

  it('computes net totals after partial returns for the public payload', async () => {
    const invoice = {
      id: 'inv-2',
      number: 'INV-0006',
      status: 'issued',
      publicTokenExpiresAt: new Date(Date.now() + 86_400_000),
      customerName: 'علی',
      customerMobile: '0912',
      storeAddress: 'میاندوآب، خیابان اصلی',
      customerAddress: 'میاندوآب، محلهٔ جدید',
      subtotal: 300n,
      discount: 0n,
      total: 300n,
      paymentStatus: 'paid',
      paymentMethod: null,
      paidAmount: 300n,
      paidAt: null,
      issuedAt: new Date(),
      voidedAt: null,
      items: [
        {
          id: 'line-1',
          productName: 'لنت جلو پژو',
          quantity: 3,
          unitPrice: 100n,
          lineTotal: 300n,
          inventoryItem: { brand: { name: 'اصلی' } },
        },
      ],
      // 1 of the 3 brake pads returned — damaged, so it never re-entered stock.
      returns: [{ invoiceItemId: 'line-1', quantity: 1, refundAmount: 100n }],
      payments: [],
      issuedBy: { name: 'فروشنده' },
    };
    const prisma = { invoice: { findFirst: async () => invoice } };
    const result = await new InvoiceService(prisma as never).getPublic('short-code');
    expect(result.data.returnedTotal).toBe(100n);
    expect(result.data.netTotal).toBe(200n);
    expect(result.data.items[0].returnedQuantity).toBe(1);
    expect(result.data.storeAddress).toBe('میاندوآب، خیابان اصلی');
    expect(result.data.customerAddress).toBe('میاندوآب، محلهٔ جدید');
    // The raw returns (with internal line ids) must never leak publicly.
    expect(result.data).not.toHaveProperty('returns');
    expect(
      JSON.stringify(result.data, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    ).not.toContain('invoiceItemId');
  });

  it('caps new payments at the net amount after returns', async () => {
    const update = vi.fn();
    const tx = {
      // Row lock taken by returnItems before the over-return aggregate.
      $queryRaw: vi.fn(async () => [{ id: 'invoice-1' }]),
      invoice: {
        findUnique: vi.fn(async () => ({
          id: 'invoice-1',
          status: 'issued',
          paidAmount: 100n,
          total: 300n,
          customerMobile: null,
        })),
        update,
      },
      // 100 of 300 already returned: the customer can only owe 200 more.
      returnRecord: { aggregate: vi.fn(async () => ({ _sum: { refundAmount: 100n } })) },
      payments: { create: vi.fn() },
      $executeRawUnsafe: vi.fn(),
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    await expect(
      new InvoiceService(prisma as never).pay('invoice-1', 201, 'cash', 'user-1'),
    ).rejects.toThrow('مجموع پرداخت بیشتر از مبلغ فاکتور پس از برگشتی‌ها است');
    expect(update).not.toHaveBeenCalled();
  });

  it('marks a damaged return without restocking the warehouse', async () => {
    const inventoryUpdate = vi.fn();
    const returnCreate = vi.fn(async () => ({ id: 'return-2', quantity: 1, refundAmount: 100n }));
    const tx = {
      // Row lock taken by returnItems before the over-return aggregate.
      $queryRaw: vi.fn(async () => [{ id: 'invoice-1' }]),
      invoice: {
        findUnique: vi.fn(async () => ({
          id: 'invoice-1',
          status: 'issued',
          total: 300n,
          paidAmount: 300n,
          paymentStatus: 'paid',
          paidAt: new Date('2026-08-01'),
          items: [{ id: 'line-1', quantity: 3, unitPrice: 100n, inventoryItemId: 'item-1' }],
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
      { invoiceItemId: 'line-1', quantity: 1, reason: 'خرابی قطعه', restock: false },
      'user-1',
    );
    // Damaged goods must NOT go back into sellable stock.
    expect(inventoryUpdate).not.toHaveBeenCalled();
    expect(returnCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ restock: false, quantity: 1 }) }),
    );
    expect(result.data.quantityAfter).toBe(0);
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

  it('creates a customer from the issue flow with address and notes', async () => {
    const upsert = vi.fn(async () => ({ id: 'customer-1' }));
    const prisma = { customer: { upsert } };
    await new InvoiceService(prisma as never).createCustomer({
      name: 'حسن رضایی',
      mobile: '09121234567',
      address: 'تهران، خیابان نمونه، پلاک ۱۲',
      notes: 'مشتری تعمیرگاه',
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { mobile: '09121234567' },
        create: {
          name: 'حسن رضایی',
          mobile: '09121234567',
          address: 'تهران، خیابان نمونه، پلاک ۱۲',
          notes: 'مشتری تعمیرگاه',
        },
      }),
    );
  });

  it('keeps an existing customer address unless the request carries one', async () => {
    // Duplicate mobiles upsert into the same row — never a second customer.
    const upsert = vi.fn(
      async (_args: {
        where: { mobile: string };
        create: { name: string; mobile: string; address?: string; notes?: string };
        update: { name: string; address?: string | null; notes?: string | null };
      }) => ({ id: 'customer-1' }),
    );
    const prisma = { customer: { upsert } };
    // No address/notes in the request → the saved profile stays untouched.
    await new InvoiceService(prisma as never).createCustomer({
      name: 'حسن رضایی',
      mobile: '09121234567',
    });
    expect(upsert.mock.calls[0]?.[0].update).toEqual({ name: 'حسن رضایی' });
    // An explicit (even empty) value is applied — empty clears the field.
    await new InvoiceService(prisma as never).createCustomer({
      name: 'حسن رضایی',
      mobile: '09121234567',
      address: '',
      notes: 'مشتری تعمیرگاه',
    });
    expect(upsert.mock.calls[1]?.[0].update).toEqual({
      name: 'حسن رضایی',
      address: null,
      notes: 'مشتری تعمیرگاه',
    });
  });

  it('returns the customer address in the issue-form customer list', async () => {
    const rows = [
      {
        id: 'customer-1',
        name: 'حسن رضایی',
        mobile: '09121234567',
        address: 'تهران، خیابان نمونه، پلاک ۱۲',
        notes: null,
        isActive: true,
        createdAt: new Date('2026-09-18T12:00:00Z'),
      },
    ];
    const queryRawUnsafe = vi.fn(async (_query: string, _pattern: string) => rows);
    const prisma = { $queryRawUnsafe: queryRawUnsafe };
    const result = await new InvoiceService(prisma as never).customers('');
    expect(result.data[0].address).toBe('تهران، خیابان نمونه، پلاک ۱۲');
    const [sql] = queryRawUnsafe.mock.calls[0] ?? [];
    expect(sql).toContain('"address"');
    // An empty search still lists the latest customers for the picker.
    expect(sql).toContain('LIMIT 100');
    expect(queryRawUnsafe.mock.calls[0]?.[1]).toBe('%');
  });

  it('snapshots the invoice address and links the customer without rewriting the profile', async () => {
    const invoiceCreate = vi.fn(async () => ({
      id: 'invoice-1',
      number: 'INV-000001',
      items: [],
    }));
    const invoiceUpdate = vi.fn(async () => ({}));
    const customerUpsert = vi.fn(async () => ({ id: 'customer-1' }));
    const tx = {
      counter: { upsert: vi.fn(async () => ({ lastValue: 1 })) },
      inventoryItem: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => ({ quantity: 3 })),
      },
      invoice: { create: invoiceCreate, update: invoiceUpdate },
      customer: { upsert: customerUpsert },
      inventoryTransaction: { create: vi.fn(), updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
      syncChange: { create: vi.fn() },
    };
    const prisma = {
      inventoryItem: {
        findMany: vi.fn(async () => [{ id: 'item-1', product: { name: 'لنت' } }]),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    await new InvoiceService(prisma as never).create(
      {
        items: [{ inventoryItemId: 'item-1', quantity: 1, unitPrice: 100 }],
        customerName: 'حسن رضایی',
        customerMobile: '09121234567',
        // One-off delivery address for this invoice only.
        customerAddress: 'تهران، تحویل کارخانه، درب ۳',
      },
      'user-1',
    );
    // The invoice keeps its own address snapshot.
    expect(invoiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerName: 'حسن رضایی',
          customerMobile: '09121234567',
          customerAddress: 'تهران، تحویل کارخانه، درب ۳',
        }),
      }),
    );
    // A brand-new inline customer also gets the address on its profile…
    expect(customerUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { mobile: '09121234567' },
        create: expect.objectContaining({
          address: 'تهران، تحویل کارخانه، درب ۳',
        }),
        // …but an existing customer's profile is never rewritten by a sale:
        // the update branch carries the name only.
        update: { name: 'حسن رضایی' },
      }),
    );
    expect(invoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { customerId: 'customer-1' } }),
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
        run({
          invoice: { update, findUnique: async () => ({ ...record, items: [] }) },
          auditLog: { create: async () => undefined },
        }),
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

describe('InvoiceService.list and panel link/pdf actions', () => {
  it('lists invoices without leaking token hashes', async () => {
    const rows = [
      {
        id: 'inv-1',
        number: 'INV-000001',
        status: 'issued',
        customerName: 'علی',
        customerMobile: '09123456789',
        subtotal: 100n,
        discount: 0n,
        total: 100n,
        paidAmount: 50n,
        paymentStatus: 'partial',
        paymentMethod: null,
        paidAt: null,
        issuedAt: new Date(),
        voidedAt: null,
        publicTokenExpiresAt: null,
        items: [
          {
            productName: 'لنت ترمز',
            quantity: 1,
            unitPrice: 100n,
            lineTotal: 100n,
            inventoryItem: { brand: { name: 'ایساکو' } },
          },
        ],
      },
    ];
    const prisma = {
      invoice: {
        findMany: vi.fn(async () => rows),
        findUnique: vi.fn(),
      },
    };
    const result = await new InvoiceService(prisma as never).list();
    const serialized = JSON.stringify(result, (_key, value) =>
      typeof value === 'bigint' ? String(value) : value,
    );
    expect(serialized).not.toContain('publicTokenHash');
    expect(serialized).not.toContain('publicShortCodeHash');
    expect(result.data[0].items[0].inventoryItem.brand?.name).toBe('ایساکو');
  });

  it('rotates the public link for panel viewing with an audit trail', async () => {
    const update = vi.fn(async (_args?: unknown) => undefined);
    const auditCreate = vi.fn(async (_args?: unknown) => undefined);
    const prisma = {
      invoice: {
        findUnique: async () => ({ id: 'inv-2', status: 'issued' }),
        update,
      },
      $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
        run({ invoice: { update }, auditLog: { create: auditCreate } }),
    };
    const result = await new InvoiceService(prisma as never).rotateLink('inv-2', 'user-1');
    const call = update.mock.calls[0][0] as {
      data: { publicTokenHash: string; publicShortCodeHash: string; publicTokenExpiresAt: Date };
    };
    expect(matchesPublicToken(result.data.publicToken, call.data.publicTokenHash)).toBe(true);
    expect(matchesPublicToken(result.data.publicShortCode, call.data.publicShortCodeHash)).toBe(
      true,
    );
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it('refuses to issue a public link for a voided invoice', async () => {
    const prisma = {
      invoice: { findUnique: async () => ({ id: 'inv-3', status: 'voided' }) },
    };
    await expect(new InvoiceService(prisma as never).rotateLink('inv-3', 'user-1')).rejects.toThrow(
      'باطل‌شده',
    );
  });

  it('renders the panel PDF from the database row with brand names', async () => {
    const invoice = {
      number: 'INV-000012',
      customerName: 'رضا',
      customerMobile: '09121112233',
      storeAddress: 'میاندوآب، خیابان اصلی',
      storePhone: '041-12345678',
      customerAddress: 'میاندوآب، محلهٔ جدید',
      subtotal: 500_000n,
      discount: 50_000n,
      total: 450_000n,
      paymentStatus: 'paid',
      paidAmount: 450_000n,
      issuedAt: new Date('2026-08-01T10:00:00Z'),
      items: [
        {
          productName: 'فیلتر روغن',
          quantity: 2,
          unitPrice: 250_000n,
          lineTotal: 500_000n,
          inventoryItem: { brand: { name: 'سرام' } },
        },
      ],
    };
    const prisma = { invoice: { findUnique: async () => invoice } };
    const file = await new InvoiceService(prisma as never).pdfById('inv-12');
    expect(file.length).toBeGreaterThan(500);
    expect(file.subarray(0, 5).toString()).toBe('%PDF-');
    // The bundled Vazirmatn font (with Persian presentation forms) must be
    // embedded — the old DejaVu/Helvetica fallback produced garbled output.
    expect(file.toString('latin1')).toContain('Vazirmatn');
  });

  it('shapes every Persian line drawn into the PDF (labels included)', async () => {
    // Regression for the "completely broken" PDF: only values were passed
    // through faText, so every label (فاکتور فروشگاه سلیم وند, جمع اقلام: …)
    // rendered as reversed disconnected letters.
    const PDFDocument = require('pdfkit');
    const originalText = PDFDocument.prototype.text;
    const originalFont = PDFDocument.prototype.font;
    const drawn: string[] = [];
    PDFDocument.prototype.text = function (str: string, ...rest: unknown[]) {
      drawn.push(String(str));
      return originalText.call(this, str, ...rest);
    };
    // Spy on the fontkit layout engine: pdfkit word-splits text and fontkit
    // reverses every Arabic word when the run direction is rtl — which
    // mirrors words that faText already put in visual order. renderPdf must
    // force the direction to ltr on the embedded font instance.
    const directions: (string | undefined)[] = [];
    PDFDocument.prototype.font = function (...args: unknown[]) {
      const result = originalFont.apply(this, args);
      const engine = (
        this as unknown as {
          _font?: { font?: { _layoutEngine?: { layout: (...a: unknown[]) => unknown } } };
        }
      )._font?.font?._layoutEngine;
      if (engine && !(engine as unknown as { __dirSpy?: boolean }).__dirSpy) {
        (engine as unknown as { __dirSpy?: boolean }).__dirSpy = true;
        const originalLayout = engine.layout.bind(engine);
        engine.layout = (...args: unknown[]) => {
          directions.push(args[4] as string | undefined);
          return originalLayout(...args);
        };
      }
      return result;
    };
    try {
      const service = new InvoiceService({} as never);
      // renderPdf stays private; reach it without widening the public API.
      const renderPdf = (
        service as unknown as {
          renderPdf: (invoice: unknown, qrDataUrl?: string) => Promise<Buffer>;
        }
      ).renderPdf;
      const buffer = await renderPdf(
        {
          number: '1405/00348',
          customerName: 'علی محمدی',
          customerMobile: '09123456789',
          storeAddress: 'میاندوآب، خیابان اصلی',
          storePhone: '041-1234567',
          customerAddress: null,
          subtotal: 150000000n,
          discount: 5000000n,
          total: 145000000n,
          returnedTotal: 20000000n,
          paymentStatus: 'partial',
          paidAmount: 90000000n,
          issuedAt: new Date('2026-09-01T10:00:00Z'),
          items: [
            {
              productName: 'لنت ترمز جلو پژو ۲۰۶',
              brand: 'ایساکو',
              quantity: 2,
              unitPrice: 50000000n,
              lineTotal: 100000000n,
            },
          ],
          returns: [
            {
              productName: 'فیلتر روغن',
              quantity: 1,
              refundAmount: 20000000n,
              restock: true,
              reason: 'مغایرت',
            },
          ],
        },
        undefined,
      );
      expect(buffer.length).toBeGreaterThan(1000);
    } finally {
      PDFDocument.prototype.text = originalText;
      PDFDocument.prototype.font = originalFont;
    }
    // presentation forms (FB50–FEFF) are outside the base Arabic block
    // Numeric-only table cells contain Persian digits but no letters to shape.
    // Assert shaping only on lines that actually contain Arabic/Persian letters.
    const persianLines = drawn.filter((line) =>
      /[\u0621-\u063A\u063F-\u064A\u067E\u0686\u0698\u06A9\u06AF\u06CC\uFB50-\uFEFF]/.test(line),
    );
    expect(persianLines.length).toBeGreaterThan(8);
    // No line may carry unshaped Persian LETTERS (digits/punctuation are fine).
    const unshapedLetter = /[\u0621-\u063A\u063F-\u064A\u067E\u0686\u0698\u06A9\u06AF\u06CC]/;
    for (const line of persianLines)
      expect(unshapedLetter.test(line), `unshaped line: ${line}`).toBe(false);
    // and every Persian line actually carries presentation forms
    for (const line of persianLines) expect(/[\uFB50-\uFEFF]/.test(line)).toBe(true);
    // the fontkit engine must never run rtl (it would mirror each word)
    expect(directions.length).toBeGreaterThan(0);
    for (const direction of directions) expect(direction).toBe('ltr');

    // Every drawn number is Persian — money grouped 3-by-3, phones/ids converted.
    const drawnText = drawn.join('\n');
    expect(drawnText).toContain('۱۰۰٬۰۰۰٬۰۰۰'); // 100000000n line total
    expect(drawnText).toContain('۵۰٬۰۰۰٬۰۰۰'); // 50000000n unit price
    expect(drawnText).toContain('۱۵۰٬۰۰۰٬۰۰۰'); // 150000000n subtotal
    expect(drawnText).toContain('۱۲۵٬۰۰۰٬۰۰۰'); // net total after returns (145M − 20M)
    expect(drawnText).toContain('۹۰٬۰۰۰٬۰۰۰'); // 90000000n paid
    expect(drawnText).toContain('۲۰٬۰۰۰٬۰۰۰'); // 20000000n refund
    expect(drawnText).toContain('۱۴۰۵/۰۰۳۴۸'); // invoice number in Persian digits
    expect(drawnText).toContain('۰۹۱۲۳۴۵۶۷۸۹'); // customer mobile in Persian digits
    // A hyphenated store phone stays readable as one LTR run (LRM-wrapped).
    expect(drawnText).toContain('۰۴۱-۱۲۳۴۵۶۷');
    // No ASCII digit runs survive in the drawn lines.
    expect(drawnText).not.toMatch(/\d{3,}/);
  });
});

describe('InvoiceService.returnContext (mobile return sheet)', () => {
  const createdAt = new Date('2026-09-18T10:15:00.000Z');
  const invoiceRow = {
    id: 'invoice-9',
    number: 'INV-1001',
    status: 'issued',
    paymentStatus: 'partial',
    total: 250000000n,
    paidAmount: 100000000n,
    items: [
      { id: 'line-1', productName: 'لنت ترمز جلو', quantity: 4, unitPrice: 10000000n },
      { id: 'line-2', productName: 'فیلتر روغن', quantity: 5, unitPrice: 30000000n },
    ],
    returns: [
      {
        id: 'ret-1',
        invoiceItemId: 'line-1',
        quantity: 1,
        refundAmount: 10000000n,
        reason: 'ناسازگاری با خودرو',
        restock: true,
        createdAt,
      },
    ],
  };
  const makePrisma = (
    invoice: unknown,
    aggregate = { _sum: { refundAmount: 10000000n } },
    perLine = [{ invoiceItemId: 'line-1', _sum: { quantity: 1 } }],
  ) => ({
    invoice: { findUnique: vi.fn(async () => invoice) },
    returnRecord: {
      aggregate: vi.fn(async () => aggregate),
      groupBy: vi.fn(async () => perLine),
    },
  });

  it('returns the narrow return-sheet payload with net totals and per-line return counts', async () => {
    const prisma = makePrisma(invoiceRow);
    const result = await new InvoiceService(prisma as never).returnContext('invoice-9');
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      id: 'invoice-9',
      number: 'INV-1001',
      status: 'issued',
      paymentStatus: 'partial',
      total: '250000000',
      paidAmount: '100000000',
      returnedTotal: '10000000',
      netTotal: '240000000',
      items: [
        {
          id: 'line-1',
          productName: 'لنت ترمز جلو',
          quantity: 4,
          unitPrice: '10000000',
          returnedQuantity: 1,
        },
        {
          id: 'line-2',
          productName: 'فیلتر روغن',
          quantity: 5,
          unitPrice: '30000000',
          returnedQuantity: 0,
        },
      ],
      returns: [
        {
          id: 'ret-1',
          invoiceItemId: 'line-1',
          quantity: 1,
          refundAmount: '10000000',
          reason: 'ناسازگاری با خودرو',
          restock: true,
          createdAt: createdAt.toISOString(),
        },
      ],
    });
    // The narrow read must never leak customer PII or payment history.
    const serialized = JSON.stringify(result.data);
    expect(serialized).not.toContain('customerMobile');
    expect(serialized).not.toContain('customerAddress');
    expect(serialized).not.toContain('customerName');
    expect(serialized).not.toContain('payments');
  });

  it('treats an invoice without returns as zero returned', async () => {
    const prisma = makePrisma(
      { ...invoiceRow, returns: [] },
      // Prisma returns null for SUM over zero rows.
      { _sum: { refundAmount: null } } as unknown as { _sum: { refundAmount: bigint } },
      [],
    );
    const result = await new InvoiceService(prisma as never).returnContext('invoice-9');
    expect(result.data.returnedTotal).toBe('0');
    expect(result.data.netTotal).toBe('250000000');
    expect(result.data.items.every((item) => item.returnedQuantity === 0)).toBe(true);
    expect(result.data.returns).toEqual([]);
  });

  it('404s for an unknown invoice', async () => {
    const prisma = makePrisma(null);
    await expect(new InvoiceService(prisma as never).returnContext('unknown')).rejects.toThrow(
      'فاکتور پیدا نشد',
    );
  });
});
