'use client';
import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CATALOG_LEAVE_EVENT } from '../catalog-return';
import { MiniIcon } from './MiniIcon';

/** One search field in the sticky shell, including product/contact pages. */
export function MiniSearch({ base }: { base: string }) {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams().toString();
  const [value, setValue] = useState(new URLSearchParams(search).get('q') || '');
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    setValue(new URLSearchParams(search).get('q') || '');
  }, [path, search]);
  return (
    <form
      className="mini-search-row mini-header-search"
      role="search"
      aria-label="جست‌وجوی کاتالوگ"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        const query = new URLSearchParams(path === base ? search : '');
        query.delete('page');
        if (value.trim()) query.set('q', value.trim());
        else query.delete('q');
        window.dispatchEvent(new Event(CATALOG_LEAVE_EVENT));
        startTransition(() =>
          router.push(base + (query.size ? `?${query}` : ''), { scroll: true }),
        );
      }}
    >
      <label className="mini-search-field">
        <MiniIcon name="search" />
        <input
          id="mini-search"
          name="q"
          type="search"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={100}
          placeholder="نام قطعه یا شماره فنی…"
          aria-label="جست‌وجوی محصول"
          enterKeyHint="search"
          autoComplete="off"
        />
      </label>
      <button type="submit" className="mini-search-submit" disabled={pending} aria-label="جست‌وجو">
        {pending ? '…' : <MiniIcon name="arrow" />}
      </button>
    </form>
  );
}
