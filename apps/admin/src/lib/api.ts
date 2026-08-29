// The production CMS proxies /api/ to Nest through Nginx. Keeping browser requests
// same-origin avoids CORS/cookie problems and, importantly, prevents a development
// localhost value from being compiled into the production bundle.
export function resolveApiUrl(configuredUrl: string | undefined, production: boolean): string {
  if (production) return '/api/v1';
  const url = configuredUrl?.trim();
  return url ? url.replace(/\/+$/, '') : '/api/v1';
}

const API_URL = resolveApiUrl(import.meta.env.VITE_API_URL, import.meta.env.PROD);
const CONNECTION_ERROR =
  'ارتباط با سرور برقرار نشد. لطفاً اتصال شبکه را بررسی کنید و دوباره تلاش کنید.';
const INVALID_RESPONSE_ERROR = 'پاسخ نامعتبر از سرور دریافت شد. لطفاً دوباره تلاش کنید.';

async function request(path: string, options: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, options);
  } catch {
    // fetch rejects for network, DNS, TLS, CORS and unreachable-server failures.
    // Do not expose the browser's unhelpful English "Failed to fetch" message.
    throw new Error(CONNECTION_ERROR);
  }
}

async function responseBody<T>(response: Response): Promise<T & { error?: { message?: string } }> {
  try {
    return (await response.json()) as T & { error?: { message?: string } };
  } catch {
    throw new Error(response.status >= 500 ? CONNECTION_ERROR : INVALID_RESPONSE_ERROR);
  }
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  const token = localStorage.getItem('salimvand.accessToken');
  const response = await request(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    credentials: 'include',
  });
  if (!response.ok)
    throw new Error(response.status >= 500 ? CONNECTION_ERROR : 'دریافت فایل گزارش ناموفق بود');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function refreshAccessToken(): Promise<string | null> {
  const response = await request('/auth/refresh', { method: 'POST', credentials: 'include' });
  if (!response.ok) return null;
  const body = await responseBody<{ data?: { accessToken?: string } }>(response);
  const token = body.data?.accessToken;
  if (token) localStorage.setItem('salimvand.accessToken', token);
  return token ?? null;
}

export async function api<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const token = localStorage.getItem('salimvand.accessToken');
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await request(path, { ...options, headers, credentials: 'include' });
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return api<T>(path, options, false);
    localStorage.removeItem('salimvand.accessToken');
  }
  const body = await responseBody<T>(response);
  if (!response.ok)
    throw new Error(
      body.error?.message ?? (response.status >= 500 ? CONNECTION_ERROR : 'خطا در ارتباط با سرور'),
    );
  return body;
}
