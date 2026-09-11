# راهنمای صفر تا صد اتصال Android به Salimvand Offline-First Sync

> این سند برای Agent یا تیم Android نوشته شده است. هدف آن اتصال امن اپلیکیشن Android پنل مدیریت به Backend موجود، با پشتیبانی از Offline Read، Offline Write، Retry، Idempotency و Conflict است.

## 1. وضعیت فعلی Backend

Branch توسعه:

```text
arena/01a06c42-salimvand
```

آخرین Commit آماده توسعه:

```text
1136802
```

آخرین نسخه‌ای که قبلاً روی Production Deploy شده است:

```text
7244fc6
```

قبل از تست نهایی Android باید Commit جدید Deploy شود؛ قراردادها و Recovery جدید در Commitهای بعد از `7244fc6` قرار دارند.

سرویس‌های Production:

```text
API       salimvand-api.service
Website   salimvand-website.service
Worker    salimvand-worker.service
API Base  /api/v1
```

API از HTTPS و Same-Origin استفاده می‌کند. Android نباید به `localhost` یا `127.0.0.1` متصل شود.

---

## 2. اصل‌های غیرقابل مذاکره

1. موجودی با Last-Write-Wins همگام نمی‌شود.
2. فروش، دریافت، اصلاح، انتقال، مرجوعی، پرداخت و خرید Command مستقل هستند.
3. هر Command باید `operationId` یکتا داشته باشد.
4. یک `operationId` در Retryها هرگز تغییر نمی‌کند.
5. دوباره‌فرستادن همان Operation نباید Duplicate بسازد.
6. Invoice آفلاین ابتدا Draft محلی است؛ فاکتور رسمی بعد از Sync و بررسی سرور ایجاد می‌شود.
7. Token، Password، Secret و Credential در دیتابیس محلی یا Backup ذخیره نمی‌شوند.
8. خطای Conflict باید در Backend ثبت و به کاربر نمایش داده شود؛ نباید صرفاً در UI پنهان شود.
9. ترتیب Operationها باید حفظ شود؛ مخصوصاً برای Operationهای یک موجودی یا یک فاکتور.
10. حذف اطلاعات با Delete واقعی جایگزین نمی‌شود؛ Backend از soft-delete و تاریخچه استفاده می‌کند.

---

## 3. احراز هویت

از مکانیزم Login موجود پروژه استفاده کن. Tokenها را فقط در Android Keystore نگه‌دار:

```text
EncryptedSharedPreferences یا DataStore + Android Keystore
```

در Room یا فایل Backup این موارد را ذخیره نکن:

```text
JWT access token
JWT refresh token
Password
API key
Database credential
Google Drive credential
```

برای هر درخواست احراز هویت‌شده:

```http
Authorization: Bearer <access-token>
```

در صورت `401`:

1. با Refresh Token، Access Token جدید بگیر.
2. درخواست اصلی را فقط یک بار Retry کن.
3. اگر Refresh شکست خورد، کاربر را به Login بفرست.
4. Operation محلی حذف نشود؛ وضعیت آن `waiting_auth` یا `pending` باقی بماند.

---

## 4. ثبت دستگاه

بعد از Login، برای هر نصب Android یک `deviceId` پایدار بساز. از IMEI یا شماره تلفن استفاده نکن.

پیشنهاد:

```text
UUID تصادفی در اولین اجرای اپلیکیشن
```

آن را در Encrypted DataStore نگه‌دار.

### درخواست

```http
POST /api/v1/sync/devices
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "deviceId": "android-550e8400-e29b-41d4-a716-446655440000",
  "name": "گوشی انبار"
}
```

در تمام درخواست‌های Sync، این Header را بفرست:

```http
x-device-id: android-550e8400-e29b-41d4-a716-446655440000
```

---

## 5. مدل‌های پیشنهادی Room

### SyncState

```kotlin
@Entity(tableName = "sync_state")
data class SyncState(
    @PrimaryKey val key: String = "main",
    val cursor: String = "0",
    val lastBootstrapAt: Long? = null,
    val updatedAt: Long = System.currentTimeMillis()
)
```

