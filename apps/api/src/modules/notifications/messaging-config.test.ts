import { describe, expect, it } from 'vitest';
import {
  asMessagingConfig,
  MESSAGING_SETTINGS_KEY,
  maskMessagingSecrets,
  mergeMessagingSecrets,
  resolveMessagingEnv,
  SECRET_MASK_PREFIX,
} from './messaging-config';

describe('messaging config', () => {
  it('coerces arbitrary stored JSON into a safe shape', () => {
    expect(asMessagingConfig(undefined)).toEqual({
      sms: { apiKey: undefined, lineNumber: undefined },
      telegram: { botToken: undefined, chatId: undefined },
      bale: { botToken: undefined, chatId: undefined },
    });
    expect(asMessagingConfig({ sms: { apiKey: ' k ', lineNumber: 300051 }, junk: 1 })).toEqual({
      sms: { apiKey: 'k', lineNumber: '300051' },
      telegram: { botToken: undefined, chatId: undefined },
      bale: { botToken: undefined, chatId: undefined },
    });
    expect(asMessagingConfig('not-an-object')).toEqual({
      sms: { apiKey: undefined, lineNumber: undefined },
      telegram: { botToken: undefined, chatId: undefined },
      bale: { botToken: undefined, chatId: undefined },
    });
  });

  it('masks secrets but keeps non-secret fields readable', () => {
    const masked = maskMessagingSecrets({
      sms: { apiKey: 'super-secret-key-1234', lineNumber: '300051' },
      telegram: {
        botToken: '123:ABC',
        chatId: '-1001',
        apiBase: 'https://proxy.workers.dev',
        proxySecret: 'proxy-secret-5678',
      },
      bale: {},
    });
    expect(masked.sms?.apiKey).toBe(`${SECRET_MASK_PREFIX}1234`);
    expect(masked.sms?.apiKey).not.toContain('super-secret');
    expect(masked.sms?.lineNumber).toBe('300051');
    expect(masked.telegram?.botToken).toBe(`${SECRET_MASK_PREFIX}:ABC`);
    expect(masked.telegram?.chatId).toBe('-1001');
    expect(masked.telegram?.apiBase).toBe('https://proxy.workers.dev');
    expect(masked.telegram?.proxySecret).toBe(`${SECRET_MASK_PREFIX}5678`);
    expect(masked.bale?.botToken).toBe('');
    expect(maskMessagingSecrets(null).sms?.apiKey).toBe('');
  });

  it('keeps stored secrets when the panel round-trips masked values', () => {
    const existing = {
      sms: { apiKey: 'stored-secret-9999', lineNumber: '300051' },
      telegram: {
        botToken: 'stored-token-AAAA',
        chatId: '-1001',
        apiBase: 'https://proxy.workers.dev',
        proxySecret: 'stored-proxy-BBBB',
      },
    };
    const incoming = {
      sms: { apiKey: `${SECRET_MASK_PREFIX}9999`, lineNumber: '300052' },
      telegram: {
        botToken: `${SECRET_MASK_PREFIX}AAAA`,
        chatId: '-1001',
        apiBase: 'https://proxy2.workers.dev',
        proxySecret: `${SECRET_MASK_PREFIX}BBBB`,
      },
      bale: {},
    };
    const merged = mergeMessagingSecrets(incoming, existing);
    expect(merged.sms?.apiKey).toBe('stored-secret-9999');
    expect(merged.sms?.lineNumber).toBe('300052');
    expect(merged.telegram?.botToken).toBe('stored-token-AAAA');
    expect(merged.telegram?.apiBase).toBe('https://proxy2.workers.dev');
    expect(merged.telegram?.proxySecret).toBe('stored-proxy-BBBB');
  });

  it('replaces secrets only when a fresh value arrives', () => {
    const merged = mergeMessagingSecrets(
      { sms: { apiKey: 'brand-new-key' } },
      { sms: { apiKey: 'old-key' } },
    );
    expect(merged.sms?.apiKey).toBe('brand-new-key');
    const untouched = mergeMessagingSecrets({ sms: {} }, { sms: { apiKey: 'old-key' } });
    expect(untouched.sms?.apiKey).toBe('old-key');
  });

  it('resolves panel values over .env and falls back per field', async () => {
    const settings = {
      findUnique: async ({ where }: { where: { key: string } }) =>
        where.key === MESSAGING_SETTINGS_KEY
          ? {
              value: {
                sms: { apiKey: 'panel-key', lineNumber: '300051' },
                telegram: {
                  botToken: 'panel-token',
                  apiBase: 'https://proxy.workers.dev',
                  proxySecret: 'panel-proxy-secret',
                },
              },
            }
          : null,
    };
    const env = await resolveMessagingEnv(settings, {
      SMS_API_KEY: 'env-key',
      BALE_BOT_TOKEN: 'env-bale',
      TELEGRAM_API_BASE: 'https://api.telegram.org',
      UNRELATED: 'keep',
    });
    expect(env.SMS_API_KEY).toBe('panel-key');
    expect(env.SMS_LINE_NUMBER).toBe('300051');
    expect(env.TELEGRAM_BOT_TOKEN).toBe('panel-token');
    expect(env.TELEGRAM_API_BASE).toBe('https://proxy.workers.dev');
    expect(env.TELEGRAM_PROXY_SECRET).toBe('panel-proxy-secret');
    expect(env.BALE_BOT_TOKEN).toBe('env-bale');
    expect(env.UNRELATED).toBe('keep');
  });

  it('falls back to .env when the settings table is unavailable', async () => {
    const settings = {
      findUnique: async () => {
        throw new Error('db down');
      },
    };
    const env = await resolveMessagingEnv(settings, { SMS_API_KEY: 'env-key' });
    expect(env.SMS_API_KEY).toBe('env-key');
    const noReader = await resolveMessagingEnv(undefined, { SMS_API_KEY: 'env-key' });
    expect(noReader.SMS_API_KEY).toBe('env-key');
  });
});
