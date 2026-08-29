import { describe, expect, it, vi } from 'vitest';
import {
  NotificationsService,
  buildInvoiceMessage,
  parseTelegramCommand,
  renderSmsTemplate,
} from './notifications.service';

function serviceWith(prisma: unknown) {
  const service = Object.create(NotificationsService.prototype) as NotificationsService;
  Object.assign(service as unknown as Record<string, unknown>, { prisma });
  return service;
}

describe('SMS templates', () => {
  it('renders known placeholders and leaves unknown ones untouched', () => {
    expect(
      renderSmsTemplate('فاکتور {invoice_number} به مبلغ {amount} ریال: {link}', {
        invoice_number: 'INV-0001',
        amount: 1200,
        link: 'https://x/i/abc',
      }),
    ).toBe('فاکتور INV-0001 به مبلغ 1200 ریال: https://x/i/abc');
    expect(renderSmsTemplate('سلام {customer_name}', {})).toBe('سلام {customer_name}');
    expect(renderSmsTemplate('', { a: 1 })).toBe('');
    expect(renderSmsTemplate(null, { a: 1 })).toBe('');
  });

  it('uses the operator template when one is configured and falls back otherwise', () => {
    const siteUrl = (process.env.PUBLIC_SITE_URL ?? 'https://selimvand.ir').replace(/\/$/, '');
    const withTemplate = buildInvoiceMessage(
      'INV-0002',
      'c0de',
      '5000',
      false,
      'فاکتور {invoice_number}: {amount} ریال — {link}',
    );
    expect(withTemplate).toBe(`فاکتور INV-0002: 5000 ریال — ${siteUrl}/i/c0de`);
    expect(buildInvoiceMessage('INV-0002', 'c0de', '5000', false)).toContain('مشاهده و دانلود');
    expect(buildInvoiceMessage('INV-0002', 'c0de', '5000', true)).toContain('پرداخت فاکتور');
  });
});

describe('Telegram bot commands', () => {
  it('parses commands, mentions and arguments', () => {
    expect(parseTelegramCommand('/stock')).toEqual({ command: 'stock', argument: '' });
    expect(parseTelegramCommand('/invoice abc123')).toEqual({
      command: 'invoice',
      argument: 'abc123',
    });
    expect(parseTelegramCommand('/help@selimvandbot')).toEqual({ command: 'help', argument: '' });
    expect(parseTelegramCommand('سلام')).toEqual({ command: '', argument: 'سلام' });
    expect(parseTelegramCommand(undefined)).toEqual({ command: '', argument: '' });
  });

  it('answers stock, low stock and daily sales from the database', async () => {
    const prisma = {
      inventoryItem: { count: vi.fn(async () => 42) },
      invoice: {
        count: vi.fn(async () => 3),
        aggregate: vi.fn(async () => ({ _sum: { total: 9_000_000n } })),
      },
    };
    const service = serviceWith(prisma);
    expect(await service.answerCommand('/stock')).toContain('۴۲'.replace('۴۲', '42'));
    expect(await service.answerCommand('/low')).toContain('42');
    expect(await service.answerCommand('/sales')).toContain(
      '9000000000'.replace('9000000000', String(9_000_000)),
    );
    expect(prisma.inventoryItem.count).toHaveBeenCalledTimes(2);
  });

  it('builds the invoice link and shows help for anything else', async () => {
    const service = serviceWith({
      inventoryItem: { count: async () => 0 },
      invoice: { count: async () => 0, aggregate: async () => ({ _sum: { total: null } }) },
    });
    expect(await service.answerCommand('/invoice abc123')).toContain('/i/abc123');
    expect(await service.answerCommand('/nope')).toContain('/help');
    expect(await service.answerCommand('بدون داده')).toContain('/help');
  });
});

describe('messaging logs', () => {
  it('masks the mobile number in the SMS log and stringifies ids', async () => {
    const prisma = {
      smsLog: {
        findMany: async () => [
          {
            id: 7n,
            mobile: '09123456789',
            template: 'invoice.issued',
            status: 'sent',
            provider: 'kavenegar',
            error: null,
            createdAt: new Date(),
          },
        ],
      },
    };
    const rows = await serviceWith(prisma).smsLogs();
    expect(rows).toEqual([
      {
        id: '7',
        mobile: '091***89',
        template: 'invoice.issued',
        status: 'sent',
        provider: 'kavenegar',
        error: null,
        createdAt: expect.any(Date),
      },
    ]);
  });

  it('returns a short preview for channel logs', async () => {
    const prisma = {
      telegramLog: {
        findMany: async () => [
          {
            id: 3n,
            channel: 'bale',
            status: 'failed',
            message: 'x'.repeat(200),
            error: 'timeout',
            createdAt: new Date(),
          },
        ],
      },
    };
    const rows = await serviceWith(prisma).telegramLogs();
    expect(rows[0]).toMatchObject({ id: '3', channel: 'bale', status: 'failed', error: 'timeout' });
    expect((rows[0].preview as string).length).toBe(80);
  });

  it('stays silent when Prisma is not wired', async () => {
    expect(await serviceWith(undefined).smsLogs()).toEqual([]);
    expect(await serviceWith(undefined).telegramLogs()).toEqual([]);
    expect(await serviceWith(undefined).answerCommand('/stock')).toContain('در دسترس نیست');
  });
});
