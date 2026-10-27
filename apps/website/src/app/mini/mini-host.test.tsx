// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MiniChrome } from './MiniChrome';
import { MiniExternalLink } from './MiniExternalLink';
import { canGoBackInsideMini, getMiniSdk } from './mini-sdk';
const { nav, route } = vi.hoisted(() => ({
  nav: { back: vi.fn(), replace: vi.fn() },
  route: { path: '/mini/telegram' },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => route.path,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({
    children,
    prefetch: _prefetch,
    ...props
  }: React.PropsWithChildren<{ prefetch?: boolean }>) => <a {...props}>{children}</a>,
}));
vi.mock('next/script', () => ({
  default: ({ src, onReady }: { src: string; onReady: () => void }) => {
    useEffect(() => {
      onReady();
    }, []);
    return <span data-testid="sdk-url">{src}</span>;
  },
}));
const sdk = () => ({
  initData: 'opaque-host-data-not-used-for-auth',
  ready: vi.fn(),
  expand: vi.fn(),
  colorScheme: 'dark',
  onEvent: vi.fn(),
  offEvent: vi.fn(),
  openLink: vi.fn(),
  openTelegramLink: vi.fn(),
  BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
});
beforeEach(() => {
  route.path = '/mini/telegram';
  history.replaceState({}, '', route.path);
  document.documentElement.dataset.theme = 'light';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe('mini host adapters', () => {
  it('selects only the requested host and does not treat a downloaded SDK as a signed-in user', () => {
    vi.stubGlobal('Telegram', { WebApp: {} });
    expect(getMiniSdk('telegram')).toBeUndefined();
    vi.stubGlobal('Bale', { WebApp: sdk() });
    expect(getMiniSdk('bale')).toBeDefined();
    expect(getMiniSdk('web')).toBeUndefined();
    expect(canGoBackInsideMini('/mini/bale', 'https://evil.test/mini/bale', location.origin)).toBe(
      false,
    );
    expect(canGoBackInsideMini('/mini/bale', '/mini/bale?categoryId=c', location.origin)).toBe(
      true,
    );
    expect(canGoBackInsideMini('/mini/bale', 'http://[', location.origin)).toBe(false);
  });
  it('initializes Telegram theme/back controls and preserves Next history state', () => {
    const host = sdk();
    Object.defineProperty(host, 'initDataUnsafe', {
      get: () => {
        throw new Error('must not read user data');
      },
    });
    vi.stubGlobal('Telegram', { WebApp: host });
    const { rerender, unmount } = render(
      <MiniChrome platform="telegram" name="فروشگاه" logo="" siteUrl="https://shop.test">
        محصولات
      </MiniChrome>,
    );
    expect(host.ready).toHaveBeenCalled();
    expect(host.expand).toHaveBeenCalled();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(host.BackButton.hide).toHaveBeenCalled();
    route.path = '/mini/telegram/product/pump';
    history.pushState({ __NA: true, tree: 'keep-me' }, '', route.path);
    rerender(
      <MiniChrome platform="telegram" name="فروشگاه" logo="" siteUrl="https://shop.test">
        جزئیات
      </MiniChrome>,
    );
    expect(history.state.tree).toBe('keep-me');
    expect(history.state.salimvandMiniParent).toBe('/mini/telegram');
    expect(host.BackButton.show).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'بازگشت به فهرست' }));
    expect(nav.back).toHaveBeenCalled();
    unmount();
    expect(host.BackButton.offClick).toHaveBeenCalled();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
  it('loads Bale SDK rather than Telegram and remains usable without the SDK', () => {
    route.path = '/mini/bale';
    const host = sdk();
    vi.stubGlobal('Bale', { WebApp: host });
    render(
      <MiniChrome platform="bale" name="فروشگاه" logo="" siteUrl="https://shop.test">
        کاتالوگ
      </MiniChrome>,
    );
    expect(screen.getByTestId('sdk-url').textContent).toBe('https://tapi.bale.ai/miniapp.js');
    expect(host.ready).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'اطلاعات فروشگاه' }).getAttribute('href')).toBe(
      '/mini/bale/contact',
    );
  });
  it('compacts the sticky header after scrolling, restores it at the top and cleans up its listener', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { container, unmount } = render(
      <MiniChrome
        platform="web"
        name="فروشگاه"
        logo=""
        siteUrl="https://shop.test"
        phone="۰۹۱۲۱۲۳۴۵۶۷"
      >
        کاتالوگ
      </MiniChrome>,
    );
    expect(container.querySelector('.mini-bottom-nav')).toBeNull();
    expect(screen.getAllByRole('searchbox')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'تماس با فروشگاه' }).getAttribute('href')).toBe(
      'tel:09121234567',
    );
    expect(container.querySelector('.mini-header')?.classList.contains('is-compact')).toBe(false);
    vi.stubGlobal('scrollY', 120);
    fireEvent.scroll(window);
    expect(container.querySelector('.mini-header')?.classList.contains('is-compact')).toBe(true);
    vi.stubGlobal('scrollY', 40);
    fireEvent.scroll(window);
    expect(container.querySelector('.mini-header')?.classList.contains('is-compact')).toBe(true);
    vi.stubGlobal('scrollY', 0);
    fireEvent.scroll(window);
    expect(container.querySelector('.mini-header')?.classList.contains('is-compact')).toBe(false);
    unmount();
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    remove.mockRestore();
  });
  it('uses host external-link methods, rejects script URIs, and keeps real fallback links', () => {
    const host = sdk();
    vi.stubGlobal('Telegram', { WebApp: host });
    const { rerender } = render(
      <MiniExternalLink platform="telegram" href="https://t.me/store">
        تلگرام
      </MiniExternalLink>,
    );
    fireEvent.click(screen.getByRole('link'));
    expect(host.openTelegramLink).toHaveBeenCalledWith('https://t.me/store');
    rerender(
      <MiniExternalLink platform="telegram" href="https://shop.test/product/pump">
        وب
      </MiniExternalLink>,
    );
    fireEvent.click(screen.getByRole('link'));
    expect(host.openLink).toHaveBeenCalledWith('https://shop.test/product/pump');
    rerender(
      <MiniExternalLink platform="web" href="https://shop.test">
        وب
      </MiniExternalLink>,
    );
    expect(screen.getByRole('link').getAttribute('target')).toBe('_blank');
    rerender(
      <MiniExternalLink platform="telegram" href="javascript:alert(1)">
        بد
      </MiniExternalLink>,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});
