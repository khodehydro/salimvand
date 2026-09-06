import { FormEvent, useState } from 'react';
import { api } from '../lib/api';

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryUsername, setRecoveryUsername] = useState('');
  const [token, setToken] = useState(new URLSearchParams(window.location.search).get('token') ?? '');
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>(token ? 'reset' : 'login');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError(''); setMessage('');
    try {
      if (mode === 'login') {
        const result = await api<{ data: { accessToken: string } }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
        localStorage.setItem('salimvand.accessToken', result.data.accessToken); onLogin();
      } else if (mode === 'forgot') {
        const result = await api<{ message?: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ username: recoveryUsername }) });
        setMessage(result.message ?? 'اگر حساب معتبر باشد، لینک بازیابی برای مدیر ارسال می‌شود.');
      } else {
        const result = await api<{ message?: string }>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
        setMessage(result.message ?? 'رمز تغییر کرد. اکنون وارد شوید.'); setMode('login'); setPassword('');
      }
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };
  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">سلیم وند</div>
        <p>{mode === 'login' ? 'ورود به پنل مدیریت فروشگاه آذین خودرو' : mode === 'forgot' ? 'بازیابی رمز عبور با تلگرام' : 'تعیین رمز عبور جدید'}</p>
        {mode === 'login' && <><label>نام کاربری<input required value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label><label>رمز عبور<input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label></>}
        {mode === 'forgot' && <label>نام کاربری حساب<input required dir="ltr" value={recoveryUsername} onChange={(e) => setRecoveryUsername(e.target.value)} autoComplete="username" /></label>}
        {mode === 'reset' && <label>رمز عبور جدید<input required minLength={10} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></label>}
        {error && <div className="login-error">{error}</div>}{message && <div className="notice">{message}</div>}
        <button className="button-primary" disabled={loading}>{loading ? 'در حال پردازش...' : mode === 'login' ? 'ورود به پنل' : mode === 'forgot' ? 'ارسال لینک بازیابی' : 'ذخیره رمز جدید'}</button>
        {mode === 'login' && <button type="button" className="login-link" onClick={() => { setMode('forgot'); setError(''); }}>رمز عبور را فراموش کرده‌اید؟</button>}
        {mode !== 'login' && <button type="button" className="login-link" onClick={() => { setMode('login'); setError(''); }}>بازگشت به ورود</button>}
      </form>
    </main>
  );
}
