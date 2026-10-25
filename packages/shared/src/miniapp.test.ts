import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MINI_APP_SETTINGS,
  isMiniAppPlatform,
  miniAppLaunchUrl,
  miniAppPath,
  parseMiniAppSettings,
} from './miniapp';
const config = {
  ...DEFAULT_MINI_APP_SETTINGS,
  channelButtonsEnabled: true,
  telegramBotUsername: '@store_bot',
  baleBotUsername: 'shop_bot',
};
describe('public mini app configuration', () => {
  it('normalizes usernames and produces official direct links, not website URLs', () => {
    expect(parseMiniAppSettings(config)?.telegramBotUsername).toBe('store_bot');
    expect(miniAppLaunchUrl(config, 'telegram')).toBe('https://t.me/store_bot?startapp');
    expect(miniAppLaunchUrl(config, 'bale')).toBe('https://ble.ir/shop_bot?startapp');
  });
  it('defaults off and keeps unconfigured platforms on the website fallback', () => {
    expect(miniAppLaunchUrl(DEFAULT_MINI_APP_SETTINGS, 'telegram')).toBeNull();
    expect(miniAppLaunchUrl({ ...config, baleBotUsername: '' }, 'bale')).toBeNull();
    expect(parseMiniAppSettings({ ...config, extraSecret: 'must-not-copy' })).not.toHaveProperty(
      'extraSecret',
    );
  });
  it.each([
    null,
    {},
    { ...config, channelButtonsEnabled: 'true' },
    { ...config, buttonText: '' },
    { ...config, buttonText: 'a'.repeat(49) },
    { ...config, telegramBotUsername: 'https://t.me/store_bot' },
    { ...config, baleBotUsername: 'shop?evil=1' },
    { ...config, telegramBotUsername: '', baleBotUsername: '' },
  ])('rejects unsafe/invalid configuration: %j', (input) => {
    expect(parseMiniAppSettings(input)).toBeNull();
  });
  it('uses explicit provider routes and rejects unknown provider names', () => {
    expect(isMiniAppPlatform('telegram')).toBe(true);
    expect(isMiniAppPlatform('bale')).toBe(true);
    expect(isMiniAppPlatform('unknown')).toBe(false);
    expect(miniAppPath('telegram')).toBe('/mini/telegram');
  });
});
