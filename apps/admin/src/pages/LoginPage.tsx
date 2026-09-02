import { FormEvent, useState } from 'react';
import { api } from '../lib/api';

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api<{ data: { accessToken: string } }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      localStorage.setItem('salimvand.accessToken', result.data.accessToken);
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">سلیم وند</div>
        <p>ورود به پنل مدیریت فروشگاه آذین خودرو</p>
        <label>
          نام کاربری
          <input
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label>
          رمز عبور
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button className="button-primary" disabled={loading}>
          {loading ? 'در حال ورود...' : 'ورود به پنل'}
        </button>
      </form>
    </main>
  );
}
