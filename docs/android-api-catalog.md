# کاتالوگ رسمی API اتصال Android

## مشخصات عمومی

```text
Base URL: https://api.salimvand.ir/api/v1
Auth: Authorization: Bearer <access-token>
Device: x-device-id: <device-id>
Content-Type: application/json
```

همهٔ Responseها:

```json
{ "ok": true, "data": {} }
```

خطا:

```json
{ "statusCode": 400, "message": "...", "error": "Bad Request" }
```

## احراز هویت و دستگاه

```http
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
POST /sync/devices
```

ثبت دستگاه:

```json
{
  "deviceId": "android-uuid",
  "name": "گوشی انبار"
}
```

Headerهای تمام APIهای خصوصی:

```http
Authorization: Bearer <token>
x-device-id: android-uuid
```

## Bootstrap و Pull

```http
GET /sync/bootstrap
GET /sync/pull?cursor=0&limit=200
POST /sync/operations/status
GET /sync/conflicts?status=open
POST /sync/conflicts/{conflictId}/resolve
```

`GET /sync/operations` وجود ندارد و نباید صدا زده شود. `POST /sync/operations/recover` فقط برای مدیران Backend است (`super_admin` و `manager`) و Android هرگز آن را اجرا نمی‌کند؛ بازیابی عملیاتهای معلق توسط تایمر خود سرور انجام می‌شود.

وضعیت Operation:

```json
{
  "operationIds": ["android-device-000001"]
}
```

## تب ۱: محصولات و موجودی

### آمار کل انبار

```http
GET /inventory/summary
```

```json
{
  "itemCount": 120,
  "totalQuantity": "850",
  "purchaseValue": "1250000000",
  "saleValue": "1780000000",
  "lowStockCount": 12,
  "outOfStockCount": 4
}
```

تمام مبالغ رشته‌ای هستند و واحد آن‌ها ریال است.

### لیست موجودی و محصولات

```http
GET /inventory/items
GET /inventory/items?q=لنت
GET /inventory/items?brandId={brandId}
GET /inventory/items?locationId={locationId}
GET /inventory/items?status=low
GET /inventory/items?status=out
```

هر ردیف شامل اطلاعات محصول، دسته، برند، بارکد، تعداد، قیمت خرید، قیمت فروش، مکان و قفسه است.

### دریافت مشخصات یک محصول

```http
GET /products/{productId}
```

### جست‌وجو با بارکد

```http
GET /inventory/barcode/{barcode}
```

### موجودی کم و تمام‌شده

```http
GET /inventory/low-stock
```

### تاریخچهٔ تغییرات یک قلم

```http
GET /inventory/items/{inventoryItemId}/transactions
```

### تاریخچهٔ قیمت فروش یک قلم (شمسی)

هر تغییر قیمت فروش — از پنل، اندروید یا تغییر گروهی — به‌طور خودکار با تاریخ ثبت می‌شود. این
endpoint تایم‌لاین کامل یک قلم را برمی‌گرداند (جدیدترین اول، حداکثر ۱۰۰ ردیف):

```http
GET /inventory/items/{inventoryItemId}/price-history
```

نیازمند JWT با نقش `warehouse` یا `manager` یا `accountant` است. پاسخ:

```json
{
  "ok": true,
  "data": [
    {
      "id": "42",
      "itemId": "inventory-item-id",
      "oldSalePrice": "2450000",
      "newSalePrice": "2600000",
      "source": "android",
      "userName": "سلیم‌وند",
      "changedAt": "2026-09-18T08:30:00.000Z",
      "changedAtJalali": "۱۴۰۵/۰۶/۲۷، ۱۲:۰۰"
    }
  ]
}
```

- `oldSalePrice` برای ردیف اول (قیمت اولیهٔ ثبت‌شده) `null` است.
- `source` یکی از `panel` (پنل وب)، `android` (عملیات offline اندروید) یا `bulk` (تغییر گروهی قیمت) است.
- `changedAtJalali` از پیش با تقویم شمسی (fa-IR persian) فرمت شده و می‌تواند مستقیم نمایش داده شود؛
  `changedAt` ISO است و برای مرتب‌سازی/فیلتر محلی است.

