# راستی‌آزمایی و دیپلوی از PowerShell (سرور مقصد)

این فایل دقیقاً همان مراحلی است که در sandbox قابل اجرا نبود (اتصال TLS به `binaries.prisma.sh`
بسته است) و باید روی ماشین دارای اینترنت خروجی — VPS یا لپ‌تاپ شما — اجرا شود.

## ۰) پیش‌فرض‌ها

- سرور: Ubuntu 24.04 (طبق سند معماری §۸) با Node 20+ و pnpm 9.
- از ویندوز با PowerShell وصل می‌شوید:

```powershell
ssh app@YOUR_SERVER_IP          # فقط کلید SSH؛ رمز غیرفعال است
```

اگر `ssh` در PowerShell نبود: `Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Client*'`
و سپس `Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0`.

---

## ۱) بررسی دسترسی خروجی (اولین چیزی که باید تست شود)

```bash
curl -I https://binaries.prisma.sh     # باید HTTP/2 200/301/403 بدهد — یعنی TLS باز است
curl -I https://registry.npmjs.org
curl -I https://github.com
```

اگر `binaries.prisma.sh` بسته بود، همان مشکل sandbox را دارید؛ راه‌حل در بخش ۵ آمده است.

---

## ۲) اجرای کامل اعتبارسنجی روی سرور

```bash
cd /var/www/parts-store/current        # یا هر مسیر checkout
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @salimvand/api prisma:generate
pnpm --filter @salimvand/api prisma:validate
pnpm typecheck                          # باید بدون خطا تمام شود
pnpm test                               # انتظار: ۳۹ فایل / ۱۴۴ تست موفق
pnpm build                              # api + website + admin
```

انتظار واقعی از آخرین وضعیت شاخهٔ `arena/01a0438f-salimvand`:

| فرمان                                                | انتظار                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm test`                                          | `packages/shared` ۵ · `packages/ui` ۷ · `apps/api` ۱۳۲ تست موفق |
| `pnpm --filter @salimvand/ui typecheck`              | پاک                                                             |
| `pnpm --filter @salimvand/admin typecheck` + `build` | پاک / `✓ built`                                                 |
| `pnpm --filter @salimvand/website build`             | `✓ Compiled successfully` + ۷ صفحهٔ استاتیک                     |
| `pnpm --filter @salimvand/api typecheck`             | **فقط** بعد از موفقیت `prisma:generate` پاک می‌شود              |

---

## ۳) مایگریشن و seed (اولین بار)

```bash
pnpm --filter @salimvand/api prisma:migrate      # محیط توسعه
# یا در حالت production:
pnpm --filter @salimvand/api exec prisma migrate deploy
pnpm --filter @salimvand/api prisma:seed
```

---

## ۴) دیپلوی

```bash
sudo APP_DIR=/var/www/parts-store DEPLOY_BRANCH=arena/01a0438f-salimvand ./scripts/deploy.sh
curl -fsS http://127.0.0.1:4000/api/v1/health
curl -fsS http://127.0.0.1:4000/api/v1/health/ready
```

`scripts/deploy.sh` با `set -Eeuo pipefail` اجرا می‌شود؛ اگر `prisma generate` یا بیلد شکست بخورد،
دیپلوی متوقف می‌شود و نسخهٔ قبلی سر جای خود می‌ماند.

دیپلوی در صورت نیاز location سرو `/uploads/` را به vhost پنل اضافه می‌کند (بدون بازنویسی کامل فایل،
تا بلوک‌های TLS مربوط به Certbot دست نخورند). پس از دیپلوی، این را هم چک کنید:

```bash
# اگر ADMIN_URL ست شده باشد، check-production همین را خودکار بررسی می‌کند:
sudo ADMIN_URL=https://cms.salimvand.ir APP_DIR=/opt/salimvand bash scripts/check-production.sh
# خروجی مورد انتظار: Production checks passed.
```

---

## ۵) اگر `prisma generate` به `binaries.prisma.sh` نرسید

به‌ترتیب این سه راه را امتحان کنید:

1. **بازکردن HTTPS خروجی** (راه‌حل اصلی):
   ```bash
   sudo ufw allow out 443/tcp
   # اگر پشت فایروال سازمانی/پروکسی هستید، allowlist این hostها لازم است:
   #   binaries.prisma.sh , registry.npmjs.org , github.com , objects.githubusercontent.com
   ```
2. **سرور میانی/میرور**: اگر میرور داخلی دارید،
   ```bash
   export PRISMA_ENGINES_MIRROR="https://mirror.example.com/prisma"
   pnpm --filter @salimvand/api prisma:generate
   ```
3. **انتقال کلاینت تولیدشده** (فقط برای رفع موقت، نه راه‌حل دائمی): روی ماشینی که اینترنت دارد
   `pnpm --filter @salimvand/api prisma:generate` را اجرا کنید و پوشهٔ
   `node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client`
   را با `scp` به همان مسیر روی سرور منتقل کنید. نسخهٔ `prisma` و `@prisma/client` در هر دو
   ماشین باید دقیقاً `5.22.0` باشد.

> خاموش‌کردن `strict` در tsconfig یا نادیده‌گرفتن خطای typecheck راه‌حل قابل قبول نیست
> (بند «وضعیت Sandbox» در `docs/prisma-ci-troubleshooting.md`).

---

## ۶) اگر می‌خواهید روی خودِ ویندوز (نه VPS) تست بگیرید

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm --filter "@salimvand/api" prisma:generate
pnpm typecheck
pnpm test
pnpm build
```

برای دیتابیس محلی روی ویندوز، Docker Desktop لازم است:

```powershell
docker compose -f docker-compose.dev.yml up -d
pnpm --filter "@salimvand/api" prisma:migrate
pnpm --filter "@salimvand/api" prisma:seed
pnpm dev
```

---

## ۷) بکاپ و بازیابی (طبق سند §۹)

```bash
./scripts/backup.sh            # pg_dump + gzip + رمزنگاری + ثبت در backup_jobs
./scripts/verify-backup.sh     # بررسی manifest/checksum
./scripts/restore.sh --dry-run # دریل بازیابی روی دیتابیس سایه
```
