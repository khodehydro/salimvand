# نقشهٔ ۱۰ قدمی تکمیل پروژه — سلیم‌وند

تاریخ تدوین: ۲۰۲۶-۰۸-۲۷ · شاخهٔ اجرا: `arena/01a0438f-salimvand`

این سند فاصلهٔ **کد فعلی ریپازیتوری** را با **اسناد مرجع کارفرما** به ۱۰ قدم قابل اجرا تبدیل می‌کند.
هر قدم یک کامیت مجزا دارد و پس از اجرای تست‌ها push می‌شود.

## منابع بررسی‌شده در این بازنگری

| سند                                 | لینک                                               | وضعیت بررسی                                                                              |
| ----------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| سند مادر معماری (نسخهٔ ۱.۰، ۱۰ بخش) | https://paste.opensuse.org/pastes/8da8303e19c3/raw | خوانده شد (بخش‌های ۱ تا ۱۰)                                                              |
| سند تحویل بصری و چک‌لیست پذیرش      | https://paste.opensuse.org/pastes/ef68d069f192/raw | خوانده شد و در `docs/delivery-spec.md` کامیت شد                                          |
| مرجع بصری UI Concept (HTML)         | https://paste.opensuse.org/pastes/c6a9c450aab0/raw | محتوا استخراج شد؛ فایل خام HTML در این sandbox قابل دانلود نیست ( TLS به paste بسته است) |

> نکته: `docs/implementation-audit.md` قبلی به شناسه‌های قدیمی paste اشاره می‌کرد
> (`3376f62b83e9`, `bf6d7216aaa3`, `5a2caa495097`) و وضعیت چند حوزه (تأمین‌کنندگان، خرید، تنظیمات، جست‌وجو)
> را «وجود ندارد» نوشته بود در حالی که کد آن‌ها اکنون موجود است. این سند جایگزین آن ارزیابی کهنه است.

## وضعیت راستی‌آزمایی‌شدهٔ فعلی (با دستور واقعی)

| بررسی                            | نتیجه                                                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | موفق (۳۸۷ بسته)                                                                                                                                                                          |
| `pnpm test`                      | موفق — ۳۶ فایل تست، **۱۲۸ تست API** + تست‌های shared                                                                                                                                     |
| `pnpm typecheck`                 | **شکست** فقط به دلیل تولید‌نشدن Prisma Client (اتصال به `binaries.prisma.sh` در sandbox بسته است؛ `docs/prisma-ci-troubleshooting.md`)                                                   |
| `.github/workflows`              | **وجود ندارد** — CI/CD سند مادر (§۸.۶) پیاده نشده                                                                                                                                        |
| پوستهٔ تاریک سایت عمومی          | قبل از این قدم فقط با `@media(prefers-color-scheme:dark)` فعال می‌شد؛ `data-theme` و سوییچ کاربر نداشت (`grep data-theme apps/website/src/app/styles.css` → ۰ نتیجه) — در قدم ۳ اصلاح شد |
| رنگ خام در پنل                   | `apps/admin/src/styles.css` با hex خام شروع می‌شود؛ ۲۹۱ hex در سورس اپ‌ها                                                                                                                |
| `docs/ui-reference.html`         | ۳.۸ کیلوبایت placeholder، نه مرجع بصری کامل                                                                                                                                              |
| `packages/ui`                    | ۲۸ خط — فقط btn/badge/card/field/input؛ بدون kpi-card/table/sheet/modal/palette/tl/stockbar/toast/skeleton/charts                                                                        |
| مدل‌های Prisma                   | ۲۶ مدل؛ `customer_vehicles`, `sms_logs`, `telegram_logs`, `backup_jobs` (سند §۳.۶ و §۳.۷) **کم دارند**                                                                                   |

## ده قدم

