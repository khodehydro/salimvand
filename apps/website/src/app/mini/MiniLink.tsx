'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CATALOG_LEAVE_EVENT } from '../catalog-return';

/** Keep the host SDK alive across routes; no eager fetch of all product pages. */
export function MiniLink({
  href,
  children,
  className,
  label,
  current,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  label?: string;
  current?: 'page';
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={className}
      aria-label={label}
      aria-current={current}
      onClick={(event) => {
        if (
          event.button === 0 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.altKey
        )
          window.dispatchEvent(new Event(CATALOG_LEAVE_EVENT));
      }}
    >
      {children}
    </Link>
  );
}