### دریافت موجودی

برای Offline از Sync استفاده شود:

```http
POST /sync/operations
```

```json
{
  "operationId": "android-device-receive-000001",
  "deviceId": "android-device",
  "type": "inventory.receive",
  "payload": {
    "itemId": "inventory-item-id",
    "quantity": 10,
    "reason": "دریافت از تأمین‌کننده"
  }
}
```

### کاهش یا اصلاح موجودی

```json
{
  "operationId": "android-device-adjust-000001",
  "deviceId": "android-device",
  "type": "inventory.adjust",
  "payload": {
    "itemId": "inventory-item-id",
    "quantity": -2,
    "reason": "اصلاح شمارش"
  }
}
```

### انتقال به قفسه

```json
{
  "operationId": "android-device-transfer-000001",
  "deviceId": "android-device",
  "type": "inventory.transfer",
  "payload": {
    "itemId": "inventory-item-id",
    "locationId": "destination-location-id"
  }
}
```

### لیست قفسه‌ها و مکان‌ها

```http
GET /sync/bootstrap
```

از فیلد `data.locations` استفاده شود. در هر Location این اطلاعات موجود است:

```text
id
parentId
type
code
name
```

### ایجاد یا ویرایش قلم موجودی

فقط برای حالت Online پنل/مدیریت:

```http
POST /inventory/items
PATCH /inventory/items/{inventoryItemId}
```

برای تغییر تعداد از این دو مسیر استفاده نشود؛ تعداد فقط با Commandهای Sync تغییر کند.

## تب ۲: صدور فاکتور

### گزینه‌های فرم فاکتور

```http
GET /invoices/options
GET /invoices/customers?search={text}
```

`search` خالی هم مجاز است و ۱۰۰ مشتری آخر را برمی‌گرداند (برای باز شدن Customer Picker). هر مشتری:

```text
id
name
mobile
address
notes
isActive
createdAt
```

### ثبت/به‌روزرسانی مشتری از فرم فاکتور

```http
POST /invoices/customers
```

نقش: `seller`. اعتبارسنجی: `name` (حداکثر ۱۵۰)، `mobile` با فرمت ایران، `address` اختیاری (حداکثر ۵۰۰)، `notes` اختیاری (حداکثر ۱۰۰۰).

```json
{
  "name": "حسن رضایی",
  "mobile": "09121234567",
  "address": "تهران، خیابان نمونه، پلاک ۱۲",
  "notes": "مشتری تعمیرگاه"
}
```

- موبایل تکراری مشتری جدید نمی‌سازد (upsert روی موبایل).
- `name` همیشه به‌روزرسانی می‌شود؛ اما `address` و `notes` **فقط اگر در درخواست ارسال شده باشند** تغییر می‌کنند (ارسال رشتهٔ خالی = پاک کردن؛ حذف فیلد = حفظ مقدار قبلی).
- آدرس یک فاکتور (`customerAddress` در `invoice.create`) فقط snapshot همان فاکتور است و پروفایل مشتری موجود را تغییر نمی‌دهد؛ برای تغییر دائمی آدرس، همین endpoint با آدرس جدید یا `PATCH /customers/:id` استفاده شود. مشتری جدیدِ داخل فرم فاکتور (نام+موبایل جدید) آدرس را هم روی پروفایل و هم روی فاکتور ذخیره می‌کند.

همین عملیات به‌صورت آفلاین هم قابل صف‌کردن است:

```http
POST /sync/operations
```

```json
{
  "operationId": "android-device-customer-000001",
  "deviceId": "android-device",
  "type": "customer.create",
  "payload": {
    "name": "حسن رضایی",
    "mobile": "09121234567",
    "address": "تهران، خیابان نمونه، پلاک ۱۲",
    "notes": "مشتری تعمیرگاه"
  }
}
```