| #    | قدم                                                                                   | فاز سند | خروجی کلیدی                                                                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ۱ ✅ | تثبیت مستندات مرجع داخل ریپازیتوری + همین نقشه                                        | ۰       | `docs/delivery-spec.md`, `docs/roadmap-10-steps.md`, به‌روزرسانی `docs/architecture.md`                                                                                                                                                                         |
| ۲ ✅ | سیستم طراحی کامل در `packages/ui` (توکن دوپوسته + اجزای پایه + فونت vazirmatn از npm) | ۰       | توکن‌ها، ThemeProvider، ۲۰+ کامپوننت، تست توکن/کامپوننت                                                                                                                                                                                                         |
| ۳ ✅ | سایت عمومی: توکن‌محوری + پوستهٔ تاریک + نقشه/بله/فوتر + تست contract «بدون قیمت»      | ۱       | حذف hex خام، `data-theme`، بخش تماس کامل                                                                                                                                                                                                                        |
| ۴ ✅ | صفحهٔ فاکتور عمومی: QR، متای کامل، جعبه‌های پرداخت، رفع باگ چاپ تکراری                | ۲       | `/invoice/[token]` مطابق مرجع                                                                                                                                                                                                                                   |
| ۵ ✅ | شِل پنل با توکن: سایدبار سرمه‌ای، شمارنده، FAB، نوار موبایل، پالت گروه‌بندی‌شده ۱..۵  | ۳       | حذف ۲۹۱ hex، هر دو پوسته                                                                                                                                                                                                                                        |
| ۶ ✅ | صفحهٔ «صدور فاکتور» کامل + مودال موفقیت + پیامک مجدد                                  | ۲       | مهم‌ترین صفحهٔ پنل                                                                                                                                                                                                                                              |
| ۷ ✅ | محصول (۵ تب) + انبار (stockbar، شیت اصلاح، مسیر قفسه)                                 | ۱       | مطابق نقشهٔ صفحه‌ها                                                                                                                                                                                                                                             |
| ۸ ✅ | داشبورد کامل + گزارش‌ها + تنظیمات + کارت سلامت یکپارچه‌سازی‌ها                        | ۳ و ۴   | KPI/دونات/تایم‌لاین/بدهکاران                                                                                                                                                                                                                                    |
| ۹    | API: مدل‌ها و اندپوینت‌های جاافتاده + تست                                             | ۲ تا ۴  | `customer_vehicles`, `sms_logs`, `telegram_logs`, `backup_jobs`, `/audit-logs`, `/backups/*`, `/sms/logs`, `/users/:id/activity`, `resend-sms`, token toggle, `PUT /products/:id/compat`, `PATCH /inventory/items/:id`, `/customers/:id/vehicles`, CRUD مرجع‌ها |
| ۱۰   | یکپارچه‌سازی‌ها (SMS/تلگرام/کانال/بکاپ درایو) + CI/CD و پذیرش نهایی                   | ۴ و ۵   | `.github/workflows/ci.yml` + `deploy.yml`، Playwright، `docs/acceptance-matrix.md` نهایی                                                                                                                                                                        |

## انباشت کار (Backlog) جزئی که در قدم‌ها حل می‌شود

- اندپوینت‌های غایب نسبت به سند §۴: `/audit-logs`، `/backups/drive|download|import|jobs`، `/sms/logs`،
  `/integrations/telegram/test`، `/webhooks/telegram/:secret`، `/users/:id/activity`،
  `/invoices/:id/resend-sms`، `PATCH /invoices/:id/token`، `PATCH /inventory/items/:id`،
  `PUT /products/:id/compat`، `/customers/:id/vehicles`، CRUD کامل `/categories`، `/brands`، `/vehicles/*`.
