import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CatalogAdminService } from './catalog-admin.service';
import { ApiExceptionFilter } from '../../common/http/api-exception.filter';

/**
 * قرارداد Android ⇄ Server برای product.create — تست رگرسیون زنجیرهٔ P2002.
 *
 * تاریخچهٔ باگ‌ها (سه علت مستقل برای HTTP 500 با detail=P2002):
 *  1) شمارندهٔ Product.code بیرون از تراکنش (fix: 6ec4a0f)
 *  2) برخورد Product.slug برای نام‌های تکراری فارسی مثل «هواکش» (fix: e18e679)
 *  3) بارکد خودکار EAN-13 قطعی از seed بریده‌شدهٔ Date.now (fix: 3a2ac00)
 * و در نهایت نگاشت P2002 به HTTP 409 خوانا به‌جای 500 مبهم.
 *
 * payloadهای این فایل عیناً از لاگ production اندروید (SalimvandSync) برداشته
 * شده‌اند؛ اگر تغییری در سرور این تست‌ها را بشکند یعنی قرارداد موبایل شکسته است.
 */

const CATEGORY_ID = 'a3feb9cf-0000-4000-8000-000000000001';
const LOCATION_ID = '4df514fb-0000-4000-8000-000000000001';
const BRAND_A = 'b0a5d000-0000-4000-8000-00000000000a';
const BRAND_B = 'b0a5d000-0000-4000-8000-00000000000b';
const OPERATION_ID = 'android-a1b2c3d4-op-000003';

/** payload واقعی «لنت جلو پراید» — ثبت بدون برند با موجودی اولیه ۳ */
function androidPayload() {
  return {
    name: 'لنت جلو پراید',
    categoryId: CATEGORY_ID,
    partNumber: '57644',
    items: [
      {
        // بدون brandId — «بدون برند» پیش‌فرض اندروید
        purchasePrice: '500000',
        salePrice: '50000000',
        minStock: 3,
        locationId: LOCATION_ID,
        initialQuantity: 3,
      },
    ],
  };
}

