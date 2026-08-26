import { createRoot } from 'react-dom/client';
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
import { UsersPage } from './pages/UsersPage';
import './styles.css';

type Page = 'dashboard' | 'products' | 'inventory' | 'invoices' | 'media' | 'references' | 'reports' | 'settings' | 'users';
type NavItem = { id: Page; label: string; icon: string; roles?: UserRole[] };
const navItems: NavItem[] = [
  { id: 'dashboard', label: 'داشبورد', icon: '⌂' }, { id: 'invoices', label: 'فروش و فاکتورها', icon: '▤' }, { id: 'products', label: 'کاتالوگ محصولات', icon: '▦' }, { id: 'inventory', label: 'انبار و موجودی', icon: '⌗' }, { id: 'media', label: 'رسانه‌ها', icon: '◫' }, { id: 'references', label: 'برندها و خودروها', icon: '◇', roles: ['manager', 'super_admin'] }, { id: 'reports', label: 'گزارش‌ها', icon: '◒', roles: ['manager', 'super_admin', 'accountant'] }, { id: 'settings', label: 'تنظیمات', icon: '⚙', roles: ['manager', 'super_admin'] }, { id: 'users', label: 'کاربران', icon: '♙', roles: ['super_admin'] },
];
const pageTitles: Record<Page, string> = { dashboard: 'داشبورد', products: 'کاتالوگ محصولات', inventory: 'انبار و موجودی', invoices: 'فروش و فاکتورها', media: 'رسانه‌ها', references: 'برندها و خودروها', reports: 'گزارش‌ها', settings: 'تنظیمات سیستم', users: 'کاربران و نقش‌ها' };

function CommandPalette({ items, onSelect, onClose }: { items: NavItem[]; onSelect: (page: Page) => void; onClose: () => void }) {
  const [query, setQuery] = useState(''); const [results, setResults] = useState<Array<{ label: string; detail: string; page: Page }>>([]); const filtered = items.filter((item) => item.label.includes(query) || item.id.includes(query));
  useEffect(() => { if (query.trim().length < 2) { setResults([]); return; } const timer = window.setTimeout(() => { void api<{ data: { products: Array<{ name: string; code: string }>; customers: Array<{ name: string; mobile: string }>; invoices: Array<{ number: string; customerName: string | null }> } }>(`/search?q=${encodeURIComponent(query)}`).then((response) => setResults([...response.data.products.map((item) => ({ label: item.name, detail: item.code, page: 'products' as Page })), ...response.data.customers.map((item) => ({ label: item.name, detail: item.mobile, page: 'invoices' as Page })), ...response.data.invoices.map((item) => ({ label: item.number, detail: item.customerName ?? 'فاکتور', page: 'invoices' as Page }))])); }, 180); return () => window.clearTimeout(timer); }, [query]);
  const paletteItems = results.length ? results : filtered.map((item) => ({ label: item.label, detail: '', page: item.id }));
  return <div className="palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="command-palette" role="dialog" aria-label="جست‌وجوی پنل"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جست‌وجوی محصول، مشتری یا فاکتور..." onKeyDown={(event) => { if (event.key === 'Escape') onClose(); if (event.key === 'Enter' && paletteItems[0]) { onSelect(paletteItems[0].page); onClose(); } }} /> <div className="palette-results">{paletteItems.map((item, index) => <button key={`${item.page}-${item.label}-${index}`} onClick={() => { onSelect(item.page); onClose(); }}><span className="palette-key">{index + 1}</span><span>⌕</span><span>{item.label}<small className="palette-detail">{item.detail}</small></span><kbd>{index < 5 ? index + 1 : ''}</kbd></button>)}</div><small>↑↓ جابه‌جویی · Enter انتخاب · Esc بستن</small></div></div>;
}

function App() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(localStorage.getItem('salimvand.accessToken'))); const [dark, setDark] = useState(() => localStorage.getItem('salimvand.theme') === 'dark'); const [role, setRole] = useState<UserRole | ''>(''); const [page, setPage] = useState<Page>('dashboard'); const [paletteOpen, setPaletteOpen] = useState(false); const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('salimvand.theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => { const listener = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen(true); } }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, []);
  useEffect(() => { if (authenticated) void api<{ data: { role: UserRole } }>('/auth/me').then((result) => setRole(result.data.role)).catch(() => { localStorage.removeItem('salimvand.accessToken'); setAuthenticated(false); }); }, [authenticated]);
  if (!authenticated) return <LoginPage onLogin={() => setAuthenticated(true)} />;
  const visibleItems = navItems.filter((item) => !item.roles || (role && item.roles.includes(role)));
  const navigate = (next: Page) => { setPage(next); setMobileOpen(false); };
  return <div className={`admin ${dark ? 'theme-dark' : ''}`}><aside className={mobileOpen ? 'open' : ''}><div className="aside-brand"><span className="brand-mark">س</span><span><strong>سلیم‌وند</strong><small>ERP فروشگاه</small></span></div><nav>{visibleItems.map((item) => <button className={page === item.id ? 'active' : ''} key={item.id} onClick={() => navigate(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}{item.id === 'inventory' && <i className="nav-count">!</i>}</button>)}</nav><div className="aside-footer"><span className="online-dot" /> سیستم آنلاین</div></aside><main><header className="admin-topbar"><button className="mobile-menu" onClick={() => setMobileOpen(!mobileOpen)} aria-label="باز کردن منو">☰</button><div className="topbar-title"><span>مدیریت</span><b>{pageTitles[page]}</b></div><button className="global-search" onClick={() => setPaletteOpen(true)}>⌕ <span>جست‌وجوی سریع</span><kbd>Ctrl K</kbd></button><button className="theme-button" onClick={() => setDark(!dark)} aria-label="تغییر پوسته">{dark ? '☀' : '☾'}</button><span className="notification">♧<i /></span><div className="user-chip"><span className="avatar">{role === 'super_admin' ? 'م' : 'ک'}</span><span><b>{APP_NAME}</b><small>{role === 'super_admin' ? 'مدیر کل' : role === 'manager' ? 'مدیر' : 'کاربر پنل'}</small></span></div><button className="logout" onClick={() => { void api('/auth/logout', { method: 'POST' }).finally(() => { localStorage.removeItem('salimvand.accessToken'); setAuthenticated(false); }); }}>خروج</button></header>{page === 'dashboard' ? <DashboardPage /> : page === 'products' ? <ProductsPage /> : page === 'invoices' ? <InvoicesPage /> : page === 'media' ? <MediaPage /> : page === 'inventory' ? <InventoryPage /> : page === 'reports' ? <ReportsPage /> : page === 'settings' ? <SettingsPage /> : page === 'users' ? <UsersPage /> : <ReferencesPage />}</main>{paletteOpen && <CommandPalette items={visibleItems} onSelect={navigate} onClose={() => setPaletteOpen(false)} />}<nav className="mobile-nav">{visibleItems.slice(0, 4).map((item) => <button className={page === item.id ? 'active' : ''} key={item.id} onClick={() => navigate(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav></div>;
}
createRoot(document.getElementById('root')!).render(<App />);
