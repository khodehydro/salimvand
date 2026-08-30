# ماتریس پذیرش Release Candidate

این ماتریس معیارهای تحویل را از منطق معماری و مرجع بصری به checkهای قابل اجرا تبدیل می‌کند.

## وضعیت کد و داده

| معیار                              | وضعیت | روش بررسی                                   |
| ---------------------------------- | ----- | ------------------------------------------- |
| TypeScript strict                  | آماده | `pnpm typecheck`                            |
| پول به‌صورت Integer ریال           | آماده | rules و DTOهای Invoice/Purchase/Payment     |
| زمان UTC                           | آماده | Prisma schema و runtime config              |
| فروش اتمیک و Ledger                | آماده | تست InvoiceService و PostgreSQL integration |
| پرداخت و مرجوعی                    | آماده | تست‌های Invoice و Customer                  |
| Soft Delete                        | آماده | Customer/Supplier service                   |
| Audit عملیات حساس                  | آماده | سرویس‌های فروش، خرید، تنظیمات و موجودی      |
| public serializer بدون قیمت و قفسه | آماده | تست public invoice و public catalog         |

## عملیات و استقرار

| معیار                        | وضعیت         | روش بررسی                                                 |
| ---------------------------- | ------------- | --------------------------------------------------------- |
| Prisma generate/validate     | روی CI/VPS    | `scripts/release-candidate-check.sh`                      |
| تست API و shared             | آماده         | ۱۹۰ تست API + ۱۲ shared + ۷ ui + ۲۷ admin (مجموع ۲۳۶ تست) |
| Build API/Website/Admin      | آماده         | Release candidate script و Next/Vite build                |
| PostgreSQL و Redis readiness | آماده         | `/api/v1/health/ready`                                    |
| Queue retry و shutdown       | آماده         | تست Notification service                                  |
| Backup manifest/checksum     | آماده         | `verify-backup.sh` و لاگ‌های backup_jobs                  |
| Restore جداگانه و guarded    | آماده         | `restore.sh` و dry-run                                    |
| GitHub Actions CI/CD         | آماده         | `.github/workflows/ci.yml` و `deploy.yml`                 |
| Docker integration test      | آماده برای CI | `pnpm integration:check`                                  |

## رابط کاربری

| معیار                                       | وضعیت          | توضیح                                                                                                                                                                     |
| ------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RTL و responsive shell                      | پیاده‌سازی شده | نیازمند بازبینی مرورگری نهایی                                                                                                                                             |
| Light/Dark                                  | پیاده‌سازی شده | نیازمند بررسی همهٔ صفحات                                                                                                                                                  |
| سایت کاتالوگی بدون قیمت عمومی               | آماده          | CTA استعلام و عدم وجود cart/payment                                                                                                                                       |
| سوییچ نمایش قیمت در سایت                    | پیاده‌سازی شده | تنظیمات ← «قیمت‌ها در سایت» (سوییچ سراسری) + بازنویسی تک‌محصولی (مطابق سایت / همیشه نمایش / همیشه پنهان) در تب «پایه و سئو»؛ قیمت فقط وقتی مجاز باشد در پاسخ عمومی می‌آید |
| کتابخانهٔ رسانه + انتخاب از رسانه‌های موجود | پیاده‌سازی شده | پنل: صفحهٔ رسانه‌ها، انتخاب لوگو/فاوآیکون/تصویر محصول از کتابخانه                                                                                                         |
| پیش‌نمایش رسانه‌ها در پنل                   | پیاده‌سازی شده | سرو `/uploads` روی API و Nginx پنل (درج خودکار توسط deploy.sh)                                                                                                            |
| صفحات SEO محصول/دسته/خودرو/موقعیت           | آماده          | metadata، canonical و JSON-LD                                                                                                                                             |
| CMS و command palette                       | پیاده‌سازی شده | نیازمند تست تعاملی مرورگر                                                                                                                                                 |
| انبار، فروش، خرید و تنظیمات                 | پیاده‌سازی شده | نیازمند acceptance دستی در پنل                                                                                                                                            |
| تست UI/E2E واقعی                            | آماده در CI    | `pnpm test:e2e` با Playwright پس از build، چون سرویس‌های سایت/پنل بالا می‌آیند                                                                                            |
| بازبینی رنگ‌های خام و Format کل repository  | انجام شده      | `pnpm format:check` سبز + `.prettierignore` برای مرجع بصری و lockfile                                                                                                     |

## اجرای نهایی

```bash
bash scripts/release-candidate-check.sh
```

این فرمان قبل از Release، syntax اسکریپت‌ها، Prisma Client، schema validation، typecheck، test و build را اجرا می‌کند. اجرای کامل آن به دسترسی Prisma Engine نیاز دارد. تست‌های Docker، Restore واقعی و بازبینی بصری باید روی CI/VPS و مرورگر واقعی انجام شوند.

تا وقتی ردیف‌های «باقی‌مانده» انجام نشده‌اند، وضعیت پروژه از نظر acceptance بصری ۱۰۰٪ اعلام نمی‌شود؛ هستهٔ عملیاتی و backend قابل Deploy است، اما تحویل نهایی نیازمند تأیید دستی UI و اجرای integration واقعی است.