تغییرات آدرس/notes مشتری از طریق `GET /sync/pull` (entityType مشتری با snapshot کامل شامل `address`) به بقیهٔ دستگاه‌ها می‌رسد.

### فهرست فاکتورها

```http
GET /invoices
```

### ایجاد فاکتور Offline یا Online

```http
POST /sync/operations
```

```json
{
  "operationId": "android-device-invoice-000001",
  "deviceId": "android-device",
  "type": "invoice.create",
  "payload": {
    "items": [],
    "customerId": "customer-id",
    "notes": "ثبت از Android"
  }
}
```

### پرداخت فاکتور

فقط بعد از Applied شدن `invoice.create`:

```http
POST /sync/operations
```

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

روش‌های پرداخت:

```text
cash
card
transfer
credit
```

### مرجوعی کالا (شیت مرجوعی)

مرجوعی **عمداً Online و مستقیم** ثبت می‌شود (در صف Sync آفلاین قرار نمی‌گیرد). برای شیت مرجوعی به‌جای
`GET /invoices/{id}` (که نقش warehouse اجازهٔ دیدنش را ندارد) از endpoint محدود زیر استفاده کنید:

```http
GET /invoices/{invoiceId}/return-context
```

نقش‌ها: `manager`، `warehouse`، `accountant`. این پاسخ فقط دادهٔ لازم برای مرجوعی را دارد — بدون
موبایل/آدرس مشتری و بدون تاریخچهٔ پرداخت‌ها:

```json
{
  "ok": true,
  "data": {
    "id": "invoice-id",
    "number": "INV-1001",
    "status": "issued",
    "paymentStatus": "partial",
    "total": "250000000",
    "paidAmount": "100000000",
    "returnedTotal": "10000000",
    "netTotal": "240000000",
    "items": [
      {
        "id": "invoice-item-id",
        "productName": "لنت ترمز جلو",
        "quantity": 4,
        "unitPrice": "10000000",
        "returnedQuantity": 1
      }
    ],
    "returns": [
      {
        "id": "return-record-id",
        "invoiceItemId": "invoice-item-id",
        "quantity": 1,
        "refundAmount": "10000000",
        "reason": "ناسازگاری با خودرو",
        "restock": true,
        "createdAt": "2026-09-18T10:15:00.000Z"
      }
    ]
  }
}
```

`returnedQuantity` هر قلم = مجموع مرجوعی‌های ثبت‌شدهٔ همان ردیف؛ حداکثر قابل مرجوعی =
`quantity - returnedQuantity`. پول‌ها رشتهٔ ریالی هستند.

ثبت مرجوعی:

```http
POST /invoices/{invoiceId}/returns
```

نقش‌ها: `manager`، `warehouse`، `accountant`. بدنه:

```json
{
  "invoiceItemId": "invoice-item-id",
  "quantity": 2,
  "reason": "ناسازگاری با خودرو",
  "restock": true
}
```

- `restock: true` → کالا سالم است: مبلغ از فاکتور کسر می‌شود و موجودی به انبار برمی‌گردد (ردیف ledger با `type=return`).
- `restock: false` → ضایعات: فقط مبلغ کسر می‌شود، موجودی تغییر نمی‌کند.
- مبلغ مرجوعی همیشه از **قیمت ثبت‌شده در ردیف فاکتور** محاسبه می‌شود (`quantity × unitPrice`)، نه قیمت روز.
- بعد از هر مرجوعی، `netTotal = total - returnedTotal` و `paymentStatus` دوباره محاسبه می‌شود (اگر
  مرجوعی ماندهٔ بدهی را پوشش دهد، فاکتور `paid` می‌شود).
- فاکتور باطل‌شده (`voided`) و مرجوعی بیش از تعداد خریداری‌شده با خطای خوانا رد می‌شوند.
- **هم‌زمانی ایمن است:** سرور قبل از بررسی سقف مرجوعی، ردیف فاکتور را با `FOR UPDATE` قفل می‌کند؛
  دو درخواست هم‌زمان روی آخرین تعداد قابل مرجوعی فقط یکی‌شان موفق می‌شود (دومی ۴۰۰ می‌گیرد).
  پس retry سمت کلاینت فقط بعد از پاسخ قطعی سرور انجام شود، نه به‌صورت blind retry.

