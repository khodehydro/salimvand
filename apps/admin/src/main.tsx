import { createRoot } from 'react-dom/client';
import { CommandPalette, ToastStack, installDesignSystemCss, type PaletteGroup } from '@salimvand/ui';
import { DesignSystemRoute } from './DesignSystemRoute';
import { useEffect, useState } from 'react';
import { APP_NAME, type UserRole } from '@salimvand/shared';
import { MediaPage } from './pages/MediaPage';
import { api } from './lib/api';
import { LoginPage } from './pages/LoginPage';
import { ProductsPage } from './pages/ProductsPage';
import { InventoryPage } from './pages/InventoryPage';
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
import { canAccessPage } from './lib/admin-permissions';
import 'vazirmatn/Vazirmatn-font-face.css';
import './styles.css';

type NavItem = { id: Page; label: string; icon: string };
const navItems: NavItem[] = [
  { id: 'dashboard', label: 'داشبورد', icon: '⌂' }, { id: 'purchases', label: 'خرید و تأمین', icon: '⇧' }, { id: 'suppliers', label: 'تأمین‌کنندگان', icon: '♧' }, { id: 'invoices', label: 'فروش و فاکتورها', icon: '▤' }, { id: 'customers', label: 'مشتریان', icon: '♙' }, { id: 'products', label: 'کاتالوگ محصولات', icon: '▦' }, { id: 'inventory', label: 'انبار و موجودی', icon: '⌗' }, { id: 'media', label: 'رسانه‌ها', icon: '◫' }, { id: 'references', label: 'برندها و خودروها', icon: '◇' }, { id: 'reports', label: 'گزارش‌ها', icon: '◒' }, { id: 'settings', label: 'تنظیمات', icon: '⚙' }, { id: 'messaging', label: 'پیامک و کانال\u200cها', icon: '✉' }, { id: 'users', label: 'کاربران', icon: '♙' }, { id: 'audit', label: 'تاریخچه تغییرات', icon: '◷' },
];
const pageTitles: Record<Page, string> = { dashboard: 'داشبورد', messaging: 'پیامک و کانال\u200cها', products: 'کاتالوگ محصولات', inventory: 'انبار و موجودی', invoices: 'فروش و فاکتورها', media: 'رسانه‌ها', references: 'برندها و خودروها', reports: 'گزارش‌ها', settings: 'تنظیمات سیستم', users: 'کاربران و نقش‌ها', audit: 'تاریخچه تغییرات', customers: 'مشتریان', suppliers: 'تأمین‌کنندگان', purchases: 'فاکتورهای خرید' };

