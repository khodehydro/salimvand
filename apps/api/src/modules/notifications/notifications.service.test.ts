import { describe, expect, it } from 'vitest';
import { buildInvoiceMessage, integrationConfigured, integrationUrl, notificationChannels, NOTIFICATION_QUEUE_NAME, notificationJobOptions } from './notifications.service';

describe('notification messages', () => {
  it('uses the short invoice URL and never the long token', () => {
    process.env.PUBLIC_SITE_URL = 'https://selimvand.ir/';
    const message = buildInvoiceMessage('INV-0001', 'Ab7kP2xQ9m', '1500000');
    expect(message).toContain('https://selimvand.ir/i/Ab7kP2xQ9m');
    expect(message).not.toContain('publicToken');
    expect(message).not.toContain('undefined');
  });
  it('recognizes configured channels', () => {
    const env = { TELEGRAM_BOT_TOKEN: 'secret', TELEGRAM_CHAT_ID: 'chat', BALE_BOT_TOKEN: 'bale-secret', BALE_CHAT_ID: 'bale-chat' };
    expect(integrationConfigured('telegram', env)).toBe(true);
    expect(integrationConfigured('bale', env)).toBe(true);
    expect(integrationUrl('telegram', env)).toContain('secret');
    expect(integrationUrl('bale', env)).toContain('bale-secret');
  });
  it('builds a payment notification with the same short URL', () => {
    const message = buildInvoiceMessage('INV-0002', 'Q9mAb7kP2x', '500000', true);
    expect(message).toContain('پرداخت فاکتور INV-0002 ثبت شد');
    expect(message).toContain('/i/Q9mAb7kP2x');
  });
  it('keeps the queue retry contract explicit', () => {
    expect(NOTIFICATION_QUEUE_NAME).toBe('salimvand-notifications');
    expect(notificationJobOptions).toEqual({ attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 100, removeOnFail: 500 });
  });
  it('selects all configured channels for a normal invoice notification', () => {
    const env = { SMS_PROVIDER: 'generic', SMS_API_URL: 'https://sms.test', SMS_API_KEY: 'sms', TELEGRAM_BOT_TOKEN: 'telegram', TELEGRAM_CHAT_ID: 'chat', BALE_BOT_TOKEN: 'bale', BALE_CHAT_ID: 'bale-chat' };
    expect(notificationChannels({ type: 'invoice.issued', mobile: '09120000000', message: 'test' }, env)).toEqual(['sms', 'telegram', 'bale']);
  });
  it('restricts test notifications to the requested provider', () => {
    const env = { SMS_PROVIDER: 'generic', SMS_API_URL: 'https://sms.test', SMS_API_KEY: 'sms', TELEGRAM_BOT_TOKEN: 'telegram', TELEGRAM_CHAT_ID: 'chat', BALE_BOT_TOKEN: 'bale', BALE_CHAT_ID: 'bale-chat' };
    expect(notificationChannels({ type: 'low-stock', testChannel: 'telegram', mobile: '09120000000', message: 'test' }, env)).toEqual(['telegram']);
    expect(notificationChannels({ type: 'low-stock', testChannel: 'sms', message: 'test' }, env)).toEqual([]);
  });
});
