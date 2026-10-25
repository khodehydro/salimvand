export const MINI_APP_PLATFORMS = ['telegram', 'bale', 'web'] as const;
export type MiniAppPlatform = (typeof MINI_APP_PLATFORMS)[number];
export type MiniAppSettings = {
  channelButtonsEnabled: boolean;
  buttonText: string;
  telegramBotUsername: string;
  baleBotUsername: string;
};
export const DEFAULT_MINI_APP_SETTINGS: MiniAppSettings = {
  channelButtonsEnabled: false,
  buttonText: '🛍 فروشگاه داخل پیام‌رسان',
  telegramBotUsername: '',
  baleBotUsername: '',
};

export function isMiniAppPlatform(value: string): value is MiniAppPlatform {
  return (MINI_APP_PLATFORMS as readonly string[]).includes(value);
}
export function miniAppPath(platform: MiniAppPlatform): string {
  return `/mini/${platform}`;
}
export function parseMiniAppSettings(input: unknown): MiniAppSettings | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (
    typeof value.channelButtonsEnabled !== 'boolean' ||
    typeof value.buttonText !== 'string' ||
    !value.buttonText.trim() ||
    value.buttonText.trim().length > 48
  )
    return null;
  const username = (raw: unknown) => {
    if (typeof raw !== 'string') return null;
    const clean = raw.trim().replace(/^@/, '');
    return clean === '' || /^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(clean) ? clean : null;
  };
  const telegram = username(value.telegramBotUsername),
    bale = username(value.baleBotUsername);
  if (telegram === null || bale === null || (value.channelButtonsEnabled && !telegram && !bale))
    return null;
  return {
    channelButtonsEnabled: value.channelButtonsEnabled,
    buttonText: value.buttonText.trim(),
    telegramBotUsername: telegram,
    baleBotUsername: bale,
  };
}

/** Channel messages need ordinary URL buttons, not private-chat web_app buttons. */
export function miniAppLaunchUrl(
  settings: MiniAppSettings,
  platform: 'telegram' | 'bale',
): string | null {
  const parsed = parseMiniAppSettings(settings);
  if (!parsed?.channelButtonsEnabled) return null;
  const username = platform === 'telegram' ? parsed.telegramBotUsername : parsed.baleBotUsername;
  return username
    ? `https://${platform === 'telegram' ? 't.me' : 'ble.ir'}/${username}?startapp`
    : null;
}
