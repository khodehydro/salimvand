# دستور اصلاح Android Agent — قرارداد نهایی اتصال به Salimvand

این سند باید مبنای اصلاح کد Android قرار گیرد. هدف Android فقط سه تب است:

```text
1. محصولات و موجودی
2. صدور فاکتور
3. ایجاد محصول
```

آخرین Backend Deploy‌شده:

```text
5d71ef4
```

---

## 1. Base URL و Headerها

```text
Base URL: https://api.salimvand.ir/api/v1
Public image base: https://salimvand.ir
```

تمام درخواست‌های خصوصی:

```http
Authorization: Bearer <accessToken>
x-device-id: <stable-device-id>
Content-Type: application/json
```

از این‌ها در Android استفاده نشود:

```text
localhost
127.0.0.1
IP داخلی VPS
```

---

## 2. Auth را اصلاح کن

### Login

```http
POST /auth/login
```

```json
{
  "username": "...",
  "password": "..."
}
```

پاسخ:

```json
{
  "ok": true,
  "data": {
    "accessToken": "...",
    "refreshToken": "...",
    "user": {
      "id": "...",
      "username": "...",
      "name": "...",
      "role": "..."
    }
  }
}
```

### Refresh

فقط همین مسیر مجاز است:

```http
POST /auth/refresh
```

```json
{
  "refreshToken": "..."
}
```

پاسخ:

```json
{
  "ok": true,
  "data": {
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```

Refresh Token جدید باید جایگزین قبلی شود.

### Storage

```text
accessToken و refreshToken فقط در Android Keystore/Encrypted DataStore
رمز عبور خام هرگز ذخیره نشود
Token داخل Room، SyncQueue، Log و Backup ذخیره نشود
```

### رفتار 401

```text
هر درخواست فقط یک بار Refresh شود
در Refresh موفق، همان درخواست یک بار تکرار شود
در Refresh ناموفق، کاربر Login شود
Operation حذف نشود و waiting_auth بماند
بعد از Login، waiting_auth به pending برگردد
```

---

## 3. ثبت Device

```http
POST /sync/devices
```

```json
{
  "deviceId": "android-uuid",
  "name": "Android Admin"
}
```

`deviceId` باید برای تمام عمر نصب ثابت باشد و با هر Retry تغییر نکند.

---

## 4. Bootstrap و Pull

### Bootstrap

```http
GET /sync/bootstrap
```

پاسخ شامل:

```text
categories
brands
locations
products
inventory
cursor
```

Bootstrap را در یک Transaction محلی Room اعمال کن و Cursor را فقط بعد از موفقیت کامل ذخیره کن.

### Pull

```http
GET /sync/pull?cursor=0&limit=200
```

پاسخ:

```json
{
  "ok": true,
  "data": {
    "changes": [],
    "cursor": "123",
    "hasMore": false
  }
}
```

اگر `hasMore=true` بود، با Cursor جدید ادامه بده. Cursor را قبل از اعمال موفق Changeها ذخیره نکن.

---

## 5. Sync Operation Contract

```json
{
  "operationId": "android-device-invoice-000001",
  "deviceId": "android-device",
  "type": "invoice.create",
  "payload": {}
}
```

انواع رسمی:

```text
inventory.receive
inventory.adjust
inventory.transfer
inventory.update_metadata
product.create
product.update
invoice.create
invoice.pay
customer.create
purchase.create
purchase.pay
```

`operationId` الزاماً UUID نیست. باید ۸ تا ۱۰۰ کاراکتر امن باشد و در Retry ثابت بماند.

### ارسال

```http
POST /sync/operations
```

هر Operation جداگانه ارسال شود. برای عملیات یک کالا یا یک فاکتور FIFO حفظ شود.

### پاسخ موفق

```json
{
  "ok": true,
  "data": {
    "operationId": "android-device-invoice-000001",
    "status": "applied",
    "result": {},
    "duplicate": false
  }
}
```

در Retry همان `operationId` را بفرست. Operation جدید نساز.

### وضعیت Operation

```http
POST /sync/operations/status
```

```json
{
  "operationIds": ["android-device-000001"]
}
```

`operationIds` را فقط UUID فرض نکن.

### مسیرهایی که نباید صدا زده شوند

این مسیر وجود ندارد و نباید استفاده شود:

```http
GET /sync/operations
```

این مسیر فقط برای مدیران Backend است (`super_admin` و `manager`) و Android نباید در نصب مجدد آن را اجرا کند؛ تایمر خود سرور عملیاتهای معلق همهٔ کاربران را بازیابی می‌کند:

```http
POST /sync/operations/recover
```

بعد از Crash یا نصب مجدد:

