# استقرار Production

این مخزن یک مسیر استقرار جامع و قابل تکرار دارد. اسکریپت‌ها DNS یا رکوردهای ایمیل (`mail`، `MX`، `SPF`، `DKIM` و `DMARC`) را تغییر نمی‌دهند.

## آماده‌سازی اولیهٔ VPS

روی Ubuntu/Debian با Node.js 20 یا بالاتر:

```bash
sudo APP_DIR=/opt/salimvand ./scripts/setup-server.sh
```

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
sudo APP_DIR=/opt/salimvand DEPLOY_BRANCH=arena/01a038b2-salimvand ./scripts/deploy.sh
```

فرمان بالا به‌ترتیب Fetch، Checkout نسخهٔ Branch، Install قفل‌شده، Prisma Generate، Migration Deploy، Seed، Typecheck، Test، Build، فعال‌سازی Systemd، Restart و Health Check را انجام می‌دهد.

## Backup و بازبینی

Backup روزانه با `salimvand-backup.timer` اجرا می‌شود و ۱۴ روز نگهداری می‌گردد. در صورت تنظیم `BACKUP_ENCRYPTION_KEY`، خروجی PostgreSQL با AES-256 رمز می‌شود:

```bash
sudo /opt/salimvand/scripts/backup.sh
systemctl list-timers salimvand-backup.timer
```

پیش از تحویل نهایی باید یک Restore Test روی دیتابیس جداگانه انجام شود؛ فایل Backup تولیدی نباید وارد Git شود.
