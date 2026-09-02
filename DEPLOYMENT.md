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

فرمان بالا به‌ترتیب Fetch، Checkout نسخهٔ Branch، Install قفل‌شده، Prisma Generate، Migration Deploy، Seed، Typecheck، Test، Build، فعال‌سازی Systemd، Restart و Health Check را انجام می‌دهد.

اسکریپت حتی در پوسته‌های با PATH مینیمال (`sudo bash -c`، cron، ssh مستقیم) خودش Node و pnpm را پیدا می‌کند: مسیرهای نصب متداول (nvm کاربران، `/usr/local/bin`، `/usr/bin`، `/opt/node`، `~/.local/share/pnpm`) را می‌گردد، در صورت نیاز corepack را فعال می‌کند و اگر فقط npm موجود باشد، pnpm نسخهٔ پین‌شده را نصب می‌کند. در پایان علاوه بر API Readiness، فعال‌بودن API، Website و Worker و پاسخ‌گویی Website نیز بررسی می‌شود؛ همچنین Deploy اگر API روی آدرس عمومی Bind شده باشد، ناموفق اعلام می‌شود.

در هر Deploy، اگر vhost پنل (`cms.`) هنوز location مسیر `/uploads/` را نداشته باشد، همین بلاک به‌صورت خودکار به همان server block اضافه و Nginx Reload می‌شود تا پیش‌نمایش تصاویر در کتابخانهٔ رسانه و تنظیمات پنل کار کند. فایل vhost هرگز بازنویسی کامل نمی‌شود تا تغییرات Certbot (بلوک‌های TLS) دست‌نخورده بمانند؛ برای نصب‌های تازه، `setup-server.sh` نسخهٔ کامل داخل `deploy/nginx/salimvand.conf` را می‌گذارد.

## Smoke Check پس از Deploy

برای بررسی مستقل سلامت سرویس‌ها روی VPS:

```bash
cd /opt/salimvand
bash scripts/check-production.sh
```

این بررسی باید پیام `Production checks passed.` را نمایش دهد و فعال‌بودن API، Website، Worker، Nginx، Fail2ban و Bind داخلی API را کنترل می‌کند؛ علاوه بر آن اعتبار `DATABASE_URL` و `REDIS_URL` داخل `.env` را مستقیماً در برابر PostgreSQL و Redis می‌سنجد تا خرابی رمزها قبل از هر چیز گزارش شود.

## عیب‌یابی: خطای «ارتباط با سرور برقرار نشد» در پنل

این پیام یعنی بک‌اند (سرویس `salimvand-api`) پاسخ نمی‌دهد؛ خود پنل استاتیک است و از Nginx سرو می‌شود، پس صفحهٔ ورود باز می‌ماند ولی لاگین شکست می‌خورد. مسیر تشخیص:

```bash
systemctl status salimvand-api --no-pager
journalctl -u salimvand-api -n 50 --no-pager
bash scripts/check-production.sh
```

علل رایج:

- تغییر رمز دیتابیس یا Redis بدون به‌روزرسانی `.env` (یا برعکس). رمز سمت دیتابیس را با `.env` هماهنگ کنید:

  ```bash
  su - postgres -c "psql -qc \"ALTER ROLE parts_store WITH PASSWORD '<رمز داخل DATABASE_URL>'\""
  ```

- ناهماهنگی روش هش رمز: اگر `password_encryption` روی `md5` باشد ولی `pg_hba.conf` روش `scram-sha-256` بخواهد، **هر** رمزی رد می‌شود. اصلاح:

  ```bash
  su - postgres -c "psql -qc \"ALTER SYSTEM SET password_encryption='scram-sha-256';\" -qc 'SELECT pg_reload_conf();'"
  su - postgres -c "psql -qc \"ALTER ROLE parts_store WITH PASSWORD '<رمز>'\""
  ```

- اگر `.env` کلاً خراب شده باشد، بازاستقرار از گیت با `scripts/deploy.sh` کد را به حالت سالم برمی‌گرداند؛ کلیدهای ضروری `.env` در `.env.example` و `scripts/verify-production-config.sh` فهرست شده‌اند.

## Backup و بازبینی

Backup روزانه با `salimvand-backup.timer` اجرا می‌شود و ۱۴ روز نگهداری می‌گردد. در صورت تنظیم `BACKUP_ENCRYPTION_KEY`، خروجی PostgreSQL با AES-256 رمز می‌شود:

```bash
sudo /opt/salimvand/scripts/backup.sh
systemctl list-timers salimvand-backup.timer
```

پیش از تحویل نهایی باید یک Restore Test روی دیتابیس جداگانه انجام شود؛ فایل Backup تولیدی نباید وارد Git شود.

## بررسی صحت Backup

هر Backup کنار فایل اصلی یک manifest شامل زمان تولید، وضعیت رمزنگاری و SHA-256 دارد. پیش از Restore، صحت فایل را بررسی کنید:

```bash
sudo /opt/salimvand/scripts/verify-backup.sh /var/backups/salimvand/postgres-YYYYMMDDTHHMMSSZ.sql.gz.gpg
```