function makePrisma() {
  let itemSeq = 0;
  const prisma: Record<string, any> = {
    product: {
      create: vi.fn(async ({ data }: any) => ({ id: 'p-new', ...data })),
      update: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn(),
    },
    category: { findUnique: vi.fn().mockResolvedValue({ id: CATEGORY_ID, isActive: true }) },
    brand: {
      findUnique: vi.fn(async ({ where }: any) => ({ id: where.id, isActive: true })),
    },
    location: { findUnique: vi.fn().mockResolvedValue({ id: LOCATION_ID }) },
    inventoryItem: {
      create: vi.fn(async ({ data }: any) => ({ id: `item-${++itemSeq}`, ...data })),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    inventoryPriceHistory: { create: vi.fn().mockResolvedValue({ id: 1n }) },
    inventoryTransaction: { create: vi.fn() },
    inventoryOperation: {
      create: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    productOperation: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
    counter: {
      upsert: vi.fn().mockResolvedValue({ lastValue: 14 }),
      update: vi.fn(),
    },
  };
  prisma.$transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback(prisma));
  return prisma;
}

describe('قرارداد product.create اندروید (رگرسیون P2002)', () => {
  it('payload واقعی اندروید: محصول + یک قلم بدون برند + سند موجودی اولیه در یک تراکنش', async () => {
    const prisma = makePrisma();
    const service = new CatalogAdminService(prisma as never);
    const result = await service.create(androidPayload(), 'user-1', undefined, OPERATION_ID);

    // پاسخ باید هم inventoryItem (اولین قلم) و هم inventoryItems (همه) را بدهد —
    // اندروید (SyncRepository.onApplied) به هر دو تکیه می‌کند.
    expect(result.ok).toBe(true);
    expect(result.data.inventoryItem).toBeTruthy();
    expect(result.data.inventoryItems).toHaveLength(1);

    // کد از شمارندهٔ داخل تراکنش — upsert خودش increment می‌کند و مقدار
    // پس از increment را برمی‌گرداند (اینجا 14).
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'لنت جلو پراید',
        categoryId: CATEGORY_ID,
        partNumber: '57644',
        code: 'PRODUCT-00014',
      }),
    });

    // قلم بدون برند: brandId نباید ست شود، قیمت‌ها BigInt ریال، موجودی ۳
    const itemData = prisma.inventoryItem.create.mock.calls[0][0].data;
    expect(itemData.brandId ?? null).toBeNull();
    expect(itemData.purchasePrice).toBe(500000n);
    expect(itemData.salePrice).toBe(50000000n);
    expect(itemData.minStock).toBe(3);
    expect(itemData.locationId).toBe(LOCATION_ID);
    expect(itemData.quantity).toBe(3);

    // بارکد خودکار: EAN-13 معتبر (۱۳ رقم + رقم کنترل درست)
    const barcode: string = itemData.barcode;
    expect(barcode).toMatch(/^\d{13}$/);
    const digits = barcode.split('').map(Number);
    const check =
      (10 - (digits.slice(0, 12).reduce((s, d, i) => s + d * (i % 2 ? 3 : 1), 0) % 10)) % 10;
    expect(digits[12]).toBe(check);

    // موجودی اولیه فقط از دفتر (ledger) — نه ست مستقیم quantity خارج از سند
    expect(prisma.inventoryTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'initial',
        quantityChange: 3,
        quantityAfter: 3,
        operationId: OPERATION_ID,
      }),
    });

    // idempotency: هم productOperation و هم inventoryOperation ثبت شوند
    expect(prisma.productOperation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ operationId: OPERATION_ID, type: 'product.create' }),
    });
    expect(prisma.inventoryOperation.create).toHaveBeenCalled();
  });

  it('باگ ۲ (slug): نام تکراری مثل «هواکش» پسوند -2 می‌گیرد و 500 نمی‌دهد', async () => {
    const prisma = makePrisma();
    // اولین slug گرفته شده است؛ slug-2 آزاد است
    prisma.product.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.slug && !where.slug.endsWith('-2')) return { id: 'existing' };
      return null;
    });
    const service = new CatalogAdminService(prisma as never);
    await service.create(
      { name: 'هواکش', categoryId: CATEGORY_ID, items: [{ initialQuantity: 0 }] },
      'user-1',
    );
    const slug: string = prisma.product.create.mock.calls[0][0].data.slug;
    expect(slug.endsWith('-2')).toBe(true);
  });

  it('باگ ۲ (slug دستی): نامک دستی تکراری 400 خوانا می‌دهد، نه پسوند و نه 500', async () => {
    const prisma = makePrisma();
    prisma.product.findUnique.mockImplementation(async ({ where }: any) =>
      where.slug ? { id: 'existing' } : null,
    );
    const service = new CatalogAdminService(prisma as never);
    await expect(
      service.create(
        { name: 'هواکش', categoryId: CATEGORY_ID, slug: 'havakesh', items: [] },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('باگ ۳ (barcode): دو ثبت پیاپی بدون بارکد، بارکدهای متفاوت می‌گیرند', async () => {
    const prisma = makePrisma();
    const service = new CatalogAdminService(prisma as never);
    await service.create(
      { name: 'محصول یک', categoryId: CATEGORY_ID, items: [{ initialQuantity: 0 }] },
      'user-1',
    );
    await service.create(
      { name: 'محصول دو', categoryId: CATEGORY_ID, items: [{ initialQuantity: 0 }] },
      'user-1',
    );
    const first = prisma.inventoryItem.create.mock.calls[0][0].data.barcode;
    const second = prisma.inventoryItem.create.mock.calls[1][0].data.barcode;
    // seed تصادفی است: برخورد یعنی بازگشت باگ Date.now بریده‌شده
    expect(first).not.toBe(second);
  });

  it('باگ ۳ (barcode): وقتی بارکد کاندید گرفته باشد، کاندید بعدی کشیده می‌شود', async () => {
    const prisma = makePrisma();
    let barcodeChecks = 0;
    prisma.inventoryItem.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.barcode) {
        barcodeChecks += 1;
        return barcodeChecks === 1 ? { id: 'taken' } : null; // اولین کاندید اشغال
      }
      return null;
    });
    const service = new CatalogAdminService(prisma as never);
    await service.create(
      { name: 'محصول', categoryId: CATEGORY_ID, items: [{ initialQuantity: 0 }] },
      'user-1',
    );
    expect(barcodeChecks).toBeGreaterThanOrEqual(2);
    expect(prisma.inventoryItem.create).toHaveBeenCalled();
  });

  it('باگ ۱ (code): شمارندهٔ کهنه (دیتابیس import شده) resync می‌شود، نه P2002', async () => {
    const prisma = makePrisma();
    // شمارنده 14 می‌دهد ولی PRODUCT-00014 از قبل وجود دارد؛ آخرین کد واقعی 00027 است
    prisma.product.findUnique.mockImplementation(async ({ where }: any) =>
      where.code === 'PRODUCT-00014' ? { id: 'existing' } : null,
    );
    prisma.product.findFirst.mockResolvedValue({ code: 'PRODUCT-00027' });
    prisma.counter.update.mockResolvedValue({ lastValue: 28 });
    const service = new CatalogAdminService(prisma as never);
    await service.create(
      { name: 'محصول', categoryId: CATEGORY_ID, items: [{ initialQuantity: 0 }] },
      'user-1',
    );
    expect(prisma.counter.update).toHaveBeenCalledWith({
      where: { key: 'product' },
      data: { lastValue: 28 },
    });
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ code: 'PRODUCT-00028' }),
    });
  });

  it('چند برند: items[] با دو برند دو قلم موجودی در همان تراکنش می‌سازد', async () => {
    const prisma = makePrisma();
    const service = new CatalogAdminService(prisma as never);
    const result = await service.create(
      {
        name: 'دیسک ترمز',
        categoryId: CATEGORY_ID,
        items: [
          { brandId: BRAND_A, salePrice: '3000000', initialQuantity: 2, locationId: LOCATION_ID },
          { brandId: BRAND_B, salePrice: '2500000', initialQuantity: 5, locationId: LOCATION_ID },
        ],
      },
      'user-1',
      undefined,
      OPERATION_ID,
    );
    expect(result.data.inventoryItems).toHaveLength(2);
    expect(prisma.inventoryItem.create).toHaveBeenCalledTimes(2);
    const barcodes = prisma.inventoryItem.create.mock.calls.map((c: any) => c[0].data.barcode);
    expect(new Set(barcodes).size).toBe(2);
    // دو سند موجودی اولیه، یکی برای هر قلم
    expect(prisma.inventoryTransaction.create).toHaveBeenCalledTimes(2);
  });

  it('replay با همان operationId: نتیجهٔ قبلی برمی‌گردد و کد جدیدی نمی‌سوزد', async () => {
    const prisma = makePrisma();
    prisma.productOperation.findUnique.mockResolvedValue({
      operationId: OPERATION_ID,
      productId: 'p-old',
    });
    prisma.product.findUniqueOrThrow.mockResolvedValue({ id: 'p-old', name: 'لنت جلو پراید' });
    const service = new CatalogAdminService(prisma as never);
    const result = await service.create(androidPayload(), 'user-1', undefined, OPERATION_ID);
    expect(result.ok).toBe(true);
    expect(result.data.id).toBe('p-old');
    expect(prisma.counter.upsert).not.toHaveBeenCalled();
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('برند تکراری در items[] با 400 خوانا رد می‌شود، قبل از هر نوشتنی', async () => {
    const prisma = makePrisma();
    const service = new CatalogAdminService(prisma as never);
    await expect(
      service.create(
        {
          name: 'دیسک',
          categoryId: CATEGORY_ID,
          items: [
            { brandId: BRAND_A, initialQuantity: 0 },
            { brandId: BRAND_A, initialQuantity: 0 },
          ],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('دو قلم «بدون برند» هم تکراری حساب می‌شود (NULLهای Postgres در unique جدا هستند)', async () => {
    const prisma = makePrisma();
    const service = new CatalogAdminService(prisma as never);
    await expect(
      service.create(
        {
          name: 'دیسک',
          categoryId: CATEGORY_ID,
          items: [{ initialQuantity: 0 }, { initialQuantity: 0 }],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('نگاشت P2002 به پاسخ 409 (قرارداد Toast اندروید)', () => {
  function response() {
    return {
      statusCode: 0,
      payload: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.payload = payload;
        return payload;
      },
    };
  }
  function host(res: unknown) {
    return {
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => ({ url: '/api/v1/sync/operations', method: 'POST' }),
      }),
    } as never;
  }

  it('P2002 روی products.slug: عیناً همان پاکتی که اندروید در Toast نشان می‌دهد', () => {
    const res = response();
    new ApiExceptionFilter().catch(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['products.slug'] },
      }),
      host(res),
    );
    expect(res.statusCode).toBe(409);
    // اندروید serverMessage() فیلد error.message را می‌خواند و
    // routeForApiError آن را FAILED (نه CONFLICT پنل) مسیر می‌دهد.
    expect(res.payload).toEqual({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: 'مقدار تکراری برای products.slug؛ رکوردی با این مشخصات از قبل ثبت شده است',
        detail: 'P2002',
      },
    });
  });

  it('P2002 با چند ستون: نام ستون‌ها با «،» جدا می‌شود', () => {
    const res = response();
    new ApiExceptionFilter().catch(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['productId', 'brandId'] },
      }),
      host(res),
    );
    expect(res.statusCode).toBe(409);
    expect((res.payload as any).error.message).toContain('productId، brandId');
  });

  it('P2002 بدون meta.target هم 409 خوانا می‌دهد (نه 500)', () => {
    const res = response();
    new ApiExceptionFilter().catch(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      host(res),
    );
    expect(res.statusCode).toBe(409);
    expect((res.payload as any).error.detail).toBe('P2002');
  });
});
