# فروشگاه سلیم وند

Monorepo سامانهٔ کاتالوگ قطعات خودرو و ERP فروشگاه آذین خودرو سلیم وند در میاندوآب.

## وضعیت فعلی پروژه

- **فاز صفر: تکمیل‌شده** — اسکلت Monorepo، اپ‌ها، پکیج‌های مشترک و محیط توسعه.
- **فاز یک: در حال توسعه، حدود ۷۵٪** — احراز هویت، کاتالوگ عمومی، SEO پایه، موجودی، رسانه، داده‌های مرجع، داشبورد، مدل‌های دیتابیس، تست‌های حساس و زیرساخت محلی پیاده‌سازی شده‌اند.
- **فاز دو: شروع‌نشده** — فروش عملیاتی، فاکتور واقعی، پرداخت، اعلان‌ها و صف یکپارچه‌سازی.

درصد فاز یک بر اساس کد قابل اجرا در مخزن محاسبه شده است؛ مدل‌ها و قراردادهایی که هنوز به PostgreSQL واقعی متصل نشده‌اند، تکمیل‌شده محسوب نمی‌شوند.

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

## موارد باقی‌ماندهٔ فاز یک

1. فراهم‌شدن PostgreSQL واقعی و اجرای `prisma generate` و Migration
2. Seed نهایی کاربر مدیر، دسته‌ها، برندها، خودروها و داده‌های اولیه
3. اتصال Refresh Token به جدول `refresh_tokens` و Rotation دیتابیسی
4. ثبت Audit Log واقعی در عملیات حساس
5. پیاده‌سازی CRUD کامل ویرایش/حذف با soft delete
6. پیاده‌سازی API واقعی Invoice و نمایش جزئیات در `/invoice/[token]`
7. انتقال Rate Limit از حافظهٔ Process به Redis
8. تست Integration با PostgreSQL و تست‌های UI پنل
9. بررسی نهایی معیارهای پذیرش و آماده‌سازی Deployment

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

اجرای Prisma Migration و تست Integration تا فراهم‌شدن PostgreSQL و دسترسی Prisma Engine انجام نمی‌شود. پس از اتصال سرور/دیتابیس، این مرحله باید قبل از ورود به فاز دو اجرا و تأیید شود.