## تب ۳: ایجاد محصول

### لیست و جزئیات

```http
GET /products
GET /products/{productId}
```

### ایجاد محصول Offline یا Online

`product.create` اختیاریاً زیرشیء `inventory` دارد؛ در این صورت Product، دقیقاً یک InventoryItem و در صورت `initialQuantity > 0` یک ردیف ledger با `type=initial` در **یک تراکنش** ساخته می‌شوند و قلم خنثیِ بدون برند ساخته نمی‌شود. `categoryId` و در صورت ارسال `brandId`/`locationId` باید شناسهٔ واقعی و موجود باشند؛ نام آزاد برند پذیرفته نیست. تعداد فقط از طریق ledger ثبت می‌شود.

```http
POST /sync/operations
```

```json
{
  "operationId": "android-device-product-000001",
  "deviceId": "android-device",
  "type": "product.create",
  "payload": {
    "name": "لنت ترمز جلو پژو ۲۰۶",
    "categoryId": "category-id",
    "partNumber": "PN-206",
    "description": "توضیح محصول",
    "status": "active",
    "inventory": {
      "brandId": "brand-id-or-null",
      "barcode": "6261234567890",
      "purchasePrice": "1850000",
      "salePrice": "2450000",
      "minStock": 3,
      "locationId": "location-id-or-null",
      "initialQuantity": 10
    }
  }
}
```

پاسخ موفق `result` حداقل شامل این فیلدهاست تا Draft محلی دقیق جایگزین شود:

```json
{
  "ok": true,
  "data": {
    "operationId": "android-device-product-000001",
    "status": "applied",
    "result": {
      "id": "product-id",
      "inventoryItem": {
        "id": "inventory-item-id",
        "barcode": "6261234567890",
        "purchasePrice": "1850000",
        "salePrice": "2450000",
        "quantity": 10
      }
    },
    "duplicate": false
  }
}
```

### ویرایش محصول

فیلدهای کاتالوگ و در صورت نیاز زیرشیء `inventory` (با `itemId` صریح) در **یک تراکنش** اعمال می‌شوند. `quantity` در ویرایش metadata پذیرفته نمی‌شود؛ تعداد فقط با `inventory.receive` یا `inventory.adjust` تغییر می‌کند.

**تغییر قیمت فروش** از همین مسیر ممکن است: کافی است در `inventory` فقط `itemId` و `salePrice` را بفرستید
(یا از `inventory.update_metadata` استفاده کنید). سرور به‌طور خودکار تاریخ شمسی تغییر را در
تاریخچهٔ قیمت ثبت و `priceUpdatedAt` قلم را به‌روز می‌کند.

```json
{
  "operationId": "android-device-product-update-000001",
  "deviceId": "android-device",
  "type": "product.update",
  "payload": {
    "productId": "product-id",
    "name": "نام جدید",
    "status": "active",
    "inventory": {
      "itemId": "inventory-item-id",
      "purchasePrice": "1900000",
      "salePrice": "2500000",
      "minStock": 5,
      "locationId": "location-id",
      "barcode": "6261234567890",
      "brandId": "brand-id"
    }
  }
}
```

### ویرایش metadata قلم موجودی (بدون تغییر تعداد)

برای ویرایش مستقیم قیمت/قفسه/بارکد/برند یک قلم، بدون ساخت محصول:

```json
{
  "operationId": "android-device-meta-000001",
  "deviceId": "android-device",
  "type": "inventory.update_metadata",
  "payload": {
    "itemId": "inventory-item-id",
    "purchasePrice": "1900000",
    "salePrice": "2500000",
    "minStock": 5,
    "locationId": "location-id",
    "barcode": "6261234567890",
    "brandId": "brand-id",
    "notes": "یادداشت اختیاری"
  }
}
```

