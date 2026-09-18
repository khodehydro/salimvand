import { describe, expect, it, vi } from 'vitest';
import { InvoiceController, PublicInvoiceController } from './invoice.controller';
import { InvoicePaymentMethod } from './invoice.dto';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { PATH_METADATA, METHOD_METADATA } from '../../common/http/multipart.constants';

const request = { user: { id: 'user-1' } } as never;

describe('InvoiceController', () => {
  it('allows accounting reads and point-of-sale payments without granting invoice issuance', () => {
    expect(Reflect.getMetadata(ROLES_KEY, InvoiceController.prototype.list)).toEqual([
      'seller',
      'accountant',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, InvoiceController.prototype.pay)).toEqual([
      'seller',
      'accountant',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, InvoiceController.prototype.create)).toEqual(['seller']);
    expect(Reflect.getMetadata(ROLES_KEY, InvoiceController.prototype.void)).toEqual(['manager']);
    // The narrow return-sheet read mirrors the POST returns roles: warehouse
    // may process returns without gaining access to the full invoice detail.
    expect(Reflect.getMetadata(ROLES_KEY, InvoiceController.prototype.returnContext)).toEqual([
      'manager',
      'warehouse',
      'accountant',
    ]);
  });

  it('routes the narrow return-context read for the mobile return sheet', async () => {
    const returnContext = vi.fn(async () => ({ ok: true, data: { id: 'invoice-1' } }));
    const controller = new InvoiceController({ returnContext } as never);
    await expect(controller.returnContext('invoice-1')).resolves.toEqual({
      ok: true,
      data: { id: 'invoice-1' },
    });
    expect(returnContext).toHaveBeenCalledWith('invoice-1');
  });

  it('routes invoice creation and payment to the service', async () => {
    const create = vi.fn(async () => ({ ok: true, data: { number: 'INV-1' } }));
    const pay = vi.fn(async () => ({ ok: true, data: { paymentStatus: 'paid' } }));
    const controller = new InvoiceController({ create, pay } as never);
    await expect(
      controller.create(
        { items: [{ inventoryItemId: 'item-1', quantity: 1, unitPrice: '100' }] },
        request,
      ),
    ).resolves.toEqual({ ok: true, data: { number: 'INV-1' } });
    await expect(
      controller.pay('invoice-1', { amount: '100', method: InvoicePaymentMethod.cash }, request),
    ).resolves.toEqual({ ok: true, data: { paymentStatus: 'paid' } });
    expect(create).toHaveBeenCalledWith(
      { items: [{ inventoryItemId: 'item-1', quantity: 1, unitPrice: '100' }] },
      'user-1',
    );
    expect(pay).toHaveBeenCalledWith('invoice-1', '100', 'cash', 'user-1', undefined);
  });

  it('routes the SMS resend with the caller identity and an optional corrected mobile', async () => {
    const resendSms = vi.fn(async () => ({ ok: true, data: { publicShortCode: 'AbC2dEf3gH' } }));
    const controller = new InvoiceController({ resendSms } as never);
    await expect(
      controller.resendSms('invoice-1', { mobile: '09351112233' }, {
        user: { id: 'user-7' },
        ip: '10.0.0.9',
      } as never),
    ).resolves.toEqual({ ok: true, data: { publicShortCode: 'AbC2dEf3gH' } });
    expect(resendSms).toHaveBeenCalledWith('invoice-1', 'user-7', '09351112233', '10.0.0.9');
  });

  it('routes stock options, returns, and void operations', async () => {
    const options = vi.fn(async () => ({ ok: true, data: [] }));
    const returns = vi.fn(async () => ({ ok: true, data: { quantityAfter: 3 } }));
    const voidInvoice = vi.fn(async () => ({ ok: true, data: { status: 'voided' } }));
    const controller = new InvoiceController({
      options,
      returnItems: returns,
      void: voidInvoice,
    } as never);
    await expect(controller.options()).resolves.toEqual({ ok: true, data: [] });
    await expect(
      controller.returns(
        'invoice-1',
        { invoiceItemId: 'line-1', quantity: 1, reason: 'تعویض' },
        request,
      ),
    ).resolves.toEqual({ ok: true, data: { quantityAfter: 3 } });
    await expect(controller.void('invoice-1', request)).resolves.toEqual({
      ok: true,
      data: { status: 'voided' },
    });
    expect(returns).toHaveBeenCalledWith(
      'invoice-1',
      { invoiceItemId: 'line-1', quantity: 1, reason: 'تعویض' },
      'user-1',
    );
    expect(voidInvoice).toHaveBeenCalledWith('invoice-1', 'user-1');
  });

  it('routes public invoice reads', async () => {
    const getPublic = vi.fn(async (token: string) => ({ ok: true, data: { token } }));
    const controller = new InvoiceController({ getPublic } as never);
    await expect(controller.getPublic('short-code')).resolves.toEqual({
      ok: true,
      data: { token: 'short-code' },
    });
  });
});

