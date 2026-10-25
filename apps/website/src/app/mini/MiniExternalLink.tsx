'use client';
import type { ReactNode } from 'react';
import type { MiniAppPlatform } from '@salimvand/shared';
import { getMiniSdk } from './mini-sdk';

export function MiniExternalLink({
  platform,
  href,
  children,
  className,
  label,
}: {
  platform: MiniAppPlatform;
  href: string;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  // Do not allow a setting/import to turn a host API call into a script URI.
  if (!/^https?:\/\//i.test(href)) return null;
  return (
    <a
      href={href}
      className={className}
      aria-label={label}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
          return;
        const sdk = getMiniSdk(platform);
        try {
          const url = new URL(href);
          if (platform === 'telegram' && url.hostname === 't.me' && sdk?.openTelegramLink)
            sdk.openTelegramLink(href);
          else if (sdk?.openLink) sdk.openLink(href);
          else return;
          event.preventDefault();
        } catch {
          /* Keep the real link as the browser fallback. */
        }
      }}
    >
      {children}
    </a>
  );
}
