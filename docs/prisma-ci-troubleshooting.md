# رفع مشکل Prisma در CI و VPS

## علامت خطا

اگر `prisma generate` با خطای اتصال به `binaries.prisma.sh` متوقف شد، Prisma Client جدید تولید نشده است. در این حالت نباید `typecheck` یا `build` را با Client قدیمی ادامه داد.

## راه‌حل استاندارد

روی Runner یا VPS دارای دسترسی HTTPS خروجی:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @salimvand/api prisma:generate
pnpm --filter @salimvand/api prisma:validate
pnpm typecheck
pnpm test
pnpm build
```

`prisma generate` باید بعد از هر تغییر در `apps/api/prisma/schema.prisma` اجرا شود. نسخهٔ `prisma` و `@prisma/client` باید از lockfile نصب شوند و نباید یکی از آن‌ها به‌صورت global استفاده شود.

## بررسی محیط

```bash
node --version        # Node 20+
pnpm --version        # pnpm 9.x
curl -I https://binaries.prisma.sh
```

اگر شبکهٔ سازمانی یا فایروال دسترسی به host را مسدود می‌کند، باید allowlist HTTPS برای `binaries.prisma.sh` فعال شود. استفاده از Client تولیدشده از checkout دیگر یا خاموش‌کردن strict TypeScript راه‌حل قابل قبول نیست.

## Production

اسکریپت `scripts/deploy.sh` ابتدا install و سپس `prisma generate` را اجرا می‌کند؛ در صورت شکست، به دلیل `set -Eeuo pipefail` ادامهٔ Deploy انجام نمی‌شود. پس از رفع شبکه، Release را دوباره اجرا کنید:

```bash
sudo APP_DIR=/opt/salimvand DEPLOY_BRANCH=main ./scripts/deploy.sh
```

## وضعیت Sandbox این پروژه

در Sandbox فعلی، اتصال TLS به `binaries.prisma.sh` قطع می‌شود. تست‌های unit و بخش‌های frontend مستقل قابل اجرا هستند، اما اعتبار نهایی API build باید روی CI/VPS انجام شود؛ خروجی موفق `pnpm test` به‌تنهایی جایگزین تولید Prisma Client و typecheck نیست.
