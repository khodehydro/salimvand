# راه‌اندازی پیامک، تلگرام و بله

**مسیر اصلی: پیکربندی از پنل مدیریت.** کلید API پیامک، شمارهٔ خط و توکن/شناسهٔ ربات‌های تلگرام و بله
در تب «پیامک و کانال‌ها ← پیکربندی» ذخیره می‌شوند، در دیتابیس می‌مانند و **بدون ری‌استارت و بدون
دستکاری `.env` یا ورود به سرور** اعمال می‌گردند. متغیرهای `.env` فقط نقش پشتیبان (fallback) دارند
و برای فیلدهایی استفاده می‌شوند که در پنل ذخیره نشده باشند.

نکات پیکربندی پنل:

- مقادیر محرمانه (کلید/توکن) در پاسخ `GET /settings` ماسک می‌شوند (`••••` + چهار کاراکتر آخر) و در
  لاگ حسابرسی نیز به‌صورت ماسک‌شده ثبت می‌شوند.
- ذخیرهٔ یک فیلد خالی برای مقادیر محرمانه یعنی «مقدار فعلی حفظ شود»؛ مقدار جدید را کامل وارد کنید.
- مقادیر ذخیره‌شده بر `.env` اولویت دارند و در همان لحظه توسط سرویس و worker خوانده می‌شوند.

این سند در ادامه کارهایی را فهرست می‌کند که همچنان **روی سرور** لازم است (مهاجرت، `.env` پشتیبان،
webhook ربات‌ها)؛ کد مربوطه در ریپازیتوری است.

## ۱) اعمال مهاجرت جدول‌های جدید

```powershell
ssh root@YOUR_SERVER
cd /opt/salimvand/apps/api
pnpm prisma migrate deploy      # جداول sms_logs, telegram_logs, backup_jobs, customer_vehicles
pnpm prisma generate
```

## ۲) متغیرهای Environment (پشتیبان؛ اولویت با پیکربندی پنل است)

| متغیر                             | کاربرد                                                                                                                                                                     | نمونه                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `SMS_API_KEY`                     | کلید API از پنل sms.ir (تنظیمات → کلید API)                                                                                                                                | `xxxx`                   |
| `SMS_LINE_NUMBER`                 | شمارهٔ خط ارسال از پنل sms.ir (برای متد «ارسال گروهی»)                                                                                                                     | `30004505000017`         |
| `TELEGRAM_BOT_TOKEN`              | توکن ربات تلگرام                                                                                                                                                           | `123456:ABC`             |
| `TELEGRAM_CHAT_ID`                | chat/کانال مقصد اعلان‌ها                                                                                                                                                   | `-1001234567890`         |
| `BALE_BOT_TOKEN` / `BALE_CHAT_ID` | معادل بله                                                                                                                                                                  | —                        |
| `TELEGRAM_WEBHOOK_SECRET`         | رمز مشترک webhook (خودتان تولید کنید)                                                                                                                                      | `openssl rand -hex 24`   |
| `PUBLIC_SITE_URL`                 | دامنهٔ سایت عمومی برای لینک فاکتور                                                                                                                                         | `https://selimvand.ir`   |
| `REDIS_URL`                       | صف BullMQ                                                                                                                                                                  | `redis://127.0.0.1:6379` |
| ~~`ENABLE_QUEUE_WORKER`~~         | **در `.env` نگذارید** — واحد `salimvand-worker.service` خودش `Environment=ENABLE_QUEUE_WORKER=true` دارد و اگر در `.env` باشد API و Website هم worker اضافه راه می‌اندازند | —                        |

این متغیرها اکنون **اختیاری** هستند: اگر مقدار معادل در پنل (تب پیکربندی) ذخیره شده باشد، همان
استفاده می‌شود و `.env` نادیده گرفته می‌شود. فقط وقتی پنل خالی است این متغیرها به کار می‌آیند.

فایل باید `chmod 600` و مالک آن کاربر سرویس باشد. بدون هیچ پیکربندی (نه پنل، نه `.env`)
هیچ پیامکی ارسال نمی‌شود و کارت سلامت در پنل «پیکربندی نشده» نشان می‌دهد (رفتار عمدی).

ارسال پیامک از طریق **sms.ir** و متد `POST /v1/send/bulk` (ارسال گروهی تک‌گیرنده) انجام می‌شود؛
احراز هویت با هدر `X-API-KEY` و پاسخ موفق `status: 1` است. خطاهای پنل (مثل کلید نامعتبر ۴۰۱ یا
محدودیت ارسال ۴۲۹) با پیام فارسی در لیست «ناموفق‌ها» و جدول `sms_logs` ثبت و تا ۵ بار با
backoff نمایی دوباره تلاش می‌شوند. قالب پیام فاکتور از تنظیمات پنل خوانده می‌شود و این
placeholderها را دارد: `{invoice_number}`, `{amount}`, `{link}`, `{store}`.

```bash
sudo systemctl restart salimvand-api
curl -s -H "Authorization: Bearer $TOKEN" https://admin.YOUR_DOMAIN/api/v1/notifications/health
```

## ۳) ثبت webhook ربات تلگرام

نشانی webhook = `https://admin.YOUR_DOMAIN/api/v1/webhooks/telegram/<TELEGRAM_WEBHOOK_SECRET>`

```bash
curl -F "url=https://admin.YOUR_DOMAIN/api/v1/webhooks/telegram/$TELEGRAM_WEBHOOK_SECRET" \
     -F "allowed_updates=[\"message\"]" \
     "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook"
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

برای بله همان فرمان با `https://tapi.bale.ai/bot$BALE_BOT_TOKEN/setWebhook`.
دستورهای پشتیبانی‌شده: `/stock` `/low` `/sales` `/invoice <کد کوتاه>` `/help`.
هر فراخوانی با secret اشتباه `403` می‌گیرد و هیچ پاسخی تولید نمی‌شود.

## ۴) قالب پیامک

در پنل → تنظیمات → «قالب پیامک فاکتور» و «قالب پیامک پرداخت».
متغیرها: `{invoice_number}` `{amount}` `{link}` `{store}`.
اگر قالب خالی باشد، متن پیش‌فرض داخلی استفاده می‌شود.

## ۵) بررسی سریع

1. پنل → «پیامک و کانال‌ها» → تب «ارسال آزمایشی» → کانال پیامک + شمارهٔ خودتان.
2. همان صفحه → تب «پیامک‌ها»: باید یک ردیف `sent` با شمارهٔ ماسک‌شده (`091***89`) ببینید.
3. صدور یک فاکتور با موبایل مشتری → باید پیامک حاوی لینک `/i/<کد>` ارسال شود.
4. خطاها در تب «صف و خطاها» با دکمهٔ «تلاش مجدد» قابل بازفرستادن هستند (۵ تلاش با backoff نمایی).

## ۶) اگر پیام‌ها در صف می‌مانند

worker به‌صورت واحد جداگانه اجرا می‌شود (`salimvand-worker.service` با `Environment=ENABLE_QUEUE_WORKER=true`)،
پس این متغیر را در `.env` قرار ندهید. بررسی:

```bash
systemctl is-active salimvand-worker.service
redis-cli ping            # باید PONG بدهد
journalctl -u salimvand-worker.service -n 50 --no-pager
```

اگر شمارندهٔ `waiting` در تب «صف و خطاها» بالا می‌رود، worker یا Redis در دسترس نیست.
