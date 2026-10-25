import type { Metadata } from 'next';
import './mini.css';

// The public website remains the canonical, indexable storefront.
export const metadata: Metadata = {
  title: 'کاتالوگ همراه',
  robots: { index: false, follow: false },
  alternates: { canonical: '/' },
};
export default function MiniLayout({ children }: { children: React.ReactNode }) {
  return <div className="mini-root">{children}</div>;
}
