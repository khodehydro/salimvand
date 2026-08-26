# فروشگاه سلیم وند

Monorepo سامانهٔ کاتالوگ قطعات خودرو و ERP فروشگاه آذین خودرو سلیم وند در میاندوآب.

## وضعیت فعلی پروژه

- **فاز صفر: تکمیل‌شده** — اسکلت Monorepo، اپ‌ها، پکیج‌های مشترک و محیط توسعه.
- **فاز یک: تکمیل‌شده (۱۰۰٪)** — احراز هویت و Rotation دیتابیسی Refresh Token، کاتالوگ عمومی و مدیریتی، SEO پایه، موجودی و Ledger اتمیک، رسانه، داده‌های مرجع، داشبورد، مدل‌های دیتابیس، Audit عملیات حساس، تست‌های Unit و زیرساخت محلی آماده است.
- **فاز دو: تکمیل‌شده (۱۰۰٪)** — فروش عملیاتی، صدور فاکتور Immutable، مصرف و برگشت اتمیک موجودی، چرخهٔ پرداخت، Audit، Token عمومی امن و Workspace فروش در CMS تکمیل شده است.
- **فاز سه: تکمیل‌شده (۱۰۰٪)** — Queue اعلان‌ها با BullMQ/Redis، پردازش Worker، اعلان رویدادهای فاکتور و گزارش‌های فروش و موجودی تکمیل شده است.
- **فاز چهار: تکمیل‌شده (۱۰۰٪)** — اسکریپت Deploy یک‌مرحله‌ای، Nginx، Systemd، Worker مستقل، TLS، Backup رمزنگاری‌شده، Firewall و Health Check آماده شده‌اند.

فاز یک بر اساس کد قابل اجرا، Migrationهای Prisma، قرارداد API، تست‌های خودکار، TypeScript strict و Build تولیدی ارزیابی شده است. اجرای Migration و تست Integration نهایی به اتصال PostgreSQL/Redis محیط مقصد وابسته است و جزو چک‌لیست تحویل نهایی کل پروژه خواهد بود.

## اجزای پروژه

- `apps/api`: NestJS، Auth، Role Guard، Catalog، Inventory، Media، Dashboard و Health probes
- `apps/website`: Next.js، سایت عمومی RTL، صفحات محصول، دسته‌بندی، خودرو، موقعیت محلی، Sitemap و مسیر خصوصی فاکتور
- `apps/admin`: React + Vite، پنل مدیریت، ورود، نقش‌ها، محصولات، انبار، رسانه، داده‌های مرجع و داشبورد
- `packages/shared`: ثابت‌ها و تایپ‌های مشترک
- `packages/ui`: توکن‌ها و اجزای پایهٔ طراحی

## قابلیت‌های فاز یک که پیاده‌سازی شده‌اند

- Access/Refresh JWT و Refresh Cookie امن
- Logout و `GET /auth/me`
- Role Policy دقیق برای نقش‌های پنل
- محدودیت تلاش Login
- پاسخ استاندارد خطاهای API
- کاتالوگ عمومی با جستجو، فیلتر، برند، خودرو و Pagination
- صفحات SEOمحور محصول، دسته‌بندی، خودرو و میاندوآب
- Sitemap و Robots
- مدیریت محصول، برند، خودرو، تیپ، تصویر و Media Library
- قوانین موجودی اتمی و Ledger
- بارکد EAN-13 و اسکنر پنل
- داشبورد خلاصهٔ محصولات و انبار
- مدل‌های Refresh Token، Audit Log و Invoice در Prisma
- Health و Readiness probe برای API و PostgreSQL
- Docker Compose برای PostgreSQL و Redis

## خروجی‌های تکمیل‌شدهٔ فاز یک

- Migrationهای Prisma برای تمام مدل‌های فاز یک و Seed قابل تکرار برای کاربر مدیر و داده‌های مرجع.
- Refresh Token با ذخیرهٔ hash در جدول `refresh_tokens`، Rotation اتمیک، انقضا، ابطال و Cookie امن.
- CRUD مدیریتی محصول با اعتبارسنجی، SEO خودکار/قابل ویرایش، Soft Delete، Restore و Audit.
- Ledger موجودی برای موجودی اولیه، خرید، اصلاح، انتقال و ثبت Audit در مسیر تراکنشی.
- API عمومی امن و صفحات SEOمحور محصول، دسته‌بندی، خودرو و موقعیت محلی.
- Media Library با محدودیت نوع/حجم، تبدیل WebP، انتخاب تصویر اصلی و حذف رسانه.
- تست‌های خودکار API و پکیج مشترک، TypeScript strict و Build تولیدی هر سه اپ.

## چک‌لیست محیط مقصد

برای اجرای Migration/Seed و تست Integration در محیط مقصد، PostgreSQL و Redis باید در دسترس باشند؛ این مرحله در چک‌لیست Deploy جامع نهایی انجام می‌شود و در طول توسعه Deploy جداگانه‌ای لازم نیست.

## اجرا

پیش‌نیاز: Node.js 20 و pnpm 9.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

آدرس‌ها:

- سایت: http://localhost:3000
- پنل: http://localhost:5173
- API: http://localhost:4000/api/v1/health
- Readiness: http://localhost:4000/api/v1/health/ready

راه سادهٔ راه‌اندازی کامل محیط محلی:

```bash
./scripts/setup-local.sh
```

این اسکریپت به‌صورت خودکار وابستگی‌ها، PostgreSQL، Redis، Prisma، Migration و Seed را اجرا می‌کند. در محیط فعلی فقط کافی است Docker در دسترس باشد.

برای اجرای دستی سرویس‌ها:

```bash
docker compose -f docker-compose.dev.yml up -d
```

## اعتبارسنجی

```bash
pnpm typecheck
pnpm build
pnpm test
```

تست‌های فعلی API روی Auth، Catalog، Dashboard، Inventory، Role Policy، Rate Limit، Exception Filter و Public Invoice Token متمرکز هستند.

## محدودیت فعلی محیط

اجرای Prisma Migration و تست Integration تا فراهم‌شدن PostgreSQL و دسترسی Prisma Engine انجام نمی‌شود. پس از اتصال سرور/دیتابیس، این مرحله باید در چک‌لیست Deploy جامع نهایی اجرا و تأیید شود.
