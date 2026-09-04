import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SocialPublisherService,
  adminPmUrl,
  aparatUrl,
  buildProductCaption,
  buildProductKeyboard,
  publishFailure,
  type ProductPostInput,
} from './social-publisher.service';
import { integrationUrl, telegramApiHeaders } from './notifications.service';

const post: ProductPostInput = {
  name: 'لنت ترمز جلو',
  code: 'BRK-100',
  vehicles: ['پژو ۲۰۶', 'پژو ۲۰۷'],
  phones: '۰۴۱-۳۲۳۴۵۶۷۸',
  address: 'میاندوآب، خیابان امام',
  navUrl:
    'https://balad.ir/directions/driving?destination=' +
    encodeURIComponent('46.0856154,36.9680048') +
    '#15/36.9680048/46.0856154',
  aparatVideoId: 'abc123',
  imageUrl: 'https://salimvand.ir/uploads/products/x.jpg',
  siteUrl: 'https://salimvand.ir',
  adminUsername: 'salimvandiradmin2',
};

const envKeys = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'BALE_BOT_TOKEN',
  'BALE_CHAT_ID',
  'TELEGRAM_API_BASE',
  'TELEGRAM_PROXY_SECRET',
  'PUBLIC_SITE_URL',
  'SOCIAL_ADMIN_USERNAME',
];
const savedEnv: Record<string, string | undefined> = {};
for (const key of envKeys) savedEnv[key] = process.env[key];
afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('product post content', () => {
  it('builds the caption with name, code, vehicles, phone and address', () => {
    const caption = buildProductCaption(post);
    expect(caption).toContain('🛠 لنت ترمز جلو');
    expect(caption).toContain('🔖 کد محصول: BRK-100');
    expect(caption).toContain('🚗 مناسب برای خودروهای: پژو ۲۰۶، پژو ۲۰۷');
    expect(caption).toContain('📞 ۰۴۱-۳۲۳۴۵۶۷۸');
    expect(caption).toContain('📍 میاندوآب، خیابان امام');
  });

  it('omits the vehicles line when the product has no compatibility', () => {
    const caption = buildProductCaption({ ...post, vehicles: [] });
    expect(caption).not.toContain('مناسب برای خودروهای');
  });

  it('builds the inline keyboard per platform', () => {
    const telegram = buildProductKeyboard(post, 'telegram');
    expect(telegram[0]).toEqual([
      { text: '🛒 استعلام و خرید', url: 'https://t.me/salimvandiradmin2' },
    ]);
    expect(telegram[1]).toEqual([
      { text: '🎬 نمایش ویدیو', url: 'https://www.aparat.com/v/abc123' },
    ]);
    expect(telegram[2]).toEqual([
      { text: '📦 کاتالوگ محصولات', url: 'https://salimvand.ir' },
      { text: '🧭 مسیریابی سریع', url: post.navUrl },
    ]);

    const bale = buildProductKeyboard(post, 'bale');
    expect(bale[0][0].url).toBe('https://ble.ir/salimvandiradmin2');
    expect(adminPmUrl('telegram', 'u')).toBe('https://t.me/u');
    expect(adminPmUrl('bale', 'u')).toBe('https://ble.ir/u');
    expect(aparatUrl('zz9')).toBe('https://www.aparat.com/v/zz9');
  });

  it('drops the video button when the product has no Aparat video', () => {
    const rows = buildProductKeyboard({ ...post, aparatVideoId: null }, 'telegram');
    expect(rows).toHaveLength(2);
    expect(rows.flat().map((button) => button.text)).not.toContain('🎬 نمایش ویدیو');
  });

  it('hides the navigation button when the store has no coordinates', () => {
    // Same rule as the mobile site: no navLat/navLng → no «مسیریابی سریع».
    const rows = buildProductKeyboard({ ...post, navUrl: null }, 'telegram');
    expect(rows[rows.length - 1]).toEqual([
      { text: '📦 کاتالوگ محصولات', url: 'https://salimvand.ir' },
    ]);
  });

  it('maps provider error codes to readable Persian reasons', () => {
    expect(publishFailure(401)).toContain('توکن');
    expect(publishFailure(403)).toContain('مدیر کانال');
    expect(publishFailure(429)).toContain('درخواست زیاد');
    expect(publishFailure(400, 'Bad Request: chat not found')).toBe('chat not found');
    expect(publishFailure(502)).toBe('HTTP 502');
  });
});

