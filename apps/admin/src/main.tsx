import { createRoot } from 'react-dom/client';
import {
  CommandPalette,
  ToastStack,
  installDesignSystemCss,
  type PaletteGroup,
} from '@salimvand/ui';
import { DesignSystemRoute } from './DesignSystemRoute';
import { Component, useEffect, useState, type ReactNode } from 'react';
import { APP_NAME, type UserRole } from '@salimvand/shared';
import { MediaPage } from './pages/MediaPage';
import { api, downloadFile } from './lib/api';
import { LoginPage } from './pages/LoginPage';
import { ProductsPage } from './pages/ProductsPage';
import { InventoryPage } from './pages/InventoryPage';
import { LabelsPage } from './pages/LabelsPage';
import { ReferencesPage } from './pages/ReferencesPage';
import { DashboardPage } from './pages/DashboardPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { MessagingPage } from './pages/MessagingPage';
import { UsersPage } from './pages/UsersPage';
import { CustomersPage } from './pages/CustomersPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { hashForPage, pageFromHash, type AdminPage as Page } from './lib/admin-route';
import {
  canAccessPage,
  customerCapabilities,
  dashboardCapabilities,
  invoiceCapabilities,
} from './lib/admin-permissions';
import 'vazirmatn/Vazirmatn-font-face.css';
import './styles.css';

type NavIconName =
  | 'dashboard'
  | 'invoice'
  | 'customers'
  | 'inventory'
  | 'labels'
  | 'products'
  | 'purchases'
  | 'suppliers'
  | 'media'
  | 'references'
  | 'reports'
  | 'messaging'
  | 'users'
  | 'audit'
  | 'settings';
type NavItem = { id: Page; label: string; icon: NavIconName };

/** Small inline icons keep the shell visually consistent with the SVG-based
 * reference UI and avoid platform-dependent emoji glyphs in the sidebar. */