function AdminPalette({ items, onSelect, onClose }: { items: NavItem[]; onSelect: (page: Page) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ products: Array<{ name: string; code: string }>; customers: Array<{ name: string; mobile: string }>; invoices: Array<{ number: string; customerName: string | null }> }>({ products: [], customers: [], invoices: [] });
  useEffect(() => {
    if (query.trim().length < 2) { setResults({ products: [], customers: [], invoices: [] }); return; }
    const timer = window.setTimeout(() => {
      void api<{ data: { products: Array<{ name: string; code: string }>; customers: Array<{ name: string; mobile: string }>; invoices: Array<{ number: string; customerName: string | null }> } }>(`/search?q=${encodeURIComponent(query)}`)
        .then((response) => setResults(response.data))
        .catch(() => setResults({ products: [], customers: [], invoices: [] }));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);
  const pages = items.filter((item) => !query.trim() || item.label.includes(query.trim()));
  const groups: PaletteGroup[] = [
    { id: 'pages', label: 'صفحه‌ها', items: pages.map((item) => ({ label: item.label, detail: 'پرش به صفحه', onSelect: () => onSelect(item.id) })) },
    { id: 'products', label: 'محصولات', items: results.products.map((item) => ({ label: item.name, detail: item.code, onSelect: () => onSelect('products') })) },
    { id: 'customers', label: 'مشتریان', items: results.customers.map((item) => ({ label: item.name, detail: item.mobile, onSelect: () => onSelect('invoices') })) },
    { id: 'invoices', label: 'فاکتورها', items: results.invoices.map((item) => ({ label: item.number, detail: item.customerName ?? 'فاکتور', onSelect: () => onSelect('invoices') })) },
  ];
  return <CommandPalette open groups={groups} onClose={onClose} query={query} onQueryChange={setQuery} filterLocally={false} />;
}

function App() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(localStorage.getItem('salimvand.accessToken'))); const [dark, setDark] = useState(() => localStorage.getItem('salimvand.theme') === 'dark'); const [role, setRole] = useState<UserRole | ''>(''); const [page, setPage] = useState<Page>(() => pageFromHash(window.location.hash)); const [paletteOpen, setPaletteOpen] = useState(false); const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('salimvand.theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => { const onHashChange = () => setPage(pageFromHash(window.location.hash)); window.addEventListener('hashchange', onHashChange); return () => window.removeEventListener('hashchange', onHashChange); }, []);
  useEffect(() => { const listener = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen(true); } }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, []);
  useEffect(() => { if (authenticated) void api<{ data: { role: UserRole } }>('/auth/me').then((result) => setRole(result.data.role)).catch(() => { localStorage.removeItem('salimvand.accessToken'); setAuthenticated(false); }); }, [authenticated]);
  useEffect(() => { if (role && !canAccessPage(role, page)) { window.location.hash = hashForPage('dashboard'); setPage('dashboard'); } }, [role, page]);
  if (!authenticated) return <LoginPage onLogin={() => setAuthenticated(true)} />;
  const visibleItems = navItems.filter((item) => canAccessPage(role, item.id));
  const navigate = (next: Page) => { window.location.hash = hashForPage(next); setPage(next); setMobileOpen(false); setPaletteOpen(false); };
  return <div className={`admin ${dark ? 'theme-dark' : ''}`}><aside className={mobileOpen ? 'open' : ''}><div className="aside-brand"><span className="brand-mark">س</span><span><strong>سلیم‌وند</strong><small>ERP فروشگاه</small></span></div><nav>{visibleItems.map((item) => <button className={page === item.id ? 'active' : ''} key={item.id} onClick={() => navigate(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}{item.id === 'inventory' && <i className="nav-count">!</i>}</button>)}</nav><div className="aside-footer"><span className="online-dot" /> سیستم آنلاین</div></aside><main><header className="admin-topbar"><button className="mobile-menu" onClick={() => setMobileOpen(!mobileOpen)} aria-label="باز کردن منو">☰</button><div className="topbar-title"><span>مدیریت</span><b>{pageTitles[page]}</b></div><button className="global-search" onClick={() => setPaletteOpen(true)}>⌕ <span>جست‌وجوی سریع</span><kbd>Ctrl K</kbd></button><button className="theme-button" onClick={() => setDark(!dark)} aria-label="تغییر پوسته">{dark ? '☀' : '☾'}</button><span className="notification">♧<i /></span><div className="user-chip"><span className="avatar">{role === 'super_admin' ? 'م' : 'ک'}</span><span><b>{APP_NAME}</b><small>{role === 'super_admin' ? 'مدیر کل' : role === 'manager' ? 'مدیر' : 'کاربر پنل'}</small></span></div><button className="logout" onClick={() => { void api('/auth/logout', { method: 'POST' }).finally(() => { localStorage.removeItem('salimvand.accessToken'); setAuthenticated(false); }); }}>خروج</button></header>{page === 'dashboard' ? <DashboardPage /> : page === 'products' ? <ProductsPage /> : page === 'invoices' ? <InvoicesPage /> : page === 'media' ? <MediaPage /> : page === 'inventory' ? <InventoryPage /> : page === 'reports' ? <ReportsPage /> : page === 'settings' ? <SettingsPage /> : page === 'messaging' ? <MessagingPage /> : page === 'users' ? <UsersPage /> : page === 'audit' ? <AuditLogsPage /> : page === 'customers' ? <CustomersPage /> : page === 'suppliers' ? <SuppliersPage /> : page === 'purchases' ? <PurchasesPage /> : <ReferencesPage />}</main>{paletteOpen && <AdminPalette items={visibleItems} onSelect={navigate} onClose={() => setPaletteOpen(false)} />}<nav className="mobile-nav">{visibleItems.slice(0, 4).map((item) => <button className={page === item.id ? 'active' : ''} key={item.id} onClick={() => navigate(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav><button className="admin-fab" onClick={() => navigate('invoices')}>＋ صدور فاکتور</button><ToastStack /></div>;
}
installDesignSystemCss();
const rootElement = createRoot(document.getElementById('root')!);
if (window.location.hash === '#design-system') {
  rootElement.render(<DesignSystemRoute initialTheme={localStorage.getItem('salimvand.theme') === 'dark' ? 'dark' : 'light'} />);
} else {
  rootElement.render(<App />);
}
