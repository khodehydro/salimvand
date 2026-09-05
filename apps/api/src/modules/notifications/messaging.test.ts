import { describe, expect, it, vi } from 'vitest';
import {
  NotificationsService,
  buildInvoiceMessage,
  parseTelegramCommand,
  renderSmsTemplate,
  smsIrFailure,
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

  it('keeps real newlines, converts literal \\n and caps blank lines', () => {
    expect(renderSmsTemplate('a\nb\n\nc', {})).toBe('a\nb\n\nc');
    expect(renderSmsTemplate('a\\nb\\n\\nc', {})).toBe('a\nb\n\nc');
    expect(renderSmsTemplate('a\r\nb\rc', {})).toBe('a\nb\nc');
    expect(renderSmsTemplate('a\n\n\n\nb', {})).toBe('a\n\nb');
    expect(renderSmsTemplate('a  \n  b', {})).toBe('a\nb');
  });

  it('uses the operator template when one is configured and falls back otherwise', () => {
    const siteUrl = (process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir').replace(/\/$/, '');
    const withTemplate = buildInvoiceMessage(
      'INV-0002',
      'c0de',
      '5000',
      false,
      'فاکتور {invoice_number}: {amount} ریال — {link}',
    );
    expect(withTemplate).toBe(`فاکتور INV-0002: 5000 ریال — ${siteUrl}/i/c0de`);
    const fallback = buildInvoiceMessage('INV-0002', 'c0de', '5000', false);
    expect(fallback).toContain('مشتری گرامی');
    expect(fallback).toContain('فاکتور شماره INV-0002 شما صادر شد');
    expect(fallback).toContain(`مشاهده:\n${siteUrl}/i/c0de`);
    expect(fallback).toContain('با تشکر از خرید شما');
    expect(fallback).toContain('فروشگاه سلیم وند');
    expect(buildInvoiceMessage('INV-0002', 'c0de', '5000', true)).toContain('پرداخت فاکتور');
  });

  it('renders the customer name greeting and falls back to a generic one', () => {
    const named = buildInvoiceMessage(
      'INV-0003',
      'c0de',
      '5000',
      false,
      '{customer_name}\n\nفاکتور {invoice_number} شما صادر شد',
      'حمید',
    );
    expect(named).toBe('حمید عزیز\n\nفاکتور INV-0003 شما صادر شد');
    const anonymous = buildInvoiceMessage(
      'INV-0003',
      'c0de',
      '5000',
      false,
      '{customer_name}\n\nفاکتور {invoice_number} شما صادر شد',
      '  ',
    );
    expect(anonymous).toBe(`مشتری گرامی\n\nفاکتور INV-0003 شما صادر شد`);
    expect(buildInvoiceMessage('INV-0003', 'c0de', '5000', false, undefined, 'حمید')).toContain(
      'حمید عزیز',
    );
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

describe('sms.ir adapter', () => {
  const job = {
    data: {
      type: 'invoice.issued',
      invoiceId: 'inv-1',
      mobile: '09121234567',
      message: 'فاکتور INV-1',
    },
  } as never;
  const withEnv = (values: Record<string, string | undefined>) => {
    const saved: Record<string, string | undefined> = {};
    for (const key of [
      'SMS_API_KEY',
      'SMS_LINE_NUMBER',
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_CHAT_ID',
      'BALE_BOT_TOKEN',
      'BALE_CHAT_ID',
    ]) {
      saved[key] = process.env[key];
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
    return () => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    };
  };

  it('sends through sms.ir bulk with the X-API-KEY header and logs success', async () => {
    const restore = withEnv({ SMS_API_KEY: 'panel-key', SMS_LINE_NUMBER: '30004505000017' });
    const originalFetch = global.fetch;
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const logs: Array<{ data: { status: string; provider: string } }> = [];
    const prisma = {
      smsLog: {
        create: async (args: { data: { status: string; provider: string } }) => {
          logs.push(args);
          return {};
        },
      },
    };
    global.fetch = (async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ status: 1, message: 'موفق', data: { cost: 1 } }), {
        status: 200,
      });
    }) as typeof fetch;
    try {
      const service = serviceWith(prisma);
      await (service as unknown as { process(job: unknown): Promise<void> }).process(job);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://api.sms.ir/v1/send/bulk');
      expect((calls[0].init.headers as Record<string, string>)['x-api-key']).toBe('panel-key');
      expect(JSON.parse(String(calls[0].init.body))).toEqual({
        lineNumber: 30004505000017,
        messageText: 'فاکتور INV-1',
        mobiles: ['09121234567'],
        sendDateTime: null,
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].data).toMatchObject({ status: 'sent', provider: 'sms.ir' });
    } finally {
      global.fetch = originalFetch;
      restore();
    }
  });

  it('fails the job with a readable reason when sms.ir rejects the send', async () => {
    const restore = withEnv({ SMS_API_KEY: 'bad-key', SMS_LINE_NUMBER: '30004505000017' });
    const originalFetch = global.fetch;
    const logs: Array<{ data: { status: string } }> = [];
    const prisma = {
      smsLog: {
        create: async (args: { data: { status: string } }) => {
          logs.push(args);
          return {};
        },
      },
    };
    global.fetch = (async () =>
      new Response(JSON.stringify({ status: 3, message: 'کلید نامعتبر' }), {
        status: 401,
      })) as typeof fetch;
    try {
      const service = serviceWith(prisma);
      await expect(
        (service as unknown as { process(job: unknown): Promise<void> }).process(job),
      ).rejects.toThrow('کلید API نامعتبر');
      expect(logs).toHaveLength(1);
      expect(logs[0].data.status).toBe('failed');
    } finally {
      global.fetch = originalFetch;
      restore();
    }
  });

  it('fails with a readable reason when the provider call times out', async () => {
    const restore = withEnv({ SMS_API_KEY: 'panel-key', SMS_LINE_NUMBER: '30004505000017' });
    const originalFetch = global.fetch;
    const logs: Array<{ data: { status: string; error: string | null } }> = [];
    const prisma = {
      smsLog: {
        create: async (args: { data: { status: string; error: string | null } }) => {
          logs.push(args);
          return {};
        },
      },
    };
    global.fetch = (async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }) as typeof fetch;
    try {
      const service = serviceWith(prisma);
      await expect(
        (service as unknown as { process(job: unknown): Promise<void> }).process(job),
      ).rejects.toThrow('تایم‌اوت');
      expect(logs).toHaveLength(1);
      expect(logs[0].data.status).toBe('failed');
    } finally {
      global.fetch = originalFetch;
      restore();
    }
  });

  it('skips channels already delivered on a retried job', async () => {
    const restore = withEnv({ SMS_API_KEY: 'panel-key', SMS_LINE_NUMBER: '30004505000017' });
    const originalFetch = global.fetch;
    const calls: string[] = [];
    global.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ status: 1 }), { status: 200 });
    }) as typeof fetch;
    try {
      const service = serviceWith({});
      const retried = {
        data: {
          type: 'invoice.issued',
          invoiceId: 'inv-1',
          mobile: '09121234567',
          message: 'فاکتور INV-1',
          channelsDone: ['sms'],
        },
      } as never;
      await (service as unknown as { process(job: unknown): Promise<void> }).process(retried);
      expect(calls).toHaveLength(0);
    } finally {
      global.fetch = originalFetch;
      restore();
    }
  });

  it('maps sms.ir error codes to human-readable text', () => {
    expect(smsIrFailure(new Response(null, { status: 401 }), null)).toContain('کلید API');
    expect(smsIrFailure(new Response(null, { status: 429 }), null)).toContain('429');
    expect(
      smsIrFailure(new Response(null, { status: 400 }), { status: 2, message: 'خط خطا' }),
    ).toBe('sms.ir: خط خطا');
    expect(smsIrFailure(new Response(null, { status: 500 }), null)).toBe('sms.ir: HTTP 500');
  });
});
