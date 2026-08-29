import { APP_NAME } from '@salimvand/shared';
import { ThemeToggle } from './ThemeToggle';

export function PublicSubHeader({ context }: { context: string }) {
  return <header className="sub-header">
    <a className="brand-lockup" href="/">
      <span className="brand-mark">س</span>
      <span><strong>{APP_NAME}</strong><small>{context}</small></span>
    </a>
    <nav><a href="/#catalog">کاتالوگ</a><a href="/#contact">تماس</a><ThemeToggle /></nav>
  </header>;
}
