import type { MiniAppPlatform } from '@salimvand/shared';

export type MiniSdk = {
  initData?: string;
  colorScheme?: string;
  isMiniAppSupported?: boolean;
  ready?: () => void;
  expand?: () => void;
  onEvent?: (event: string, callback: () => void) => void;
  offEvent?: (event: string, callback: () => void) => void;
  BackButton?: {
    show?: () => void;
    hide?: () => void;
    onClick?: (callback: () => void) => void;
    offClick?: (callback: () => void) => void;
  };
  openLink?: (url: string) => void;
  openTelegramLink?: (url: string) => void;
};
export const MINI_SDK_URLS = {
  telegram: 'https://telegram.org/js/telegram-web-app.js',
  bale: 'https://tapi.bale.ai/miniapp.js',
};
export function getMiniSdk(platform: MiniAppPlatform): MiniSdk | undefined {
  if (typeof window === 'undefined' || platform === 'web') return;
  const host = window as Window & { Telegram?: { WebApp?: MiniSdk }; Bale?: { WebApp?: MiniSdk } };
  const sdk = platform === 'telegram' ? host.Telegram?.WebApp : host.Bale?.WebApp;
  // A downloaded SDK in a normal browser is not an authenticated host session.
  // initData is only a presence signal here; no user fields are read/trusted.
  return sdk && (sdk.initData || sdk.isMiniAppSupported) ? sdk : undefined;
}
export function canGoBackInsideMini(base: string, referrer: string, origin: string): boolean {
  try {
    const previous = new URL(referrer, origin);
    return (
      previous.origin === origin &&
      (previous.pathname === base || previous.pathname.startsWith(`${base}/`))
    );
  } catch {
    return false;
  }
}
