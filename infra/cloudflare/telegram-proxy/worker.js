/**
 * Salim Vand — Telegram API proxy (Cloudflare Worker).
 *
 * The production server sits inside Iran where api.telegram.org is filtered,
 * so the API posts channel announcements through this worker instead. The
 * worker only forwards requests that carry the shared secret header
 * (x-proxy-secret); anything else gets a 401.
 *
 * Deploy: `npx wrangler deploy`, then set the secret with
 * `npx wrangler secret put TELEGRAM_PROXY_SECRET`.
 */
const UPSTREAM = 'https://api.telegram.org';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return new Response('salimvand telegram proxy ok', { status: 200 });
    }

    const secret = request.headers.get('x-proxy-secret');
    if (!env.TELEGRAM_PROXY_SECRET || secret !== env.TELEGRAM_PROXY_SECRET) {
      return new Response('unauthorized', { status: 401 });
    }

    const target = new URL(url.pathname + url.search, UPSTREAM);
    const upstream = await fetch(target, {
      method: request.method,
      headers: {
        'content-type': request.headers.get('content-type') ?? 'application/json',
      },
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await request.arrayBuffer(),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  },
};
