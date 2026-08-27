import { describe, expect, it } from 'vitest';
import { buildInvoiceMessage, integrationConfigured, integrationUrl } from './notifications.service';

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
});