هر دو مسیر idempotent هستند و audit/sync change ثبت می‌کنند.

## ایجاد مشتری Offline/Online

```http
POST /sync/operations
```

```json
{
  "operationId": "android-device-customer-000001",
  "deviceId": "android-device",
  "type": "customer.create",
  "payload": { "name": "نام مشتری", "mobile": "09xxxxxxxxx", "notes": "" }
}
```

## جدول Operationها

| عملیات              | type                        | نتیجهٔ موفق                                |
| ------------------- | --------------------------- | ------------------------------------------ |
| دریافت موجودی       | `inventory.receive`         | تراکنش موجودی                              |
| اصلاح موجودی        | `inventory.adjust`          | تراکنش موجودی                              |
| انتقال قفسه         | `inventory.transfer`        | تراکنش انتقال                              |
| ویرایش metadata قلم | `inventory.update_metadata` | قلم به‌روزشده                              |
| ایجاد فاکتور        | `invoice.create`            | فاکتور رسمی                                |
| پرداخت فاکتور       | `invoice.pay`               | پرداخت                                     |
| ایجاد محصول         | `product.create`            | محصول + قلم موجودی + ledger اولیه          |
| ویرایش محصول        | `product.update`            | محصول ویرایش‌شده (+ قلم در صورت inventory) |
| ایجاد مشتری         | `customer.create`           | مشتری                                      |

## قواعد ارسال

```text
operationId در Retry تغییر نکند
برای هر کلیک حساس فقط یک Operation ساخته شود
موجودی مستقیم Overwrite نشود
پرداخت قبل از Applied شدن فاکتور ارسال نشود
بعد از Timeout همان Operation دوباره ارسال شود
در 401 ابتدا Refresh Token انجام شود
در Conflict عملیات به Queue برنگردد مگر بعد از تصمیم کاربر
```

### Schema ثابت پاسخ Operation

همهٔ پاسخهای `POST /sync/operations` و `POST /sync/operations/status`:

```json
{
  "ok": true,
  "data": {
    "operationId": "...",
    "status": "applied|pending|conflict|failed",
    "result": {},
    "duplicate": false
  }
}
```

`result` برای ایجادهای مهم (محصول، فاکتور، پرداخت) هرگز null یا مبهم نیست. ارسال مجدد همان `operationId` در وضعیت `pending`، همان عملیات را claim و اجرا می‌کند؛ پس Retry پس از تصمیم `retry` واقعاً اجرا می‌شود.

## Conflict و تصمیم اپراتور

```http
GET /sync/conflicts?status=open
POST /sync/conflicts/{conflictId}/resolve
```

بدنهٔ resolve:

```json
{ "decision": "retry | reject | accept_server_state | create_new_draft", "note": "اختیاری" }
```

هر مقدار دیگری با 400 رد می‌شود. پاسخ resolve:

```json
{
  "ok": true,
  "data": {
    "conflictId": "...",
    "decision": "retry",
    "operationId": "android-device-op-000001",
    "status": "applied",
    "result": {},
    "error": null,
    "serverState": null,
    "snapshot": null,
    "draft": null,
    "conflict": null
  }
}
```

- `retry`: عملیات اصلی به حالت قابل اجرا برمی‌گردد و **بلافاصله** اعمال می‌شود؛ `status` پاسخ نتیجهٔ واقعی اجراست (`applied` یا `conflict` جدید یا `failed`). در conflict مجدد، فیلد `conflict` شناسهٔ Conflict باز جدید را برمی‌گرداند.
- `reject`: عملیات به‌صورت قطعی `failed` می‌شود.
- `accept_server_state`: عملیات `failed` می‌شود و `snapshot` وضعیت تازهٔ سرور (قلم موجودی / محصول + اقلام / فاکتور) را برمی‌گرداند تا cache بدون LWW کورکورانه تصحیح شود.
- `create_new_draft`: عملیات `failed` می‌شود و `draft` شامل `type`، `payload` اصلی و `serverState` برای پیش‌نویس جدید است.

