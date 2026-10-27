'use client';

import { useCallback, useEffect, useState, useRef, type ReactNode } from 'react';
import Script from 'next/script';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { miniAppPath, type MiniAppPlatform } from '@salimvand/shared';
import { noteCatalogSpaBack } from '../catalog-return';
import { MiniLink } from './MiniLink';
import { MiniSearch } from './MiniSearch';
import { MiniPhoneBar } from './MiniPhoneBar';
import { MiniIcon } from './MiniIcon';
import { MiniExternalLink } from './MiniExternalLink';
import { canGoBackInsideMini, getMiniSdk, MINI_SDK_URLS } from './mini-sdk';

export function MiniChrome({
  platform,
  name,
  logo,
  siteUrl,
  phone,
  children,
}: {
  platform: MiniAppPlatform;
  name: string;
  logo: string;
  siteUrl: string;
  phone?: string;
  children: ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const search = useSearchParams().toString();
  const previous = useRef<string | null>(null);
  const base = miniAppPath(platform);
  const atHome = path === base;
  const [sdkReady, setSdkReady] = useState(0);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    // Hysteresis prevents header-height changes near the boundary from flickering.
    const scroll = () =>
      setCompact((current) => (window.scrollY > 80 ? true : window.scrollY < 16 ? false : current));
    scroll();
    window.addEventListener('scroll', scroll, { passive: true });
    return () => window.removeEventListener('scroll', scroll);
  }, []);
  const back = useCallback(() => {
    const parent = history.state?.salimvandMiniParent;
    const inside = typeof parent === 'string' && canGoBackInsideMini(base, parent, location.origin);
    if (
      history.length > 1 &&
      (inside || canGoBackInsideMini(base, document.referrer, location.origin))
    )
      router.back();
    else router.replace(base);
  }, [base, router]);

  useEffect(() => {
    const url = path + (search ? `?${search}` : '');
    if (previous.current && previous.current !== url && !history.state?.salimvandMiniParent) {
      history.replaceState(
        { ...history.state, salimvandMiniParent: previous.current },
        '',
        location.href,
      );
    }
    previous.current = url;
  }, [path, search]);
  useEffect(() => {
    window.addEventListener('popstate', noteCatalogSpaBack);
    return () => window.removeEventListener('popstate', noteCatalogSpaBack);
  }, []);

  useEffect(() => {
    const sdk = getMiniSdk(platform);
    if (!sdk) return;
    const original = document.documentElement.dataset.theme;
    const theme = () => {
      if (sdk.colorScheme === 'light' || sdk.colorScheme === 'dark')
        document.documentElement.dataset.theme = sdk.colorScheme;
    };
    try {
      sdk.ready?.();
      sdk.expand?.();
      theme();
      sdk.onEvent?.('themeChanged', theme);
    } catch {
      /* Browser fallback remains usable. */
    }
    return () => {
      try {
        sdk.offEvent?.('themeChanged', theme);
      } catch {
        /* Older SDK. */
      }
      if (original) document.documentElement.dataset.theme = original;
      else delete document.documentElement.dataset.theme;
    };
  }, [platform, sdkReady]);

  useEffect(() => {
    const button = getMiniSdk(platform)?.BackButton;
    try {
      if (atHome) button?.hide?.();
      else {
        button?.show?.();
        button?.onClick?.(back);
      }
    } catch {
      /* Header's own Back button remains available. */
    }
    return () => {
      try {
        button?.offClick?.(back);
        button?.hide?.();
      } catch {
        /* Older SDK. */
      }
    };
  }, [platform, atHome, back, sdkReady]);

  return (
    <div className="mini-shell" data-platform={platform}>
      {platform !== 'web' && (
        <Script
          id={`mini-sdk-${platform}`}
          src={MINI_SDK_URLS[platform]}
          strategy="afterInteractive"
          onReady={() => setSdkReady((value) => value + 1)}
        />
      )}
      <header className={`mini-header${compact ? ' is-compact' : ''}`}>
        <div className="mini-header-brand-row">
          {!atHome && (
            <button type="button" className="mini-back" aria-label="بازگشت به فهرست" onClick={back}>
              <MiniIcon name="arrow" />
            </button>
          )}
          <MiniLink className="mini-brand" href={base} label={`${name}، فهرست محصولات`}>
            <span className="mini-brand-logo">
              {logo ? <img src={logo} alt="" width={40} height={40} /> : 'س'}
            </span>
            <span>
              <strong>{name}</strong>
              <small>
                <i />
                {platform === 'telegram'
                  ? 'فروشگاه در تلگرام'
                  : platform === 'bale'
                    ? 'فروشگاه در بله'
                    : 'کاتالوگ همراه'}
              </small>
            </span>
          </MiniLink>
          <MiniExternalLink
            href={siteUrl}
            platform={platform}
            className="mini-web-link"
            label="باز کردن نسخهٔ وب"
          >
            <MiniIcon name="globe" />
          </MiniExternalLink>
        </div>
        <MiniSearch base={base} />
      </header>
      <main className="mini-main" id="mini-main">
        {children}
      </main>
      <MiniPhoneBar phone={phone} base={base} />
    </div>
  );
}