```text
Operationهای محلی را با همان operationId دوباره ارسال کن
یا با /sync/operations/status وضعیت آن‌ها را بگیر
```

---

## 6. تب محصولات و موجودی

### لیست

```http
GET /inventory/items
GET /inventory/items?q=لنت
GET /inventory/items?brandId=<id>
GET /inventory/items?locationId=<id>
GET /inventory/items?status=low
GET /inventory/items?status=out
```

هر ردیف باید این اطلاعات را نگه دارد:

```text
inventoryItemId
productId
نام محصول
کد محصول
بارکد
برند
دسته
quantity
purchasePrice
salePrice
minStock
location
parent location / warehouse
```

### مجموع ارزش انبار

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

تمام مبلغ‌ها ریال و String هستند. در Domain Model آن‌ها را دقیق نگه دار و فقط در UI به تومان تبدیل کن.

### بارکد

اول Cache محلی را جست‌وجو کن، سپس در صورت نیاز:

```http
GET /inventory/barcode/{barcode}
```

### تاریخچه

```http
GET /inventory/items/{itemId}/transactions
```

### دریافت موجودی

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
    "quantity": 5,
    "reason": "دریافت کالا"
  }
}
```

`quantity` در receive باید مثبت باشد.

### اصلاح موجودی

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

`adjust` به‌صورت Delta است، نه مقدار نهایی.

### انتقال قفسه

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

---

## 7. دریافت تصاویر محصولات

در Bootstrap محصول:

```json
{
  "images": [
    {
      "id": "image-id",
      "path": "/uploads/products/image-id/large.webp",
      "alt": "تصویر محصول"
    }
  ],
  "imageUrl": "https://salimvand.ir/uploads/products/image-id/large.webp"
}
```

در Android فقط از `imageUrl` استفاده کن:

```kotlin
AsyncImage(
    model = product.imageUrl,
    contentDescription = product.name,
    placeholder = painterResource(R.drawable.product_placeholder),
    error = painterResource(R.drawable.product_placeholder)
)
```

اگر `imageUrl=null` یا خطای HTTP رخ داد، Placeholder نشان بده.

### آپلود تصویر محصول

در نسخهٔ فعلی، تصویر بخشی از `product.create` نیست.

ترتیب Online:

```text
۱. product.create
۲. دریافت productId
۳. POST /media/products/{productId}/upload به‌صورت multipart
۴. ذخیره imageUrl
۵. Pull یا Refresh محصول
```

اگر محصول Offline ایجاد شد:

```text
فایل تصویر در Cache محلی نگه‌داری شود
product.create ارسال شود
بعد از applied شدن، تصویر Upload شود
اگر Upload شکست خورد، Draft تصویر باقی بماند و Retry شود
```

---

## 8. تب صدور فاکتور

### گزینه‌های فرم

```http
GET /invoices/options
GET /invoices/customers?search=<text>
```

### لیست فاکتورها

```http
GET /invoices
```

### جزئیات فاکتور

```http
GET /invoices/{id}
```

### ایجاد فاکتور

در حالت Online و Offline از Sync استفاده کن:

```http
POST /sync/operations
```

```json
{
  "operationId": "android-device-invoice-000001",
  "deviceId": "android-device",
  "type": "invoice.create",
  "payload": {
    "items": [
      {
        "inventoryItemId": "inventory-item-id",
        "quantity": 2,
        "unitPrice": "500000"
      }
    ],
    "customerName": "نام مشتری",
    "customerMobile": "09xxxxxxxxx",
    "notes": "ثبت از Android"
  }
}
```

مراحل محلی:

```text
DRAFT -> PENDING -> SENDING -> APPLIED
                         -> CONFLICT
                         -> FAILED