## Payload تغییرات Pull

`GET /sync/pull` برای موجودیتهای `product`, `inventory_item`, `invoice`, `customer`, `brand`, `category`, `location` یک snapshot کامل و بدون secret در `payload` برمی‌گرداند. `action` فقط یکی از:

```text
created  → payload را در cache درج/جایگزین کن
updated  → payload را در cache جایگزین کن
deleted  → رکورد را با entityId از cache حذف کن
```

نمونهٔ payload قلم موجودی (پولها رشتهٔ ریالی):

```json
{
  "id": "inventory-item-id",
  "productId": "product-id",
  "brandId": "brand-id-or-null",
  "barcode": "6261234567890",
  "quantity": 10,
  "purchasePrice": "1850000",
  "salePrice": "2450000",
  "minStock": 3,
  "locationId": "location-id-or-null",
  "isActive": true,
  "priceUpdatedAt": "2026-09-18T08:30:00.000Z",
  "priceUpdatedAtJalali": "۱۴۰۵/۰۶/۲۷"
}
```

`priceUpdatedAt` تاریخ اعمال قیمت فروش فعلی است (ISO یا `null` اگر از زمان فعال‌شدن این قابلیت
قیمت تغییر نکرده باشد) و `priceUpdatedAtJalali` همان تاریخ با تقویم شمسی — برای بج «قیمت از»
کنار قیمت در اپ قابل نمایش است. ردیفهای `inventory` در Bootstrap هم همین دو فیلد را دارند.

تغییر قیمت فروش از اندروید از همان دو مسیر قبلی انجام می‌شود (`product.update` با
`inventory.salePrice` یا `inventory.update_metadata`) — تاریخ و تاریخچه به‌طور خودکار ثبت می‌شود.

payload محصول هم‌شکل ردیفهای `products` در Bootstrap است (`id`, `code`, `slug`, `name`, `categoryId`, `status`, `priceDisplay`, `image`, `imageUrl`, ...). حذف نرم محصول، علاوه بر `product/deleted`، برای همهٔ اقلام آن `inventory_item/deleted` صادر می‌کند.

## کدهای مهم پاسخ

```text
200/201  موفق
400      Payload یا مقدار نامعتبر
401      Token نامعتبر یا منقضی
403      نقش کاربر مجاز نیست
404      رکورد پیدا نشد
409      Conflict یا تغییر هم‌زمان
429      درخواست بیش از حد
500      خطای موقت سرور؛ Retry با Backoff
```

## تصاویر محصولات

Bootstrap اکنون برای هر محصول این فیلدها را برمی‌گرداند:

```json
{
  "images": [{ "id": "...", "path": "/uploads/products/.../large.webp", "alt": "..." }],
  "imageUrl": "https://salimvand.ir/uploads/products/.../large.webp"
}
```

برای Android از `imageUrl` استفاده کن؛ `imageUrl` قابل استفادهٔ مستقیم در Coil/Glide است. اگر `imageUrl` برابر `null` بود، Placeholder نمایش بده. تصویر محلی را با `productId` و `imageUrl` در Cache ذخیره کن.

```kotlin
AsyncImage(model = product.imageUrl, contentDescription = product.name)
```

مسیرهای `/uploads/...` روی VPS و Nginx سرو می‌شوند و نباید به `localhost`، `127.0.0.1` یا IP داخلی تبدیل شوند.

## قرارداد Native Refresh Token

در Login و Refresh، Backend برای Android این پاسخ را می‌دهد:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "user": {}
}
```

Android باید `refreshToken` را فقط در Android Keystore/Encrypted DataStore نگه دارد. سرور همچنان Cookie امن وب را نیز تنظیم می‌کند. Logout موبایل:

```http
POST /api/v1/auth/logout
Content-Type: application/json

{ "refreshToken": "..." }
```

`operationIds` در Status الزاماً UUID نیستند؛ باید همان شناسهٔ ثابت تولیدشده توسط Android باشند.
