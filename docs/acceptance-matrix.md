# ماتریس پذیرش Release Candidate

این ماتریس معیارهای تحویل را از منطق معماری و مرجع بصری به checkهای قابل اجرا تبدیل می‌کند.

## وضعیت کد و داده

| معیار | وضعیت | روش بررسی |
|---|---|---|
| TypeScript strict | آماده | `pnpm typecheck` |
| پول به‌صورت Integer ریال | آماده | rules و DTOهای Invoice/Purchase/Payment |
| زمان UTC | آماده | Prisma schema و runtime config |
| فروش اتمیک و Ledger | آماده | تست InvoiceService و PostgreSQL integration |
| پرداخت و مرجوعی | آماده | تست‌های Invoice و Customer |
| Soft Delete | آماده | Customer/Supplier service |
| Audit عملیات حساس | آماده | سرویس‌های فروش، خرید، تنظیمات و موجودی |
| public serializer بدون قیمت و قفسه | آماده | تست public invoice و public catalog |

## عملیات و استقرار

| معیار | وضعیت | روش بررسی |
|---|---|---|
| Prisma generate/validate | روی CI/VPS | `scripts/release-candidate-check.sh` |
| تست API و shared | آماده | ۱۲۸ تست API و ۵ تست shared در آخرین اجرا |
| Build API/Website/Admin | روی CI/VPS | Release candidate script |
| PostgreSQL و Redis readiness | آماده | `/api/v1/health/ready` |
| Queue retry و shutdown | آماده | تست Notification service |
| Backup manifest/checksum | آماده | `verify-backup.sh` |
| Restore جداگانه و guarded | آماده | `restore.sh` و dry-run |
| Restore واقعی ماهانه | نیازمند اجرای عملیاتی | دیتابیس مقصد جدا روی VPS |
| Docker integration test | آماده برای CI | `pnpm integration:check` |

## رابط کاربری

| معیار | وضعیت | توضیح |
|---|---|---|
| RTL و responsive shell | پیاده‌سازی شده | نیازمند بازبینی مرورگری نهایی |
| Light/Dark | پیاده‌سازی شده | نیازمند بررسی همهٔ صفحات |
| سایت کاتالوگی بدون قیمت عمومی | آماده | CTA استعلام و عدم وجود cart/payment |
| صفحات SEO محصول/دسته/خودرو/موقعیت | آماده | metadata، canonical و JSON-LD |
| CMS و command palette | پیاده‌سازی شده | نیازمند تست تعاملی مرورگر |
| انبار، فروش، خرید و تنظیمات | پیاده‌سازی شده | نیازمند acceptance دستی در پنل |
| تست UI/E2E واقعی | باقی‌مانده | اجرای Browser/Playwright در CI |
| بازبینی رنگ‌های خام و Format کل repository | باقی‌مانده | cleanup جداگانه بدون تغییر منطق |

## اجرای نهایی

```bash
bash scripts/release-candidate-check.sh
```

این فرمان قبل از Release، syntax اسکریپت‌ها، Prisma Client، schema validation، typecheck، test و build را اجرا می‌کند. اجرای کامل آن به دسترسی Prisma Engine نیاز دارد. تست‌های Docker، Restore واقعی و بازبینی بصری باید روی CI/VPS و مرورگر واقعی انجام شوند.

تا وقتی ردیف‌های «باقی‌مانده» انجام نشده‌اند، وضعیت پروژه از نظر acceptance بصری ۱۰۰٪ اعلام نمی‌شود؛ هستهٔ عملیاتی و backend قابل Deploy است، اما تحویل نهایی نیازمند تأیید دستی UI و اجرای integration واقعی است.
