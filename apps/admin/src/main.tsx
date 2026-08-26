import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { APP_NAME } from '@salimvand/shared';
import { MediaPage } from './pages/MediaPage';
import { api } from './lib/api';
import { LoginPage } from './pages/LoginPage';
import { ProductsPage } from './pages/ProductsPage';
import { InventoryPage } from './pages/InventoryPage';
import { ReferencesPage } from './pages/ReferencesPage';
import { DashboardPage } from './pages/DashboardPage';
import './styles.css';

function App() { const [authenticated, setAuthenticated] = useState(() => Boolean(localStorage.getItem('salimvand.accessToken'))); const [role, setRole] = useState(''); useEffect(() => { if (authenticated) void api<{ data: { role: string } }>('/auth/me').then((result) => setRole(result.data.role)).catch(() => { localStorage.removeItem('salimvand.accessToken'); setAuthenticated(false); }); }, [authenticated]); const [page, setPage] = useState<'dashboard' | 'products' | 'media' | 'inventory' | 'references'>('products'); if (!authenticated) return <LoginPage onLogin={() => setAuthenticated(true)} />; return <div className="admin"><aside><h2>سلیم وند</h2><nav><a className={page === 'dashboard' ? 'active' : ''} onClick={() => setPage('dashboard')}>داشبورد</a><a className={page === 'products' ? 'active' : ''} onClick={() => setPage('products')}>محصولات</a><a className={page === 'inventory' ? 'active' : ''} onClick={() => setPage('inventory')}>انبار</a><a>فروش و فاکتورها</a><a className={page === 'media' ? 'active' : ''} onClick={() => setPage('media')}>رسانه‌ها</a>{(role === 'manager' || role === 'super_admin') && <a className={page === 'references' ? 'active' : ''} onClick={() => setPage('references')}>برندها و خودروها</a>}<a>گزارش‌ها</a><a>تنظیمات</a></nav></aside><main><header><span>پنل مدیریت فروشگاه آذین خودرو</span><b>{APP_NAME}</b><button className="logout" onClick={() => { void api('/auth/logout', { method: 'POST' }).finally(() => { localStorage.removeItem('salimvand.accessToken'); setAuthenticated(false); }); }}>خروج</button></header>{page === 'dashboard' ? <DashboardPage /> : page === 'products' ? <ProductsPage /> : page === 'media' ? <MediaPage /> : page === 'inventory' ? <InventoryPage /> : <ReferencesPage />}</main></div> }
createRoot(document.getElementById('root')!).render(<App />);