Cursor را `String` یا `Long` نگه‌دار؛ Backend ممکن است مقدار BigInt برگرداند.

### SyncQueue

```kotlin
@Entity(
    tableName = "sync_queue",
    indices = [Index(value = ["operationId"], unique = true)]
)
data class SyncQueueEntity(
    @PrimaryKey val id: String,
    val operationId: String,
    val deviceId: String,
    val type: String,
    val payloadJson: String,
    val status: String, // pending, sending, applied, conflict, failed, waiting_auth
    val attempts: Int = 0,
    val nextRetryAt: Long = 0,
    val lastError: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)
```

### SyncConflict

```kotlin
@Entity(tableName = "sync_conflicts")
data class SyncConflictEntity(
    @PrimaryKey val id: String,
    val operationId: String,
    val type: String,
    val code: String,
    val payloadJson: String,
    val serverStateJson: String?,
    val status: String, // open, resolved
    val resolutionJson: String?,
    val createdAt: Long
)
```

### Cached entities

برای Bootstrap و Pull، حداقل این جدول‌ها لازم هستند:

```text
Product
Category
Brand
Location
InventoryItem
InvoiceDraft
Customer
SyncChange یا ChangeLog
```

رکوردهای Cache باید `updatedAt`، `deletedAt` یا وضعیت حذف داشته باشند تا Pull بتواند حذف نرم را اعمال کند.

---

## 6. Bootstrap اولیه

در اولین اجرای معتبر بعد از Login:

```http
GET /api/v1/sync/bootstrap
Authorization: Bearer <token>
x-device-id: <deviceId>
```

پاسخ شامل داده‌های اولیه و Cursor است:

```json
{
  "ok": true,
  "data": {
    "deviceId": "android-...",
    "categories": [],
    "brands": [],
    "locations": [],
    "products": [],
    "inventory": [],
    "cursor": "123"
  }
}
```

Bootstrap را در یک Transaction محلی Room اعمال کن:

1. داده‌های دریافتی را در جدول‌های Cache بنویس.
2. Cursor را فقط بعد از موفقیت همهٔ Insertها ذخیره کن.
3. اگر Transaction محلی شکست خورد، Cursor تغییر نکند.
4. Bootstrap مجدد باید Idempotent باشد؛ از `REPLACE` یا Upsert استفاده کن.

---

## 7. Pull تغییرات

```http
GET /api/v1/sync/pull?cursor=123&limit=200
Authorization: Bearer <token>
x-device-id: <deviceId>
```

پاسخ نمونه:

```json
{
  "ok": true,
  "data": {
    "changes": [
      {
        "revision": "124",
        "entityType": "product",
        "entityId": "...",
        "action": "updated",
        "payload": {},
        "operationId": "...",
        "createdAt": "2026-09-11T10:00:00.000Z"
      }
    ],
    "cursor": "124",
    "hasMore": false
  }
}
```

الگوریتم Pull:

```text
repeat:
  cursor فعلی را از Room بخوان
  GET pull(cursor)
  changes را در Transaction محلی اعمال کن
  cursor جدید را در همان Transaction ذخیره کن
  اگر hasMore=false، پایان
```

هرگز قبل از اعمال موفق Changeها Cursor را جلو نبر.

---

## 8. قرارداد Operationها

ساختار مشترک:

```json
{
  "operationId": "android-550e8400-e29b-41d4-a716-446655440000-000001",
  "deviceId": "android-550e8400-e29b-41d4-a716-446655440000",
  "type": "inventory.receive",
  "payload": {}
}
```

قواعد `operationId`:

```text
طول: 8 تا 100 کاراکتر
فقط: A-Z a-z 0-9 . _ : -
در Retry ثابت
برای هر Command جدید متفاوت
```

انواع مجاز:

```text
inventory.receive
inventory.adjust
inventory.transfer
product.create
product.update
invoice.create
invoice.pay
purchase.create
purchase.pay
```

---

## 9. Payload عملیات موجودی

### دریافت موجودی

```http
POST /api/v1/sync/operations
```

