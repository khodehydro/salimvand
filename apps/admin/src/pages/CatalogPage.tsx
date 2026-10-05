import type { ReactNode } from 'react';
import { ProductsPage } from './ProductsPage';
import { InventoryPage } from './InventoryPage';
import { formatPersianNumber } from '@salimvand/shared';

/**
 * Merged catalog+warehouse page: ONE sidebar entry, ONE screen. The old
 * split (کاتالوگ محصولات here, انبار و موجودی there) forced operators to
 * hunt through the menu for every task; now the two views are tabs of the
 * same page. Each tab keeps its full page component unchanged — the wrapper
 * only renders the switcher and delegates.
 *
 * Routing stays deep-linkable: #/products opens the catalog tab and
 * #/inventory opens the warehouse tab (old links and the command palette
 * keep working). Switching tabs rewrites the hash so the view is shareable.
 */
export type CatalogTab = 'products' | 'inventory';

export function CatalogPage({
  tab,
  onTab,
}: {
  tab: CatalogTab;
  onTab: (tab: CatalogTab) => void;
}) {
  const tabs: Array<{ id: CatalogTab; label: string; icon: ReactNode }> = [
    {
      id: 'products',
      label: 'محصولات',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M20 7 12 3 4 7v10l8 4 8-4z" />
          <path d="M4 7l8 4 8-4M12 11v10" />
        </svg>
      ),
    },
    {
      id: 'inventory',
      label: 'انبار و موجودی',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M3 9h18M3 9l2-5h14l2 5M5 9v11h14V9M9 14h6" />
        </svg>
      ),
    },
  ];
  return (
    <div className="catalog-page">
      <nav className="catalog-tabs" aria-label="بخش محصولات و انبار">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`catalog-tab${tab === entry.id ? ' is-active' : ''}`}
            aria-current={tab === entry.id ? 'page' : undefined}
            onClick={() => onTab(entry.id)}
          >
            <span className="catalog-tab-icon">{entry.icon}</span>
            <span className="catalog-tab-label">
              {entry.label}
              <small>
                {entry.id === 'products'
                  ? 'لیست، ویرایش و ثبت محصول'
                  : 'موجودی، قفسه‌ها و ورود/جابه‌جایی کالا'}
              </small>
            </span>
          </button>
        ))}
      </nav>
      {tab === 'products' ? <ProductsPage /> : <InventoryPage />}
    </div>
  );
}
