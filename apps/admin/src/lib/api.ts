const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

async function refreshAccessToken(): Promise<string | null> {
  const response = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
  if (!response.ok) return null;
  const body = await response.json() as { data?: { accessToken?: string } };
  const token = body.data?.accessToken;
  if (token) localStorage.setItem('salimvand.accessToken', token);
  return token ?? null;
}

export async function api<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const token = localStorage.getItem('salimvand.accessToken');
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' });
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return api<T>(path, options, false);
    localStorage.removeItem('salimvand.accessToken');
  }
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? 'خطا در ارتباط با سرور');
  return body;
}
