import { describe, expect, it } from 'vitest';
import {
  buildInvoiceMessage,
  integrationConfigured,
  integrationUrl,
  maskNotificationMobile,
  normalizeFailedLimit,
  notificationChannels,
  NOTIFICATION_QUEUE_NAME,
  notificationJobOptions,
  NotificationsService,
  smsIrPayload,
  smsIrSendUrl,
} from './notifications.service';

describe('notification messages', () => {
  it('uses the short invoice URL and never the long token', () => {
    process.env.PUBLIC_SITE_URL = 'https://salimvand.ir/';
    const message = buildInvoiceMessage('INV-0001', 'Ab7kP2xQ9m', '1500000');
    expect(message).toContain('https://salimvand.ir/i/Ab7kP2xQ9m');
    expect(message).not.toContain('publicToken');
    expect(message).not.toContain('undefined');
  });
  it('recognizes configured channels', () => {
    const env = {
      TELEGRAM_BOT_TOKEN: 'secret',
      TELEGRAM_CHAT_ID: 'chat',
      BALE_BOT_TOKEN: 'bale-secret',
      BALE_CHAT_ID: 'bale-chat',
    };
    expect(integrationConfigured('telegram', env)).toBe(true);
    expect(integrationConfigured('bale', env)).toBe(true);
    expect(integrationUrl('telegram', env)).toContain('secret');
    expect(integrationUrl('bale', env)).toContain('bale-secret');
  });
  it('enables sms.ir only with both the API key and the line number', () => {
    expect(
      integrationConfigured('sms', { SMS_API_KEY: 'key', SMS_LINE_NUMBER: '30004505000017' }),
    ).toBe(true);
    expect(integrationConfigured('sms', { SMS_API_KEY: 'key' })).toBe(false);
    expect(integrationConfigured('sms', { SMS_LINE_NUMBER: '30004505000017' })).toBe(false);
    expect(integrationConfigured('sms', {})).toBe(false);
  });
  it('builds the sms.ir bulk request for a single invoice recipient', () => {
    const env = { SMS_API_KEY: 'key', SMS_LINE_NUMBER: '30004505000017' };
    expect(smsIrSendUrl(env)).toBe('https://api.sms.ir/v1/send/bulk');
    expect(smsIrPayload('09121234567', 'فاکتور INV-1', env)).toEqual({
      lineNumber: 30004505000017,
      messageText: 'فاکتور INV-1',
      mobiles: ['09121234567'],
    });
  });
  it('builds a payment notification with the same short URL', () => {
    const message = buildInvoiceMessage('INV-0002', 'Q9mAb7kP2x', '500000', true);
    expect(message).toContain('پرداخت فاکتور INV-0002 ثبت شد');
    expect(message).toContain('/i/Q9mAb7kP2x');
  });
  it('masks failed-job mobile numbers without exposing the full value', () => {
    expect(maskNotificationMobile('09121234567')).toBe('091***67');
    expect(maskNotificationMobile('1234')).toBe('1***');
    expect(maskNotificationMobile(undefined)).toBeNull();
  });
  it('normalizes failed-job limits to a safe range', () => {
    expect(normalizeFailedLimit(0)).toBe(1);
    expect(normalizeFailedLimit(25.9)).toBe(25);
    expect(normalizeFailedLimit(500)).toBe(100);
    expect(normalizeFailedLimit(Number.NaN)).toBe(50);
  });
  it('keeps the queue retry contract explicit', () => {
    expect(NOTIFICATION_QUEUE_NAME).toBe('salimvand-notifications');
    expect(notificationJobOptions).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  });
  it('closes worker, queue, and Redis resources during shutdown', async () => {
    const events: string[] = [];
    const service = Object.create(NotificationsService.prototype) as NotificationsService;
    Object.assign(service as unknown as Record<string, unknown>, {
      worker: {
        close: async () => {
          events.push('worker');
        },
      },
      queue: {
        close: async () => {
          events.push('queue');
        },
      },
      connection: {
        quit: async () => {
          events.push('redis');
        },
      },
    });
    await service.onModuleDestroy();
    expect(events).toEqual(['worker', 'queue', 'redis']);
  });

  it('closes queue and Redis when no worker is enabled', async () => {
    const events: string[] = [];
    const service = Object.create(NotificationsService.prototype) as NotificationsService;
    Object.assign(service as unknown as Record<string, unknown>, {
      queue: {
        close: async () => {
          events.push('queue');
        },
      },
      connection: {
        quit: async () => {
          events.push('redis');
        },
      },
    });
    await service.onModuleDestroy();
    expect(events).toEqual(['queue', 'redis']);
  });

  it('sends an invoice notification only to the customer SMS', () => {
    const env = {
      SMS_API_KEY: 'sms',
      SMS_LINE_NUMBER: '30004505000017',
      TELEGRAM_BOT_TOKEN: 'telegram',
      TELEGRAM_CHAT_ID: 'chat',
      BALE_BOT_TOKEN: 'bale',
      BALE_CHAT_ID: 'bale-chat',
    };
    expect(
      notificationChannels({ type: 'invoice.issued', mobile: '09120000000', message: 'test' }, env),
    ).toEqual(['sms']);
  });
  it('does not send an invoice to channels when the customer has no mobile', () => {
    const env = {
      TELEGRAM_BOT_TOKEN: 'telegram',
      TELEGRAM_CHAT_ID: 'chat',
      BALE_BOT_TOKEN: 'bale',
      BALE_CHAT_ID: 'bale-chat',
    };
    expect(notificationChannels({ type: 'invoice.issued', message: 'test' }, env)).toEqual([]);
  });
  it('restricts test notifications to the requested provider', () => {
    const env = {
      SMS_API_KEY: 'sms',
      SMS_LINE_NUMBER: '30004505000017',
      TELEGRAM_BOT_TOKEN: 'telegram',
      TELEGRAM_CHAT_ID: 'chat',
      BALE_BOT_TOKEN: 'bale',
      BALE_CHAT_ID: 'bale-chat',
    };
    expect(
      notificationChannels(
        { type: 'low-stock', testChannel: 'telegram', mobile: '09120000000', message: 'test' },
        env,
      ),
    ).toEqual(['telegram']);
    expect(
      notificationChannels({ type: 'low-stock', testChannel: 'sms', message: 'test' }, env),
    ).toEqual([]);
  });
});