```json
{
  "operationId": "android-device-000001",
  "deviceId": "android-device",
  "type": "inventory.receive",
  "payload": {
    "itemId": "inventory-item-id",
    "quantity": 10,
    "reason": "دریافت از تأمین‌کننده"
  }
}
```

### اصلاح موجودی

```json
{
  "operationId": "android-device-000002",
  "deviceId": "android-device",
  "type": "inventory.adjust",
  "payload": {
    "itemId": "inventory-item-id",
    "quantity": -2,
    "reason": "کسری شمارش انبار"
  }
}
```

### انتقال موجودی

```json
{
  "operationId": "android-device-000003",
  "deviceId": "android-device",
  "type": "inventory.transfer",
  "payload": {
    "itemId": "inventory-item-id",
    "locationId": "destination-location-id"
  }
}
```

موجودی را در Android مستقیم با مقدار محلی Overwrite نکن. مقدار محلی فقط نمایش تخمینی یا Cache است؛ مقدار معتبر نهایی از Server می‌آید.

---

## 10. Product Operationها

### ایجاد محصول

```json
{
  "operationId": "android-device-product-000001",
  "deviceId": "android-device",
  "type": "product.create",
  "payload": {
    "name": "لنت ترمز پژو 206",
    "categoryId": "category-id",
    "description": "توضیح محصول"
  }
}
```

### ویرایش محصول

```json
{
  "operationId": "android-device-product-000002",
  "deviceId": "android-device",
  "type": "product.update",
  "payload": {
    "productId": "product-id",
    "name": "نام جدید",
    "status": "active"
  }
}
```

برای ویرایش محصول، Payload باید فقط تغییرات موردنظر را داشته باشد.

---

## 11. Invoice Offline

Invoice آفلاین را مستقیماً فاکتور رسمی فرض نکن.

### حالت Draft

در قطع اینترنت:

```text
InvoiceDraft در Room ساخته شود
شماره موقت local-{deviceId}-{counter} باشد
وضعیت draft باشد
موجودی محلی فقط تخمینی نمایش داده شود
```

بعد از اتصال:

1. Draft به Operation تبدیل شود.
2. برای آن `operationId` ساخته شود.
3. Operation ارسال شود.
4. سرور موجودی، قیمت و وضعیت مشتری را بررسی کند.
5. در صورت موفقیت، Draft به `synced` تبدیل شود.
6. در صورت Conflict، Draft حذف نشود و وضعیت `conflict` بگیرد.

### ایجاد فاکتور

```json
{
  "operationId": "android-device-invoice-000001",
  "deviceId": "android-device",
  "type": "invoice.create",
  "payload": {
    "items": [
      {
        "inventoryItemId": "item-id",
        "quantity": 2,
        "unitPrice": "150000"
      }
    ],
    "customerId": "customer-id",
    "notes": "ثبت آفلاین"
  }
}
```

تا زمان پاسخ موفق سرور، شمارهٔ رسمی فاکتور به مشتری اعلام نکن.

---

## 12. پرداخت و خرید

### پرداخت فاکتور

```json
{
  "operationId": "android-device-payment-000001",
  "deviceId": "android-device",
  "type": "invoice.pay",
  "payload": {
    "invoiceId": "invoice-id",
    "amount": "500000",
    "method": "cash"
  }
}
```

روش‌های مجاز:

```text
cash
card
transfer
credit
```

### ایجاد خرید

```json
{
  "operationId": "android-device-purchase-000001",
  "deviceId": "android-device",
  "type": "purchase.create",
  "payload": {
    "supplierId": "supplier-id",
    "lines": [],
    "paidAmount": "0"
  }
}
```

### پرداخت خرید

```json
{
  "operationId": "android-device-purchase-payment-000001",
  "deviceId": "android-device",
  "type": "purchase.pay",
  "payload": {
    "invoiceId": "purchase-invoice-id",
    "amount": "100000",
    "method": "transfer",
    "notes": "پرداخت آفلاین"
  }
}
```

پرداخت چکی فقط زمانی ارسال شود که Payload کامل چک طبق DTO سمت API ساخته شده باشد.

---

## 13. ارسال صف محلی

صف را FIFO پردازش کن، اما Operationهای منابع مستقل می‌توانند با احتیاط موازی شوند. برای موجودی یک کالا یا یک فاکتور، ترتیب را حفظ کن.

