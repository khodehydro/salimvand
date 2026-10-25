'use client';

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { formatPersianNumber } from '@salimvand/shared';
import type { CardProduct } from './ProductCard';
import { CATALOG_LEAVE_EVENT, consumeCatalogSpaBack } from './catalog-return';
import {
  CATALOG_PAGE_SIZE,
  appendCatalogProducts,
  catalogApiQuery,
  catalogPageHref,
  type CatalogPage,
} from './catalog-pagination';

const RETURN_CACHE = 'salimvand.catalog.return.v1';
const CACHE_TTL = 15 * 60 * 1000;
type Listing = CatalogPage & { exhausted?: boolean };
type ReturnCache = {
  key: string;
  savedAt: number;
  baseSlugs: string;
  baseTotal: number;
  listing: Listing;
  scrollY: number;
};

export type CatalogProductsProps = {
  initial: CatalogPage;
  query: string;
  pagePath?: string;
  gridClassName?: string;
  spaReturn?: boolean;
  renderProduct: (product: CardProduct) => ReactNode;
};

export function CatalogProducts({
  initial,
  query,
  pagePath = '/',
  gridClassName = '',
  spaReturn = false,
  renderProduct,
}: CatalogProductsProps) {
  const [listing, setListing] = useState<Listing>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [restoreScroll, setRestoreScroll] = useState<number | null>(null);
  const busy = useRef(false);
  const controller = useRef<AbortController>();
  const mounted = useRef(false);
  const latest = useRef(listing);
  latest.current = listing;
  const key = `${pagePath}?${query}`;
  const baseSlugs = initial.items.map((product) => product.slug).join('|');

  useEffect(() => {
    mounted.current = true;
    // Product cards use real links. Native Back/BFCache handles the common
    // case; this cache restores the appended cards if the document remounts.
    try {
      const navigation = performance.getEntriesByType('navigation')[0] as
        PerformanceNavigationTiming | undefined;
      history.scrollRestoration = 'auto';
      const spaBack = spaReturn && consumeCatalogSpaBack();
      if (navigation?.type === 'back_forward' || spaBack) {
        const saved: ReturnCache | null = JSON.parse(
          sessionStorage.getItem(RETURN_CACHE) || 'null',
        );
        if (
          saved &&
          saved.key === key &&
          Number.isFinite(saved.savedAt) &&
          Date.now() - saved.savedAt < CACHE_TTL &&
          Date.now() >= saved.savedAt &&
          saved.baseSlugs === baseSlugs &&
          saved.baseTotal === initial.total &&
          Array.isArray(saved.listing?.items) &&
          saved.listing.items.length >= initial.items.length &&
          saved.listing.items.length <= 560 &&
          saved.listing.items.every(
            (item) => item && typeof item.slug === 'string' && typeof item.name === 'string',
          ) &&
          Number.isSafeInteger(saved.listing.total) &&
          saved.listing.total >= 0 &&
          Number.isSafeInteger(saved.listing.totalPages) &&
          saved.listing.totalPages >= 0 &&
          Number.isSafeInteger(saved.listing.page) &&
          saved.listing.page >= initial.page &&
          Number.isFinite(saved.scrollY) &&
          saved.scrollY >= 0
        ) {
          history.scrollRestoration = 'manual';
          setListing(saved.listing);
          setRestoreScroll(saved.scrollY);
        }
      }
    } catch {
      /* Storage may be blocked/full. The catalog must still work. */
    }
    const remember = () => {
      try {
        history.scrollRestoration = 'auto';
        if (latest.current.items.length > 560) {
          sessionStorage.removeItem(RETURN_CACHE);
          return;
        }
        const saved: ReturnCache = {
          key,
          savedAt: Date.now(),
          baseSlugs,
          baseTotal: initial.total,
          listing: latest.current,
          scrollY: window.scrollY,
        };
        const value = JSON.stringify(saved);
        // Keep only the latest listing and bound its storage footprint.
        if (value.length <= 1_000_000) {
          sessionStorage.setItem(RETURN_CACHE, value);
          // Save manual restoration on THIS history entry before navigating
          // away; otherwise the browser clamps Back to the initial 28 cards.
          history.scrollRestoration = 'manual';
        } else sessionStorage.removeItem(RETURN_CACHE);
      } catch {
        /* Best effort only. */
      }
    };
    window.addEventListener('pagehide', remember);
    if (spaReturn) window.addEventListener(CATALOG_LEAVE_EVENT, remember);
    return () => {
      mounted.current = false;
      controller.current?.abort();
      window.removeEventListener('pagehide', remember);
      window.removeEventListener(CATALOG_LEAVE_EVENT, remember);
    };
  }, [key, baseSlugs, initial.page, initial.total, initial.items.length, spaReturn]);

  useEffect(() => {
    if (restoreScroll == null) return;
    let cancelled = false;
    let frame = 0;
    // Run after the restored cards have committed and local fonts are ready,
    // not in the mount effect before the grid has regained its full height.
    void Promise.resolve(document.fonts?.ready).then(() => {
      if (cancelled) return;
      frame = requestAnimationFrame(() => {
        window.scrollTo(0, restoreScroll);
        setRestoreScroll(null);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [restoreScroll]);

  const hasMore = !listing.exhausted && listing.page < listing.totalPages;
  const nextHref = catalogPageHref(pagePath, query, listing.page + 1);
  const loadMore = async () => {
    if (busy.current || !hasMore) return;
    busy.current = true;
    setLoading(true);
    setError('');
    const next = listing.page + 1;
    controller.current = new AbortController();
    const request = controller.current;
    const timeout = setTimeout(() => request.abort(), 20_000);
    try {
      const response = await fetch(
        `/catalog/products?${catalogApiQuery(new URLSearchParams(query), next)}`,
        { signal: controller.current.signal },
      );
      if (!response.ok) throw new Error('Catalog unavailable');
      const { data } = (await response.json()) as { data: CatalogPage };
      if (
        !data ||
        !Array.isArray(data.items) ||
        data.items.length > CATALOG_PAGE_SIZE ||
        data.page !== next ||
        !Number.isSafeInteger(data.total) ||
        data.total < 0 ||
        !Number.isSafeInteger(data.totalPages) ||
        data.totalPages < 0
      )
        throw new Error('Invalid catalog response');
      if (!mounted.current) return;
      setListing((current) => ({
        ...data,
        items: appendCatalogProducts(current.items, data.items),
        exhausted: data.items.length === 0,
      }));
    } catch {
      if (mounted.current) setError('دریافت محصولات انجام نشد. دوباره تلاش کنید.');
    } finally {
      clearTimeout(timeout);
      busy.current = false;
      if (mounted.current) setLoading(false);
    }
  };
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    // Preserve open-in-new-tab and the actual paginated URL for crawlers and
    // visitors without JavaScript. Normal clicks append without navigating.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    void loadMore();
  };

  return (
    <>
      <div className={`product-grid ${gridClassName}`.trim()} aria-busy={loading}>
        {listing.items.map(renderProduct)}
      </div>
      <nav className="catalog-load-more" aria-label="ادامهٔ فهرست محصولات">
        <p role="status" aria-live="polite">
          نمایش {formatPersianNumber(listing.items.length)} از{' '}
          {formatPersianNumber(Math.max(listing.total, listing.items.length))} محصول
        </p>
        {error && (
          <p className="catalog-load-error" role="alert">
            {error}
          </p>
        )}
        {hasMore ? (
          <a
            className="button button-primary catalog-load-button"
            role="button"
            rel="next"
            href={nextHref}
            aria-disabled={loading}
            onClick={click}
            onKeyDown={(event) => {
              if (event.key === ' ') {
                event.preventDefault();
                void loadMore();
              }
            }}
          >
            {loading
              ? 'در حال دریافت محصولات…'
              : error
                ? 'تلاش مجدد برای نمایش بیشتر'
                : 'نمایش محصولات بیشتر'}
            {!loading && <span aria-hidden="true">↓</span>}
          </a>
        ) : (
          <p className="muted">به پایان نتایج رسیدید.</p>
        )}
        {initial.page > 1 && (
          <a
            rel="prev"
            className="catalog-previous"
            href={catalogPageHref(pagePath, query, initial.page - 1)}
          >
            مشاهدهٔ محصولات قبلی
          </a>
        )}
      </nav>
    </>
  );
}