describe('telegram proxy routing', () => {
  it('routes telegram through TELEGRAM_API_BASE and keeps the default otherwise', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token-1';
    delete process.env.TELEGRAM_API_BASE;
    expect(integrationUrl('telegram')).toBe('https://api.telegram.org/bottoken-1/sendMessage');
    process.env.TELEGRAM_API_BASE = 'https://proxy.workers.dev/';
    expect(integrationUrl('telegram')).toBe('https://proxy.workers.dev/bottoken-1/sendMessage');
    delete process.env.TELEGRAM_API_BASE;
  });

  it('adds the proxy secret header only when configured', () => {
    delete process.env.TELEGRAM_PROXY_SECRET;
    expect(telegramApiHeaders()).toEqual({ 'content-type': 'application/json' });
    process.env.TELEGRAM_PROXY_SECRET = 's3cret';
    expect(telegramApiHeaders()).toEqual({
      'content-type': 'application/json',
      'x-proxy-secret': 's3cret',
    });
    delete process.env.TELEGRAM_PROXY_SECRET;
  });
});

describe('SocialPublisherService', () => {
  function serviceWith(prisma: unknown) {
    const service = Object.create(SocialPublisherService.prototype) as SocialPublisherService;
    Object.assign(service as unknown as Record<string, unknown>, { prisma });
    return service;
  }

  const product = {
    id: 'p1',
    name: 'لنت ترمز جلو',
    code: 'BRK-100',
    deletedAt: null,
    aparatVideoId: 'abc123',
    images: [{ path: '/uploads/products/x.jpg' }],
    compatibilities: [
      { model: { name: '۲۰۶', make: { name: 'پژو' } }, trim: { name: 'تیپ ۵' } },
      { model: { name: '۲۰۶', make: { name: 'پژو' } }, trim: { name: 'تیپ ۵' } },
    ],
  };

  it('publishes to the configured channels and skips the rest', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tg-token';
    process.env.TELEGRAM_CHAT_ID = '-1003798951709';
    process.env.TELEGRAM_API_BASE = 'https://proxy.workers.dev';
    process.env.TELEGRAM_PROXY_SECRET = 's3cret';
    delete process.env.BALE_BOT_TOKEN;
    delete process.env.BALE_CHAT_ID;
    delete process.env.PUBLIC_SITE_URL;

    const logs: Array<{ data: { channel: string; status: string } }> = [];
    const prisma = {
      product: { findUnique: vi.fn(async () => product) },
      setting: {
        findUnique: vi.fn(async () => ({
          value: {
            phones: '۰۴۱-۱',
            address: 'میاندوآب',
            navLat: '36.9680048',
            navLng: '46.0856154',
          },
        })),
      },
      telegramLog: {
        create: async (args: { data: { channel: string; status: string } }) => {
          logs.push(args);
          return {};
        },
      },
    };
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const originalFetch = global.fetch;
    global.fetch = (async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    try {
      const result = await serviceWith(prisma).publishProduct('p1');
      expect(result.telegram).toEqual({ ok: true });
      expect(result.bale).toEqual({ ok: false, skipped: true, reason: 'پیکربندی نشده' });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://proxy.workers.dev/bottg-token/sendPhoto');
      expect((calls[0].init.headers as Record<string, string>)['x-proxy-secret']).toBe('s3cret');
      const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
      expect(body.chat_id).toBe('-1003798951709');
      expect(body.photo).toBe('https://salimvand.ir/uploads/products/x.jpg');
      expect(String(body.caption)).toContain('کد محصول: BRK-100');
      expect(String(body.caption)).toContain('پژو ۲۰۶ تیپ ۵');
      expect(String(body.caption)).not.toContain('پژو ۲۰۶ تیپ ۵، پژو ۲۰۶ تیپ ۵');
      expect(body.reply_markup).toBeTruthy();
      // Coordinates configured → the «مسیریابی سریع» button carries the Balad link.
      const keyboard = (
        body.reply_markup as { inline_keyboard: Array<Array<{ text: string; url: string }>> }
      ).inline_keyboard.flat();
      const nav = keyboard.find((button) => button.text === '🧭 مسیریابی سریع');
      expect(nav?.url).toContain('https://balad.ir/directions/driving?destination=');
      expect(nav?.url).toContain('46.0856154%2C36.9680048');
      expect(keyboard.some((button) => button.text === '📍 آدرس فروشگاه')).toBe(false);
      expect(logs).toHaveLength(1);
      expect(logs[0].data).toMatchObject({ channel: 'telegram', status: 'sent' });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('reports provider rejections per channel instead of throwing', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tg-token';
    process.env.TELEGRAM_CHAT_ID = '-100';
    delete process.env.BALE_BOT_TOKEN;
    delete process.env.BALE_CHAT_ID;
    delete process.env.TELEGRAM_API_BASE;
    delete process.env.TELEGRAM_PROXY_SECRET;

    const prisma = {
      product: { findUnique: vi.fn(async () => ({ ...product, images: [] })) },
      setting: { findUnique: vi.fn(async () => null) },
      telegramLog: { create: async () => ({}) },
    };
    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot is not a member' }), {
        status: 403,
      })) as typeof fetch;
    try {
      const result = await serviceWith(prisma).publishProduct('p1');
      expect(result.telegram.ok).toBe(false);
      expect(result.telegram.reason).toContain('مدیر کانال');
      expect(result.bale.skipped).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