الگوریتم پیشنهادی:

```text
Worker start
  Pull changes
  select queue item where:
    status = pending
    nextRetryAt <= now
  atomically mark sending
  POST /sync/operations
  on 200:
    mark applied
    save server result
    refresh affected entities
  on 401:
    mark waiting_auth
  on conflict:
    mark conflict
    save conflict payload
  on 409/network/5xx:
    increment attempts
    exponential backoff
  on validation/permission error:
    mark failed
```

Backoff پیشنهادی:

```text
1m, 2m, 5m, 15m, 30m, 1h
```

برای عملیات مالی، Retry خودکار با همان `operationId` امن است. برای خطای Validation، Retry بی‌نهایت انجام نده.

---

## 14. گرفتن وضعیت Operation

برای بررسی Operationهایی که پاسخ آن‌ها در قطع ارتباط از دست رفته است:

```http
POST /api/v1/sync/operations/status
```

```json
{
  "operationIds": [
    "android-device-000001",
    "android-device-invoice-000001"
  ]
}
```

اگر پاسخ POST عملیات به گوشی نرسید، Operation را دوباره با همان `operationId` ارسال کن یا از Status Endpoint استفاده کن. Operation جدید نساز.

---

## 15. Conflictها

### دریافت Conflictها

```http
GET /api/v1/sync/conflicts?status=open
```

### Resolve

```http
POST /api/v1/sync/conflicts/{conflictId}/resolve
```

نمونه:

```json
{
  "decision": "reject",
  "reason": "موجودی در دستگاه دیگر مصرف شده است"
}
```

مقادیر پیشنهادی UI:

```text
retry
reject
accept_server_state
create_new_draft
```

تا زمانی که Backend تصمیم را قبول نکرده، Android نباید به‌صورت محلی Conflict را resolved نشان دهد.

Conflict هیچ‌وقت با Last-Write-Wins ساده حل نشود.

---

## 16. وضعیت‌های محلی پیشنهادی

```text
DRAFT
PENDING
SENDING
APPLIED
CONFLICT
FAILED
WAITING_AUTH
CANCELLED
```

تبدیل‌های معتبر:

```text
DRAFT -> PENDING
PENDING -> SENDING
SENDING -> APPLIED
SENDING -> CONFLICT
SENDING -> FAILED
SENDING -> WAITING_AUTH
FAILED -> PENDING
WAITING_AUTH -> PENDING
CONFLICT -> PENDING   فقط پس از تصمیم معتبر
```

`APPLIED` نباید دوباره به `PENDING` برگردد.

---

## 17. امنیت و Backup

در Backup Android فقط این موارد مجاز است:

```text
Cache عملیاتی
Draftهای محلی
Operationهای بدون Secret
Cursor
Conflictهای غیرحساس
```

هرگز Backup نکن:

```text
Password خام
JWT
Refresh Token
API Key
Database Password
Google Drive Credential
Service Secret
```

اگر Draft شامل اطلاعات شخصی مشتری است، Backup آن باید رمزنگاری‌شده باشد و امکان حذف/Timeout داشته باشد.

---

## 18. تست‌های اجباری Android

### Read Offline

1. Login آنلاین
2. Bootstrap
3. قطع اینترنت
4. جست‌وجوی محصول
5. مشاهدهٔ موجودی Cache

### Write Offline

1. قطع اینترنت
2. ایجاد Draft فاکتور
3. ثبت receive یا adjust
4. مشاهدهٔ Queue
5. اتصال اینترنت
6. بررسی Sync خودکار

### Duplicate

1. یک Operation ارسال شود.
2. پاسخ شبکه عمداً Drop شود.
3. همان Operation با همان `operationId` دوباره ارسال شود.
4. فقط یک رکورد در سرور وجود داشته باشد.

### Crash

1. Operation در وضعیت Sending باشد.
2. اپلیکیشن Force Stop شود.
3. اپلیکیشن دوباره باز شود.
4. Worker همان Operation را با همان `operationId` ادامه دهد.

### دو دستگاه