اگر `BACKUP_ENCRYPTION_KEY` فعال باشد، manifest مربوط به فایل `.gpg` checksum همان فایل رمزنگاری‌شده را بررسی می‌کند؛ پس از verification، فایل را با کلید Production رمزگشایی و سپس Restore کنید. Backup معتبر به‌تنهایی جایگزین Restore Test نیست؛ ماهانه یک Restore روی دیتابیس جداگانه انجام شود.

## بازیابی امن Backup

Restore هرگز از `DATABASE_URL` استفاده نمی‌کند و فقط با دیتابیس مقصدی که جداگانه در `TARGET_DATABASE_URL` مشخص شده انجام می‌شود. ابتدا checksum و manifest بررسی می‌شوند:

```bash
export TARGET_DATABASE_URL='postgresql://parts_store:password@127.0.0.1:5432/parts_store_restore'
./scripts/restore.sh /var/backups/salimvand/postgres-YYYYMMDDTHHMMSSZ.sql.gz --dry-run
```

برای Restore واقعی، تأیید صریح لازم است:

```bash
export CONFIRM_RESTORE=RESTORE_TO_TARGET
./scripts/restore.sh /var/backups/salimvand/postgres-YYYYMMDDTHHMMSSZ.sql.gz
```

`restore.sh` در صورت برابر بودن دیتابیس مقصد و Production، نبود manifest، checksum نامعتبر، نبود کلید رمزگشایی یا خطای SQL متوقف می‌شود. پیش از Restore واقعی، سرویس‌های API و Worker را متوقف و بعد از Restore، migration و smoke check را اجرا کنید.

## تست سریع محیط توسعه

پس از اجرای `docker compose -f docker-compose.dev.yml up -d` و بالا آمدن API، تست smoke محلی را اجرا کنید:

```bash
./scripts/check-local.sh
```

این فرمان PostgreSQL و Redis محلی Compose و هر دو endpoint سلامت و readiness API را بررسی می‌کند و به Production متصل نمی‌شود. مقدار `VITE_API_URL` در `.env.example` فقط برای توسعهٔ محلی است. Build پروداکشن همیشه از مسیر هم‌مبدأ `/api/v1` روی دامنهٔ CMS استفاده می‌کند و Nginx آن را به API داخلی Proxy می‌کند؛ بنابراین آدرس localhost وارد کد مرورگر نمی‌شود.

## کنترل کیفیت CI/CD

برای اجرای دقیق همان کنترل‌هایی که باید قبل از Release انجام شوند:

```bash
pnpm ci:check
```

`ci-check.sh` ابتدا Client و schema Prisma را با دیتابیس/نسخهٔ Prisma پروژه هماهنگ می‌کند، سپس به‌ترتیب typecheck، test، build و format را اجرا می‌کند. در صورت خطای network هنگام دانلود Prisma Engine، pipeline عمداً متوقف می‌شود و نباید Release ناقص ساخته شود.

## GitHub Actions و Secrets

دو workflow در `.github/workflows` تعریف شده‌اند:

- **`ci.yml`** — روی هر PR و push به `main` اجرا می‌شود: install قفل‌شده، `prisma generate/validate`، migration، typecheck، تست‌ها، build هر سه اپ، `format:check` و تست‌های E2E با Playwright (پس از build سرویس‌های سایت و پنل بالا می‌آیند).
- **`deploy.yml`** — پس از مرج به `main`، ابتدا همان Quality Gate را اجرا می‌کند و سپس با SSH به VPS متصل شده و `scripts/deploy.sh` را با Branch پین‌شده اجرا می‌کند؛ در صورت شکست به تلگرام مدیر خبر می‌دهد.

برای کارکرد `deploy.yml`، در **Settings → Secrets and variables → Actions** این Secrets را اضافه کنید:

| Secret               | توضیح                                                         |
| -------------------- | ------------------------------------------------------------- |
| `DEPLOY_HOST`        | IP یا دامنهٔ VPS                                              |
| `DEPLOY_USER`        | کاربر SSH (می‌تواند `root` یا کاربر sudo)                     |
| `DEPLOY_SSH_KEY`     | کلید خصوصی کاربر Deploy (هیچ‌وقت در ریپازیتوری ذخیره نمی‌شود) |
| `APP_DIR`            | مسیر نصب، مثلاً `/opt/salimvand`                              |
| `TELEGRAM_BOT_TOKEN` | (اختیاری) برای اطلاع‌رسانی شکست Deploy                        |
| `TELEGRAM_CHAT_ID`   | (اختیاری) آیدی چت مدیر                                        |

کلید خصوصی Deploy باید به‌صورت Secret و نه در فایل‌های ریپازیتوری نگهداری شود؛ ایجنت‌ها هرگز مستقیم روی سرور کار نمی‌کنند و تنها مسیر تغییر Production همین Pipeline است.

## تست Integration با PostgreSQL و Redis

برای اجرای migration، seed و readiness واقعی API روی سرویس‌های محلی:

```bash
pnpm integration:check
```

این فرمان `docker-compose.dev.yml` را بالا می‌آورد، Prisma Client را تولید می‌کند، migrationهای deploy را اجرا می‌کند، seed را اعمال می‌کند، API را موقتاً اجرا می‌کند و `GET /api/v1/health/ready` را بررسی می‌کند. در پایان سرویس‌های تست را پاک می‌کند. این تست به Docker و دسترسی شبکه برای Prisma Engine نیاز دارد و برای Production از `DATABASE_URL` جداگانه استفاده نمی‌کند.
