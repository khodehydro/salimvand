import { ThemeProvider, ThemeToggle, TokenGallery } from '@salimvand/ui';
import type { Theme } from '@salimvand/ui';

/**
 * Phase 0 acceptance view: renders the whole design system (tokens, components,
 * charts) so both skins can be reviewed in a real browser.
 * Reachable at `/#design-system` in the admin app.
 */
function Gallery() {
  return (
    <div style={{ display: 'grid', gap: 16, padding: 24, maxWidth: 1100, margin: 'auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <strong>سیستم طراحی سلیم‌وند</strong>
          <p style={{ margin: '4px 0 0', fontSize: 12 }}>توکن‌ها، اجزا و نمودارها — هر دو پوسته</p>
        </div>
        <ThemeToggle />
      </header>
      <TokenGallery />
    </div>
  );
}

export function DesignSystemRoute({ initialTheme = 'light' }: { initialTheme?: Theme }) {
  return (
    <ThemeProvider theme={initialTheme}>
      <Gallery />
    </ThemeProvider>
  );
}