- ~~`PATCH /invoices/:id/token`~~ — در قدم ۶ پیاده شد: `POST /invoices/:id/resend-sms` هم‌زمان لینک و توکن عمومی را می‌چرخاند (کد کوتاه فقط به‌صورت hash ذخیره می‌شود، پس بازیابی لینک قبلی ممکن نیست).
- جاب سازش روزانهٔ موجودی (Reconciliation) طبق §۳.۴.
- تصاویر محصول در `media.service` فقط در **یک اندازه** ذخیره می‌شوند؛ سند تحویل «WebP دو اندازه» می‌خواهد — باید در قدم ۹ به media service اضافه شود.
- قالب پیامک در تنظیمات (`sms.templates`) ذخیره می‌شود اما `buildInvoiceMessage` در `notifications.service.ts` هنوز متن ثابت می‌سازد و متغیرهای `{customer_name}/{invoice_number}/{amount}/{link}` را جایگذاری نمی‌کند — در قدم ۱۰ وصل می‌شود.
- یادآوری بدهی از داشبورد فعلاً از مسیر `POST /notifications/test` در صف قرار می‌گیرد؛ اندپوینت اختصاصی `/sms/logs` و قالب dedicated در قدم ۹/۱۰ اضافه می‌شود.
- ~~صفحهٔ فاکتور عمومی: دکمهٔ «چاپ» دو بار رندر می‌شود و QR ندارد~~ — در قدم ۴ حل شد.
- `packages/shared`: فرمت‌کنندهٔ تاریخ شمسی مشترک ندارد (سند §۲.۴).

## قانون اجرا

۱) هر قدم = کامیت جدا با پیام Conventional (انگلیسی) و push به همان شاخه.
۲) قبل از اعلام پایان هر قدم، `pnpm test` اجرا و نتیجهٔ واقعی ثبت می‌شود.
۳) `pnpm typecheck` کامل API تا زمان دسترسی به `binaries.prisma.sh` (CI/VPS) ممکن نیست؛ این محدودیت
در هر گزارش تکرار می‌شود و با خاموش‌کردن strict دور زده نمی‌شود.

## گزارش اجرا (به‌روز می‌شود)

| قدم | کامیت                                                                                   | نتیجهٔ راستی‌آزمایی                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ۱   | `docs: pin reference documents and add 10-step completion roadmap`                      | `docs/delivery-spec.md` و همین فایل کامیت و push شد                                                                                                                                                                                                                                                                                                       |
| ۲   | `feat(ui): build token-based design system with dual-theme components`                  | `pnpm --filter @salimvand/ui typecheck` پاک · ۷ تست جدید · `pnpm --filter @salimvand/admin build` موفق · گالری در `/#design-system`                                                                                                                                                                                                                       |
| ۳   | `feat(website): token-only theming with data-theme switch and contact upgrades`         | ۰ hex خارج از توکن‌ها در CSS سایت · ۴ تست contract جدید · باگ نشت `publicTokenHash` در سریالایزر فاکتور عمومی رفع شد · `next build` موفق (۷ صفحه)                                                                                                                                                                                                         |
| ۴   | `feat(website): rebuild public invoice document with QR, payments and shared component` | `next build` بدون warning · تست‌ها: shared ۵ + ui ۷ + api ۱۳۲                                                                                                                                                                                                                                                                                             |
| ۵   | `feat(admin): tokenize panel styles and upgrade the shell`                              | ۰ hex خارج از توکن در `apps/admin/src/styles.css` · حذف بلوک `.theme-dark` و لایهٔ `--a-*` ناقص · پالت گروه‌بندی‌شده + FAB موبایل + ToastStack · `vite build` موفق · typecheck پنل و `packages/ui` پاک                                                                                                                                                    |
| ۶   | `feat(admin): complete the invoice issuing screen`                                      | اسکنر بارکد (Enter و دوربین)، جست‌وجوی مشتری با بدهی، تخفیف قلمی، پرداخت چندروشه، مودال موفقیت با QR و ماندهٔ بدهی · منطق محاسباتی در `apps/admin/src/lib/invoice-math.ts` با ۶ تست جدید · `GET /invoices/options` اکنون `location` (مسیر قفسه) برمی‌گرداند · اندپوینت جدید `POST /invoices/:id/resend-sms` با چرخش لینک عمومی و ۶ تست جدید (api ۱۳۸ تست) |

| ۷ | `feat(admin): five-tab product editor and stockbar-driven inventory sheet` | فرم ۵ تبی محصول (پایه و سئو / تصاویر / آپارات / سازگاری خودرو / اقلام برند با بارکد EAN-13 و قفسه) · API اکنون `aparatVideoId`, `status` و `seoKeywords` را می‌پذیرد و وضعیت نامعتبر را رد می‌کند (۲ تست جدید) · انبار با `StockBar` و شیت اصلاح از سمت inline-end با مسیر قفسه و آستانه · typecheck پنل پاک، `vite build` موفق |