1. گوشی A و B Bootstrap شوند.
2. هر دو آفلاین شوند.
3. هر دو روی یک موجودی عملیات انجام دهند.
4. هر دو آنلاین شوند.
5. یکی Applied و دیگری Conflict شود.
6. وضعیت معتبر سرور به هر دو برسد.

---

## 19. ترتیب پیاده‌سازی Android

### فاز ۱: Read-only

- Login
- Device Registration
- Bootstrap
- Room Cache
- Product Search
- Inventory Read
- Pull Changes

### فاز ۲: Queue

- SyncQueue
- Operation ID Generator
- Operation Contract
- Pending UI
- Status Endpoint

### فاز ۳: Write

- Inventory Receive
- Inventory Adjust
- Inventory Transfer
- Product Create/Update

### فاز ۴: مالی

- Invoice Draft
- Invoice Create
- Invoice Pay
- Purchase Create
- Purchase Pay

### فاز ۵: Conflict و Production

- Conflict UI
- Resolve Flow
- Retry Backoff
- Crash Recovery
- دو Device Test
- Observability و Logs

---

## 20. چک‌لیست تحویل به Backend

قبل از اعلام آماده بودن Android، این موارد باید ارسال شوند:

```text
Device ID
Bootstrap cursor
Operation IDs
نوع Operation
Payload بدون Secret
نتیجه API
وضعیت محلی
لاگ Retry
Conflict ID در صورت Conflict
```

توکن، Password و Secret را داخل لاگ یا Ticket قرار نده.

---

## 21. خروجی مورد انتظار Agent Android

Agent دیگر باید این Deliverableها را تولید کند:

1. Room entities و DAOها
2. Retrofit API interface
3. Repositoryهای Bootstrap، Pull و Operation
4. WorkManager Sync Worker
5. Operation ID Generator
6. Retry و Backoff Policy
7. Conflict Repository و UI
8. Invoice Draft Flow
9. تست‌های Unit
10. تست‌های Instrumentation
11. گزارش تست دو دستگاه

هدف نهایی این نیست که Android فقط داده را نمایش دهد؛ هدف این است که هر تغییر مهم به یک Operation قابل تکرار، قابل پیگیری، Auditپذیر و Conflict-aware تبدیل شود.

---

# 22. محدودهٔ نهایی Android: فقط سه تب کاربردی

هدف این پروژه ساخت نسخهٔ کامل پنل مدیریت روی Android نیست. اپلیکیشن Android عمداً کوچک و عملیاتی می‌ماند و فقط سه بخش اصلی دارد:

```text
تب ۱: محصولات و موجودی
تب ۲: صدور فاکتور
تب ۳: ایجاد محصول
```

صفحه‌های داشبورد، گزارش‌ها، مشتریان، خریدها، تنظیمات، کاربران، پیامک، PDFهای مدیریتی و سایر بخش‌های پنل در نسخهٔ اول Android ساخته نمی‌شوند و فقط در پنل وب باقی می‌مانند.

## تب ۱: محصولات و موجودی

هدف: مشاهدهٔ سریع کالا، جست‌وجو و تغییرات روزمرهٔ انبار.

### قابلیت‌های ضروری

- لیست محصولات فعال
- جست‌وجو با نام، کد، بارکد و شماره قطعه
- نمایش نام و تصویر محصول در صورت وجود
- نمایش دسته‌بندی
- نمایش برند
- نمایش قفسه/مکان انبار
- نمایش موجودی فعلی
- نمایش حداقل موجودی و هشدار کمبود
- نمایش قیمت خرید
- نمایش قیمت فروش
- فیلتر کمبود موجودی
- فیلتر دسته و مکان
- Refresh از سرور
- مشاهدهٔ آخرین وضعیت در حالت Offline
- افزایش موجودی
- کاهش یا اصلاح موجودی
- انتقال به قفسه/مکان دیگر

### رفتار Offline

لیست و جست‌وجو از Room انجام می‌شود و به اینترنت وابسته نیست. عملیات افزایش، اصلاح و انتقال موجودی در صف محلی ثبت می‌شود:

```text
inventory.receive
inventory.adjust
inventory.transfer
```