describe('PublicInvoiceController', () => {
  it('renders PDF for a token and sets download headers', async () => {
    const pdf = vi.fn(async () => Buffer.from('pdf'));
    const response = { set: vi.fn(), end: vi.fn((file: Buffer) => file) };
    const controller = new PublicInvoiceController({ pdf } as never);
    await expect(controller.pdf('secure-token', response as never)).resolves.toEqual(
      Buffer.from('pdf'),
    );
    expect(pdf).toHaveBeenCalledWith('secure-token');
    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'Content-Type': 'application/pdf' }),
    );
  });

  it('routes QR and short-code invoice requests', async () => {
    const qr = vi.fn(async (code: string) => ({ ok: true, data: { code } }));
    const getPublic = vi.fn(async (code: string) => ({ ok: true, data: { code } }));
    const controller = new PublicInvoiceController({ qr, getPublic } as never);
    await expect(controller.qr('ABC123')).resolves.toEqual({ ok: true, data: { code: 'ABC123' } });
    await expect(controller.getShort('ABC123')).resolves.toEqual({
      ok: true,
      data: { code: 'ABC123' },
    });
    expect(qr).toHaveBeenCalledWith('ABC123');
    expect(getPublic).toHaveBeenCalledWith('ABC123');
  });
});

describe('invoice route ordering', () => {
  it('declares static GET segments before the :id param route', () => {
    // NestJS matches routes in declaration order: if @Get(':id') came first,
    // GET /invoices/customers would be answered by get('customers') and 404.
    const methodNames = Object.getOwnPropertyNames(InvoiceController.prototype).filter(
      (name) => name !== 'constructor',
    );
    const handler = (prototype: unknown, name: string) =>
      (prototype as Record<string, unknown>)[name] as object;
    const getPath = (name: string) => {
      const paths = Reflect.getMetadata(PATH_METADATA, handler(InvoiceController.prototype, name));
      const method = Reflect.getMetadata(
        METHOD_METADATA,
        handler(InvoiceController.prototype, name),
      );
      return { name, paths: Array.isArray(paths) ? paths : [paths], method };
    };
    const getRoutes = methodNames.map(getPath).filter((route) => route.method === 0); // 0 = GET
    const position = (segment: string) =>
      getRoutes.findIndex((route) => (route.paths as string[]).includes(segment));
    expect(position('customers')).toBeGreaterThanOrEqual(0);
    expect(position('options')).toBeGreaterThanOrEqual(0);
    expect(position(':id')).toBeGreaterThan(position('customers'));
    expect(position(':id')).toBeGreaterThan(position('options'));
    // The narrow return-sheet read must also be declared before the :id route.
    expect(position(':id/return-context')).toBeGreaterThanOrEqual(0);
    expect(position(':id')).toBeGreaterThan(position(':id/return-context'));
    // Same guarantee for the public controller's static routes.
    const publicNames = Object.getOwnPropertyNames(PublicInvoiceController.prototype).filter(
      (name) => name !== 'constructor',
    );
    const publicGets = publicNames
      .map((name) => ({
        paths: Reflect.getMetadata(PATH_METADATA, handler(PublicInvoiceController.prototype, name)),
        method: Reflect.getMetadata(
          METHOD_METADATA,
          handler(PublicInvoiceController.prototype, name),
        ),
      }))
      .filter((route) => route.method === 0);
    const publicPosition = (segment: string) =>
      publicGets.findIndex((route) =>
        (Array.isArray(route.paths) ? route.paths : [route.paths]).includes(segment),
      );
    expect(publicPosition('qr/:shortCode')).toBeGreaterThanOrEqual(0);
    expect(publicPosition(':token')).toBeGreaterThan(publicPosition('qr/:shortCode'));
  });
});