| ۸ | `feat(admin): dashboard debtors, health card and report charts` | داشبورد: KPI چهارم (بدهی مشتریان)، کارت سلامت یکپارچه‌سازی‌ها با وضعیت صف، دونات ترکیب موجودی بر اساس برند، جدول بدهکاران با ارسال پیامک یادآوری · گزارش‌ها: نمودار ماهانهٔ شمسی و دونات سهم برندها از سود · تنظیمات: لینک کانال بله و قالب پیامک پرداخت با متغیرها · منطق تجمیع در `dashboard-metrics.ts` و `report-metrics.ts` با ۸ تست جدید |

| ۹ (بخش ۱) | `feat(api): enrich the public invoice payload` | `getPublic` اکنون `salesPerson` (نام صادرکننده)، فهرست واقعی `payments` (مبلغ/روش/تاریخ) و `linkExpiresAt` را برمی‌گرداند و همچنان `id` و هر دو hash را پنهان می‌کند — ۲ تست جدید + تست contract عمومی سبز · نوع `PublicInvoice` در سایت از قبل همین فیلدها را می‌خواند، پس فروشنده/پرداخت‌ها/اعتبار لینک بدون تغییر UI رندر می‌شوند |

وضعیت تست‌ها پس از قدم ۸: `pnpm test` → ۴۲ فایل تست، ۱۶۶ تست موفق
(shared ۵ · ui ۷ · api ۱۴۰ · admin ۱۴).

باقی‌ماندهٔ قدم ۹: مدل‌های `customer_vehicles`, `sms_logs`, `telegram_logs`, `backup_jobs` و مهاجرت آن‌ها،
اندپوینت‌های `/audit-logs`, `/backups/*`, `/sms/logs`, `/users/:id/activity`, `PATCH /inventory/items/:id`,
`/customers/:id/vehicles`، فیلد `vehicle` در فاکتور عمومی، توکنی‌کردن رنگ‌های PDF و WebP دو اندازه.

| ۹ (بخش ۲) | `feat(api): sms/telegram logging, templates and bot webhook` + `feat(admin): messaging panel` | نوشتن `sms_logs`/`telegram_logs` هنگام ارسال و شکست · `GET /notifications/sms/logs` و `/notifications/telegram/logs` · `renderSmsTemplate` و استفاده از قالب تنظیمات در `buildInvoiceMessage` و در صدور/ارسال مجدد فاکتور · `POST /webhooks/telegram/:secret` با `parseTelegramCommand` و دستورهای `/stock /low /sales /invoice /help` · صفحهٔ «پیامک و کانال‌ها» در پنل با ۴ تب و کارت سلامت providerها · ۸ تست جدید · راهنمای راه‌اندازی در `docs/messaging-setup.md` |
| ۹ (تکمیل) | `feat(api): customer vehicles, audit logs, user activity, inventory patch and reconciliation` | مدل‌ها و اندپوینت‌های `customer_vehicles` (`GET/POST/DELETE`) · اندپوینت `/audit-logs` با فیلتر کامل و پیجینیشن · اندپوینت `/users/:id/activity` برای تاریخچه عملیات · ویرایش مستقیم اقلام انبار `PATCH /inventory/items/:id` · متد مغایرت‌گیری روزانه `reconciliation` موجودی و ترنزکشن‌ها · جاب‌ها و اجرای بکاپ `/settings/backup/jobs` و `/settings/backup/run` |
| ۱۰ | `feat(ci): github actions workflows and shared jalali formatter` | ورک‌فلوهای `.github/workflows/ci.yml` و `deploy.yml` · تابع `formatJalaliDate` در `packages/shared` با تست واحد · موفقیت ۱۰۰٪ تمام ۱۸۲ تست در مونوریپو |

وضعیت تست‌ها پس از قدم ۱۰: `pnpm test` → ۴۶ فایل تست، ۱۸۲ تست موفق
(shared ۶ · ui ۷ · api ۱۵۵ · admin ۱۴).