کاربر باید وضعیت هر تغییر را ببیند:

```text
در انتظار ارسال
در حال ارسال
ثبت شد
Conflict
خطا
```

در این تب مقدار محلی فقط Cache/پیش‌نمایش است. موجودی معتبر نهایی از سرور و Change Feed می‌آید.

### UI پیشنهادی

```text
SearchBox
Filter chips: همه، کمبود، دسته، قفسه
ProductCard یا CompactRow
  نام
  کد
  موجودی
  قفسه
  قیمت فروش
  دکمه +
  دکمه -
  منوی انتقال
SyncStatusBadge
```

برای اصلاح موجودی، مقدار و علت تغییر الزامی باشد. برای فروش یا تغییر حساس، دوبار کلیک نباید دو Operation ایجاد کند؛ دکمه باید بعد از اولین کلیک Disable شود و همان `operationId` حفظ شود.

## تب ۲: صدور فاکتور

هدف: ثبت سریع فروش، نه بازسازی همهٔ امکانات Invoice پنل وب.

### قابلیت‌های ضروری

- جست‌وجوی محصول از Cache محلی
- افزودن کالا به سبد
- تغییر تعداد
- نمایش قیمت واحد و جمع
- انتخاب مشتری موجود یا ثبت اطلاعات محدود مشتری
- نمایش مبلغ نهایی
- انتخاب روش پرداخت
- ثبت به‌عنوان Draft در حالت Offline
- ارسال خودکار بعد از اتصال
- نمایش شماره موقت تا قبل از تأیید سرور
- نمایش شماره رسمی فقط بعد از `applied`
- نمایش Conflict در صورت تغییر قیمت/موجودی/وضعیت مشتری

### چیزهایی که در نسخهٔ اول Android انجام نمی‌شوند

- گزارش‌های پیچیدهٔ مالی
- طراحی کامل PDF فاکتور
- مدیریت کامل برگشت کالا
- ویرایش فاکتور رسمی بعد از ثبت
- مدیریت کامل چک‌ها مگر اینکه API و UI جداگانه اضافه شود
- امکانات کامل حسابداری پنل وب

### جریان Draft

```text
انتخاب محصول از Cache
  -> ساخت InvoiceDraft در Room
  -> افزودن اقلام
  -> ذخیره شماره موقت
  -> در صورت Offline: باقی ماندن در Draft/Pending
  -> در صورت Online: تبدیل به invoice.create
  -> بررسی موجودی در Backend
  -> applied یا conflict
```

Operation ایجاد فاکتور:

```text
invoice.create
```

پرداخت باید Operation جدا باشد و به فاکتور رسمی سرور متصل شود:

```text
invoice.pay
```

تا وقتی `invoice.create` موفق نشده، Android نباید `invoice.pay` را ارسال کند.

## تب ۳: ایجاد محصول

هدف: ثبت سریع محصول جدید در انبار/کاتالوگ.

### فیلدهای ضروری

- نام محصول
- دسته‌بندی
- برند در صورت نیاز
- شماره قطعه
- بارکد اختیاری یا تولیدشده
- قیمت خرید
- قیمت فروش
- موجودی اولیه
- قفسه/مکان
- حداقل موجودی
- تصویر اختیاری
- وضعیت فعال/مخفی

### رفتار Offline

فرم ابتدا در Draft محلی ذخیره می‌شود. بعد از تأیید کاربر:

```text
product.create
```

به صف اضافه می‌شود. `operationId` در تمام Retryها ثابت می‌ماند. Backend برای ایجاد محصول رکورد idempotency دارد و Replay باعث محصول تکراری نمی‌شود.

ویرایش‌های محدود بعدی:

```text
product.update
```

اگر محصول هنوز در حالت Pending ایجاد است، تغییرات را ابتدا روی Draft محلی Merge کن و از ساخت چند Operation غیرضروری خودداری کن.

---

# 23. معماری پنل وب و Android

## Backend مشترک

Backend منبع نهایی حقیقت است و شامل این لایه‌هاست:

```text
NestJS API
  ├── Auth و Role Guard
  ├── Catalog/Product Module
  ├── Inventory Module
  ├── Invoice Module
  ├── Supplier/Purchase Module
  ├── Sync Module
  ├── Audit Module
  └── Prisma/PostgreSQL
```

ماژول Sync نقطهٔ اتصال Android به Domain Serviceهاست و نباید منطق مالی یا موجودی جداگانه‌ای در Android پیاده شود.

## پنل وب Admin

پنل فعلی یک برنامهٔ React/Vite است و برای مدیریت کامل استفاده می‌شود:

```text
apps/admin
  ├── ProductsPage
  ├── InventoryPage
  ├── InvoicesPage
  ├── PurchasesPage
  ├── CustomersPage
  ├── UsersPage
  ├── ReportsPage
  ├── SettingsPage
  └── سایر صفحات مدیریتی
```

پنل وب برای عملیات پیچیده و مدیریتی مرجع است. Android نسخهٔ کوچک‌شدهٔ پنل نیست؛ فقط سه Workflow روزانه را ارائه می‌کند.

Endpointهای Catalog در Backend:

```text
GET    /api/v1/products
GET    /api/v1/products/:id
POST   /api/v1/products
PATCH  /api/v1/products/:id
POST   /api/v1/products/:id/restore
```

Endpointهای Invoice پنل وب:

```text
GET    /api/v1/invoices
GET    /api/v1/invoices/options
POST   /api/v1/invoices
POST   /api/v1/invoices/:id/pay
POST   /api/v1/invoices/:id/returns
```

Android برای عملیات Offline نباید مستقیماً منطق حساس را با Endpointهای عادی پنل دور بزند؛ برای Commandهای آفلاین از این Endpoint استفاده کند:

```text
POST /api/v1/sync/operations
```

## Android App

معماری پیشنهادی:

```text
UI Layer
  ├── ProductsScreen
  ├── InvoiceScreen
  └── CreateProductScreen

ViewModel Layer
  ├── ProductsViewModel
  ├── InvoiceViewModel
  └── CreateProductViewModel

Repository Layer
  ├── ProductRepository
  ├── InventoryRepository
  ├── InvoiceRepository
  └── SyncRepository

Local Data
  ├── Room Database
  ├── SyncQueue
  ├── SyncState
  ├── Conflicts
  └── DraftInvoices

Remote Data
  ├── Retrofit API
  ├── Auth Interceptor
  ├── Sync Worker
  └── Network Monitor
```

## مرزبندی پنل و Android

```text
پنل وب: عملیات کامل و پیچیده
Android: سه Workflow سریع و روزانه
Backend: منبع حقیقت، اعتبارسنجی، Transaction و Audit
Room: Cache، Draft و Queue
Cloud/API: تصمیم نهایی دربارهٔ موجودی و مالی
```

Android نباید:

- مستقیماً دیتابیس را تغییر دهد.
- موجودی سرور را با مقدار محلی Overwrite کند.
- فاکتور رسمی را بدون پاسخ سرور قطعی فرض کند.
- برای Retry، OperationId جدید بسازد.
- Secret یا Token را در Queue ذخیره کند.
- تمام صفحات پنل وب را کپی کند.

---

# 24. اولویت پیاده‌سازی Android

به دلیل محدود بودن Scope، ترتیب کار این باشد:

## فاز A: تب محصولات Read-only

```text
Login
Device Registration
Bootstrap
Room Product/Inventory
Search
Filters
Pull
```

## فاز B: تغییر موجودی

```text
Queue
inventory.receive
inventory.adjust
inventory.transfer
Worker
Retry
Status Badge
```

## فاز C: تب صدور فاکتور

```text
Product picker
Cart
InvoiceDraft
invoice.create
Conflict UI
invoice.pay بعد از Applied
```

## فاز D: تب ایجاد محصول

```text
Create form
Local Draft
product.create
product.update
Image upload در صورت نیاز
```

## فاز E: پایداری

```text
Crash recovery
Two-device test
Duplicate test
Conflict test
Battery/network constraints
Release build
```

در هر فاز UI فقط زمانی به فاز بعد برود که وضعیت Sync عملیات برای کاربر قابل مشاهده و قابل فهم باشد.
