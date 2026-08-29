'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'salimvand.theme';

/**
 * Theme switch for the public site. The initial value comes from the inline
 * bootstrap script in `layout.tsx` so the first paint already has the right
 * `data-theme` attribute (no flash of the wrong skin).
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const initial =
      stored === 'dark' || stored === 'light'
        ? stored
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    setTheme(initial);
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'پوستهٔ روشن' : 'پوستهٔ تاریک'}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