function NavIcon({ name }: { name: NavIconName }) {
  const paths: Record<NavIconName, ReactNode> = {
    dashboard: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    invoice: <><path d="M6 3h9l3 3v15H6z" /><path d="M15 3v4h4M9 12h6M9 16h6" /></>,
    customers: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5.5a3 3 0 0 1 0 5.5M18 15a4 4 0 0 1 3 4v1" /></>,
    inventory: <><path d="m4 8 8-4 8 4-8 4zM4 8v8l8 4 8-4V8M12 12v8" /></>,
    labels: <><path d="M4 5a2 2 0 0 1 2-2h7l7 7-9 9-7-7z" /><circle cx="8" cy="7" r="1" /></>,
    products: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    purchases: <><path d="M5 5h10a3 3 0 0 1 3 3v11M5 5v14a2 2 0 0 0 2 2h11" /><path d="M9 9h5M9 13h5" /></>,
    suppliers: <><path d="M3 7h11v10H3zM14 10h4l3 3v4h-7" /><circle cx="7" cy="19" r="2" /><circle cx="18" cy="19" r="2" /></>,
    media: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="2" /><path d="m4 17 5-5 3 3 2-2 6 6" /></>,
    references: <><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4a12 12 0 0 1 0 16M12 4a12 12 0 0 0 0 16" /></>,
    reports: <><path d="M5 20V10M12 20V4M19 20v-7" /><path d="M3 20h18" /></>,
    messaging: <><path d="M4 5h16v11H8l-4 4z" /><path d="M8 9h8M8 12h5" /></>,
    users: <><circle cx="12" cy="8" r="3" /><path d="M5 20a7 7 0 0 1 14 0M18 6a3 3 0 0 1 3 3" /></>,
    audit: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19 15 1 2-2 2-2-1-2 1-1 2h-2l-1-2-2-1-2 1-2-2 1-2-1-2 1-2-1-2 2-2 2 1 2-1 1-2h2l1 2 2 1 2-1 2 2-1 2 1 2z" /></>,
  };
  return <svg className="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
const navItems: NavItem[] = [
  { id: 'dashboard', label: 'داشبورد', icon: 'dashboard' },
  { id: 'invoices', label: 'فروش و فاکتورها', icon: 'invoice' },
  { id: 'customers', label: 'مشتریان', icon: 'customers' },
  { id: 'inventory', label: 'انبار و موجودی', icon: 'inventory' },
  { id: 'labels', label: 'برچسب محصولات', icon: 'labels' },
  { id: 'products', label: 'محصولات', icon: 'products' },
  { id: 'purchases', label: 'خرید و تأمین', icon: 'purchases' },
  { id: 'suppliers', label: 'تأمین‌کنندگان', icon: 'suppliers' },
  { id: 'media', label: 'رسانه‌ها', icon: 'media' },
  { id: 'references', label: 'برندها و خودروها', icon: 'references' },
  { id: 'reports', label: 'گزارش‌ها', icon: 'reports' },
  { id: 'messaging', label: 'پیامک و کانال\u200cها', icon: 'messaging' },
  { id: 'users', label: 'کاربران', icon: 'users' },
  { id: 'audit', label: 'تاریخچه تغییرات', icon: 'audit' },
  { id: 'settings', label: 'تنظیمات', icon: 'settings' },
];
// Grouping mirrors the documented admin shell: a short primary section,
// the store workflow, then management/system tools. Keep the groups stable so
// the sidebar, mobile navigation and command palette use the same information
// architecture as the UI reference.
const navGroups: Array<{ label: string; ids: Page[] }> = [
  { label: 'اصلی', ids: ['dashboard'] },
  {
    label: 'فروشگاه',
    ids: [
      'products',
      'inventory',
      'labels',
      'invoices',
      'customers',
      'purchases',
      'suppliers',
      'media',
      'references',
    ],
  },
  { label: 'مدیریت', ids: ['reports', 'messaging', 'settings', 'users', 'audit'] },
];
const pageTitles: Record<Page, string> = {
  dashboard: 'داشبورد',
  messaging: 'پیامک و کانال\u200cها',
  products: 'کاتالوگ محصولات',
  inventory: 'انبار و موجودی',
  labels: 'برچسب محصولات',
  invoices: 'فروش و فاکتورها',
  media: 'رسانه‌ها',
  references: 'برندها و خودروها',
  reports: 'گزارش‌ها',
  settings: 'تنظیمات سیستم',
  users: 'کاربران و نقش‌ها',
  audit: 'تاریخچه تغییرات',
  customers: 'مشتریان',
  suppliers: 'تأمین‌کنندگان',
  purchases: 'فاکتورهای خرید',
};

function AdminPalette({
  items,
  onSelect,
  onClose,
}: {
  items: NavItem[];
  onSelect: (page: Page, params?: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{
    products: Array<{ id: string; name: string; code: string }>;
    customers: Array<{ id: string; name: string; mobile: string }>;
    invoices: Array<{ id: string; number: string; customerName: string | null }>;
  }>({ products: [], customers: [], invoices: [] });
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults({ products: [], customers: [], invoices: [] });
      return;
    }
    const timer = window.setTimeout(() => {
      void api<{
        data: {
          products: Array<{ id: string; name: string; code: string }>;
          customers: Array<{ id: string; name: string; mobile: string }>;
          invoices: Array<{ id: string; number: string; customerName: string | null }>;
        };
      }>(`/search?q=${encodeURIComponent(query)}`)
        .then((response) => setResults(response.data))
        .catch(() => setResults({ products: [], customers: [], invoices: [] }));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);
  const pages = items.filter((item) => !query.trim() || item.label.includes(query.trim()));
  const groups: PaletteGroup[] = [
    {
      id: 'pages',
      label: 'صفحه‌ها',
      items: pages.map((item) => ({
        label: item.label,
        detail: 'پرش به صفحه',
        onSelect: () => onSelect(item.id),
      })),
    },
    {
      id: 'products',
      label: 'محصولات',
      items: results.products.map((item) => ({
        label: item.name,
        detail: item.code,
        onSelect: () => onSelect('products', { edit: item.id }),
      })),
    },
    {
      id: 'customers',
      label: 'مشتریان',
      items: results.customers.map((item) => ({
        label: item.name,
        detail: item.mobile,
        onSelect: () => onSelect('customers', { customer: item.id }),
      })),
    },
    {
      id: 'invoices',
      label: 'فاکتورها',
      items: results.invoices.map((item) => ({
        label: item.number,
        detail: item.customerName ?? 'فاکتور',
        onSelect: () => onSelect('invoices', { invoice: item.id }),
      })),
    },
  ];
  return (
    <CommandPalette
      open
      groups={groups}
      onClose={onClose}
      query={query}
      onQueryChange={setQuery}
      filterLocally={false}
    />
  );
}

/** A render crash in one page must show a readable card, never a white screen. */
class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: unknown) {
    console.error('[admin] page render failed:', error);
  }
  render() {
    if (this.state.error)
      return (
        <section style={{ padding: 30 }}>
          <div className="notice">در نمایش این بخش خطایی رخ داد: {this.state.error.message}</div>
          <button
            className="outline"
            style={{ marginTop: 12 }}
            onClick={() => this.setState({ error: null })}
          >
            تلاش دوباره
          </button>
        </section>
      );
    return this.props.children;
  }
}

function App() {
  const [authenticated, setAuthenticated] = useState(() =>
    Boolean(localStorage.getItem('salimvand.accessToken')),
  );
  const [dark, setDark] = useState(() => localStorage.getItem('salimvand.theme') === 'dark');
  const [role, setRole] = useState<UserRole | ''>('');
  const [page, setPage] = useState<Page>(() => pageFromHash(window.location.hash));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Running release, exposed by the API on /health — shown in the sidebar so
  // anyone can verify the last deploy actually landed (source of many
  // "I fixed it but the panel looks the same" reports).
  const [release, setRelease] = useState('');
  useEffect(() => {
    api<{ data?: { release?: string } }>('/health')
      .then((result) => setRelease(result.data?.release ?? ''))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('salimvand.theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => {
    if (authenticated)
      void api<{ data: { role: UserRole } }>('/auth/me')
        .then((result) => setRole(result.data.role))
        .catch(() => {
          localStorage.removeItem('salimvand.accessToken');
          setAuthenticated(false);
        });
  }, [authenticated]);
  useEffect(() => {
    if (role && !canAccessPage(role, page)) {
      window.location.hash = hashForPage('dashboard');
      setPage('dashboard');
    }
  }, [role, page]);
  if (!authenticated) return <LoginPage onLogin={() => setAuthenticated(true)} />;
  const visibleItems = navItems.filter((item) => canAccessPage(role, item.id));
  // Mobile follows the documented daily workflow: dashboard, inventory, sales,
  // then customers. Desktop keeps its fuller information architecture.
  const mobileItems = ['dashboard', 'inventory', 'invoices', 'customers']
    .map((id) => visibleItems.find((item) => item.id === id))
    .filter((item): item is NavItem => Boolean(item));
  const dashboardAccess = dashboardCapabilities(role);
  const invoiceAccess = invoiceCapabilities(role);
  const customerAccess = customerCapabilities(role);
  const exportLabel = page === 'reports' ? 'خروجی گزارش' : page === 'inventory' ? 'خروجی انبار' : 'خروجی';
  const exportPath = page === 'reports' ? '/reports/sales/export' : '/reports/inventory/export';
  const exportFile = page === 'reports' ? 'salimvand-sales.csv' : 'salimvand-inventory.csv';
  const navigate = (next: Page, params?: Record<string, string>) => {
    window.location.hash = hashForPage(next, params);
    setPage(next);
    setMobileOpen(false);
    setPaletteOpen(false);
  };
  return (
    <div className={`admin ${dark ? 'theme-dark' : ''}`}>
      <aside className={mobileOpen ? 'open' : ''}>
        <div className="aside-brand">
          <span className="brand-mark">س</span>
          <span>
            <strong>سلیم‌وند</strong>
            <small>ERP فروشگاه</small>
          </span>
        </div>
        <nav>
          {navGroups.map((group) => {
            const groupItems = visibleItems.filter((item) => group.ids.includes(item.id));
            if (!groupItems.length) return null;
            return (
              <div className="nav-group" key={group.label}>
                <small>{group.label}</small>
                {groupItems.map((item) => (
                  <button
                    className={page === item.id ? 'active' : ''}
                    key={item.id}
                    onClick={() => navigate(item.id)}
                  >
                    <span className="nav-icon"><NavIcon name={item.icon} /></span>
                    {item.label}
                    {item.id === 'inventory' && <i className="nav-count">!</i>}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="aside-footer">
          <span className="online-dot" /> سیستم آنلاین
          {release && <small className="release-tag">نسخهٔ {release}</small>}
        </div>
      </aside>
      <main>
        <header className="admin-topbar">
          <button
            className="mobile-menu"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="باز کردن منو"
          >
            ☰
          </button>
          <div className="topbar-title">
            <span>مدیریت</span>
            <b>{pageTitles[page]}</b>
          </div>
          {(page === 'dashboard' || page === 'reports' || page === 'inventory') && (
            <button
              className="topbar-export"
              onClick={() => void downloadFile(exportPath, exportFile).catch((error: Error) => console.error(error))}
            >
              خروجی <span>{exportLabel}</span>
            </button>
          )}
          {invoiceAccess.canCreate && (
            <button className="topbar-new-invoice" onClick={() => navigate('invoices')}>
              ＋ فاکتور جدید
            </button>
          )}
          <button className="global-search" onClick={() => setPaletteOpen(true)}>
            ⌕ <span>جست‌وجوی سریع</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button className="theme-button" onClick={() => setDark(!dark)} aria-label="تغییر پوسته">
            {dark ? '☀' : '☾'}
          </button>
          <span className="notification">
            ♧<i />
          </span>
          <div className="user-chip">
            <span className="avatar">{role === 'super_admin' ? 'م' : 'ک'}</span>
            <span>
              <b>{APP_NAME}</b>
              <small>
                {role === 'super_admin' ? 'مدیر کل' : role === 'manager' ? 'مدیر' : 'کاربر پنل'}
              </small>
            </span>
          </div>
          <button
            className="logout"
            onClick={() => {
              void api('/auth/logout', { method: 'POST' }).finally(() => {
                localStorage.removeItem('salimvand.accessToken');
                setAuthenticated(false);
              });
            }}
          >
            خروج
          </button>
        </header>
        <PageErrorBoundary>
          {page === 'dashboard' ? (
            <DashboardPage {...dashboardAccess} />
          ) : page === 'products' ? (
            <ProductsPage />
          ) : page === 'invoices' ? (
            <InvoicesPage {...invoiceAccess} />
          ) : page === 'media' ? (
            <MediaPage />
          ) : page === 'inventory' ? (
            <InventoryPage />
          ) : page === 'labels' ? (
            <LabelsPage />
          ) : page === 'reports' ? (
            <ReportsPage />
          ) : page === 'settings' ? (
            <SettingsPage />
          ) : page === 'messaging' ? (
            <MessagingPage />
          ) : page === 'users' ? (
            <UsersPage />
          ) : page === 'audit' ? (
            <AuditLogsPage />
          ) : page === 'customers' ? (
            <CustomersPage {...customerAccess} />
          ) : page === 'suppliers' ? (
            <SuppliersPage canManage={role === 'manager' || role === 'super_admin'} />
          ) : page === 'purchases' ? (
            <PurchasesPage canCreate={role === 'manager' || role === 'super_admin'} />
          ) : (
            <ReferencesPage />
          )}
        </PageErrorBoundary>
      </main>
      {paletteOpen && (
        <AdminPalette
          items={visibleItems}
          onSelect={navigate}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      <nav className="mobile-nav">
        {mobileItems.map((item) => (
          <button
            className={page === item.id ? 'active' : ''}
            key={item.id}
            onClick={() => navigate(item.id)}
          >
            <span className="mobile-nav-icon"><NavIcon name={item.icon} /></span>
            {item.label}
          </button>
        ))}
      </nav>
      {invoiceAccess.canCreate && (
        <button className="admin-fab" onClick={() => navigate('invoices')}>
          ＋ صدور فاکتور
        </button>
      )}
      <ToastStack />
    </div>
  );
}
installDesignSystemCss();
const rootElement = createRoot(document.getElementById('root')!);
if (window.location.hash === '#design-system') {
  rootElement.render(
    <DesignSystemRoute
      initialTheme={localStorage.getItem('salimvand.theme') === 'dark' ? 'dark' : 'light'}
    />,
  );
} else {
  rootElement.render(<App />);
}
