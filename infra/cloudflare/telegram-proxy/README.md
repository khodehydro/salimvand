# پروکسی تلگرام روی Cloudflare Worker

سرور تولید داخل ایران است و `api.telegram.org` فیلتر است؛ این وورکر
درخواست‌های انتشار پست کانال را به تلگرام می‌رساند.

## دیپلوی

```bash
cd infra/cloudflare/telegram-proxy
npm i -g wrangler   # فقط یک بار
wrangler login
wrangler deploy
```

بعد از دیپلوی، آدرس وورکر چیزی شبیه این است:
`https://salimvand-telegram-proxy.<SUBDOMAIN>.workers.dev`

## تنظیم رمز مشترک

یک رمز تصادفی بسازید و روی وورکر ذخیره کنید:

```bash
wrangler secret put TELEGRAM_PROXY_SECRET
# مثال برای ساخت رمز:  openssl rand -hex 32
```

## اتصال سرور تولید

در `/opt/salimvand/.env` این دو خط را اضافه کنید (رمز هر دو طرف یکی باشد):

```
TELEGRAM_API_BASE=https://salimvand-telegram-proxy.<SUBDOMAIN>.workers.dev
TELEGRAM_PROXY_SECRET=<همان رمز>
```

سپس:

```bash
systemctl restart salimvand-api salimvand-worker
```

## تست سریع

```bash
curl https://salimvand-telegram-proxy.<SUBDOMAIN>.workers.dev/health
# باید بنویسد: salimvand telegram proxy ok

curl -X POST https://salimvand-telegram-proxy.<SUBDOMAIN>.workers.dev/botTEST/getMe \
  -H 'x-proxy-secret: <رمز>'
# باید پاسخ تلگرام (خطای توکن نامعتبر) برگردد — یعنی پروکسی کار می‌کند
```
