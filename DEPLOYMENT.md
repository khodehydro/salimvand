# استقرار Production

این مخزن یک مسیر استقرار جامع و قابل تکرار دارد. اسکریپت‌ها DNS یا رکوردهای ایمیل (`mail`، `MX`، `SPF`، `DKIM` و `DMARC`) را تغییر نمی‌دهند.

## آماده‌سازی اولیهٔ VPS

روی AlmaLinux 9، RHEL، Ubuntu یا Debian با Node.js 20 یا بالاتر:

```bash
sudo APP_DIR=/opt/salimvand ./scripts/setup-server.sh
```

پس از آماده‌سازی، SSH را فقط با Key استفاده کنید. در AlmaLinux، Fail2ban از EPEL نصب و با فایل `deploy/fail2ban/sshd.local` فعال می‌شود. قبل از غیرفعال‌کردن Password Login، حتماً یک اتصال جدید با SSH Key را تست کنید.

در Production، API با `API_HOST=127.0.0.1` روی Loopback اجرا می‌شود و فقط Nginx باید پورت عمومی API را Proxy کند. PostgreSQL و Redis نیز نباید روی Interface عمومی Bind شوند.

سپس فایل `/opt/salimvand/.env` را با مقادیر واقعی تکمیل کنید. در Production باید `DATABASE_URL`، `REDIS_URL`، دو Secret طولانی JWT، `APP_URL`، `ADMIN_URL` و `CORS_ORIGINS` تنظیم شده باشند. برای فعال‌سازی Worker مقدار `ENABLE_QUEUE_WORKER=true` در سرویس Worker به‌صورت خودکار اعمال می‌شود.

## TLS

پس از اطمینان از اتصال DNS چهار Host سایت، CMS و API به VPS:

```bash
sudo CERTBOT_EMAIL=admin@example.com ./scripts/enable-tls.sh
```

این فرمان فقط گواهی و تمدید HTTPS را مدیریت می‌کند و به Mail DNS دست نمی‌زند.

## Deploy جامع

پس از آماده‌سازی اولیه، هر Release فقط با یک فرمان انجام می‌شود:

```bash
sudo APP_DIR=/opt/salimvand DEPLOY_BRANCH=main ./scripts/deploy.sh
```

فرمان بالا به‌ترتیب Fetch، Checkout نسخهٔ Branch، Install قفل‌شده، Prisma Generate، Migration Deploy، Seed، Typecheck، Test، Build، فعال‌سازی Systemd، Restart و Health Check را انجام می‌دهد. در پایان علاوه بر API Readiness، فعال‌بودن API، Website و Worker و پاسخ‌گویی Website نیز بررسی می‌شود؛ همچنین Deploy اگر API روی آدرس عمومی Bind شده باشد، ناموفق اعلام می‌شود.

## Smoke Check پس از Deploy

برای بررسی مستقل سلامت سرویس‌ها روی VPS:

```bash
cd /opt/salimvand
bash scripts/check-production.sh
```

این بررسی باید پیام `Production checks passed.` را نمایش دهد و فعال‌بودن API، Website، Worker، Nginx، Fail2ban و Bind داخلی API را کنترل می‌کند.

## Backup و بازبینی

Backup روزانه با `salimvand-backup.timer` اجرا می‌شود و ۱۴ روز نگهداری می‌گردد. در صورت تنظیم `BACKUP_ENCRYPTION_KEY`، خروجی PostgreSQL با AES-256 رمز می‌شود:

```bash
sudo /opt/salimvand/scripts/backup.sh
systemctl list-timers salimvand-backup.timer
```

پیش از تحویل نهایی باید یک Restore Test روی دیتابیس جداگانه انجام شود؛ فایل Backup تولیدی نباید وارد Git شود.