```

### پرداخت فاکتور

قبل از `invoice.create` موفق، پرداخت ارسال نشود:

```json
{
  "operationId": "android-device-payment-000001",
  "deviceId": "android-device",
  "type": "invoice.pay",
  "payload": {
    "invoiceId": "server-invoice-id",
    "amount": "500000",
    "method": "cash"
  }
}
```

روش‌ها:

```text
cash
card
transfer
credit
```

---

## 9. تب ایجاد محصول

### خواندن محصولات

```http
GET /products
GET /products/{id}
```

### ایجاد محصول

زیرشیء `inventory` اختیاری است؛ با ارسال آن، Product + دقیقاً یک InventoryItem + ردیف ledger با `type=initial` در یک تراکنش ساخته می‌شوند و قلم خنثی اضافی ساخته نمی‌شود. `categoryId` و UUIDهای اختیاری (`brandId`, `locationId`) باید واقعی باشند.

```json
{
  "operationId": "android-device-product-000001",
  "deviceId": "android-device",
  "type": "product.create",
  "payload": {
    "name": "لنت ترمز پژو 206",
    "categoryId": "category-id",
    "partNumber": "PN-206",
    "description": "توضیح",
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

`result` پاسخ شامل `product.id` و `inventoryItem` (id، barcode، قیمتها و quantity نهایی) است تا Draft محلی دقیق جایگزین شود. Retry با همان `operationId` هیچ محصول یا ledger دومی نمی‌سازد.

### ویرایش محصول

فیلدهای کاتالوگ و زیرشیء `inventory` (با `itemId` صریح) در یک تراکنش اعمال می‌شوند؛ `quantity` فقط با receive/adjust تغییر می‌کند.

```json
{
  "operationId": "android-device-product-update-000001",
  "deviceId": "android-device",
  "type": "product.update",
  "payload": {
    "productId": "product-id",
    "name": "نام جدید",
    "status": "active",
    "inventory": { "itemId": "inventory-item-id", "salePrice": "2500000" }
  }
}
```

### ویرایش metadata قلم موجودی

برای قیمت/قفسه/بارکد/برند یک قلم بدون ساخت محصول:

```json
{
  "operationId": "android-device-meta-000001",
  "deviceId": "android-device",
  "type": "inventory.update_metadata",
  "payload": { "itemId": "inventory-item-id", "salePrice": "2500000", "locationId": "location-id" }
}
```

در صورت ایجاد محصول Offline، تا قبل از `applied` شدن، `serverProductId` وجود ندارد.

---

## 10. Conflict

```http
GET /sync/conflicts?status=open
POST /sync/conflicts/{id}/resolve
```

پاسخ Conflict شامل:

```text
id
operationId
type
code
payload
serverState
status
createdAt
```

تصمیمهای مجاز resolve (هر مقدار دیگر با 400 رد می‌شود):

```json
{ "decision": "retry | reject | accept_server_state | create_new_draft", "note": "اختیاری" }
```

- `retry`: عملیات به حالت قابل اجرا برمی‌گردد و بلافاصله اجرا می‌شود؛ پاسخ، `status` نهایی را برمی‌گرداند (`applied` / `conflict` / `failed`). در conflict مجدد فیلد `conflict` شناسهٔ Conflict باز جدید را دارد.
- `reject`: عملیات قطعی `failed` می‌شود.
- `accept_server_state`: `snapshot` تازهٔ سرور در پاسخ برمی‌گردد تا cache بدون LWW اشتباه تصحیح شود.
- `create_new_draft`: `draft` شامل payload اصلی و serverState برای پیش‌نویس جدید برمی‌گردد.

Android نباید Conflict را فقط با تغییر UI resolved کند؛ ابتدا باید پاسخ Backend دریافت شود.

---

## 11. Retry و WorkManager

صف محلی:

```text
pending
sending
applied
conflict
failed
waiting_auth
```

Backoff:

```text
1m, 2m, 5m, 15m, 30m, 60m
```

قواعد:

```text
Timeout: همان operationId دوباره ارسال شود
409: Conflict ثبت شود
401: Refresh سپس یک Retry
5xx/network: Backoff
400/403: خطای دائمی تا اقدام کاربر
```

ترتیب پیشنهادی Worker:

```text
1. Refresh Auth در صورت نیاز
2. Pull
3. Push قدیمی‌ترین Operation
4. ذخیره Ack
5. Pull دوباره برای Changeهای سرور
6. دریافت Conflictها
```

---

## 12. خطاهای پیاده‌سازی ممنوع

```text
ارسال دوباره با operationId جدید
ذخیره Token در Room
ذخیره Password
تغییر مستقیم quantity محلی به‌عنوان حقیقت نهایی
پرداخت قبل از Applied فاکتور
اعلام شماره رسمی قبل از پاسخ Server
استفاده از GET /sync/operations
اجرای recover سروری از Android
استفاده از productId به‌جای inventoryItemId برای invoice item
تبدیل زودهنگام ریال به تومان
استفاده از image path نسبی بدون Base URL
```

## 13. معیار تحویل Android Agent

```text
Login/Refresh واقعی با یک مسیر
Bootstrap و Pull با Cursor تراکنشی
Room Cache محصولات و موجودی
لیست با جست‌وجو و قفسه
نمایش ارزش خرید/فروش انبار
دریافت و اصلاح و انتقال موجودی
سه وضعیت تصویر: loaded/placeholder/error
Draft فاکتور
invoice.create و invoice.pay با ترتیب صحیح
product.create و product.update
Queue با operationId پایدار
Retry و Backoff
Status و Conflict UI
تست Duplicate
تست قطع اینترنت
تست Crash وسط Push
```
