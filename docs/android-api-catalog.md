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
GET /sync/operations?status=pending
GET /sync/conflicts?status=open
POST /sync/conflicts/{conflictId}/resolve
POST /sync/operations/recover
```

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

## تب ۳: ایجاد محصول

### لیست و جزئیات

```http
GET /products
GET /products/{productId}
```

### ایجاد محصول Offline یا Online

```http
POST /sync/operations
```

```json
{
  "operationId": "android-device-product-000001",
  "deviceId": "android-device",
  "type": "product.create",
  "payload": {
    "name": "لنت ترمز پژو 206",
    "categoryId": "category-id",
    "partNumber": "PN-206",
    "description": "توضیح محصول",
    "status": "active"
  }
}
```

### ویرایش محصول

```json
{
  "operationId": "android-device-product-update-000001",
  "deviceId": "android-device",
  "type": "product.update",
  "payload": {
    "productId": "product-id",
    "name": "نام جدید",
    "status": "active"
  }
}
```

## جدول Operationها

| عملیات | type | نتیجهٔ موفق |
|---|---|---|
| دریافت موجودی | `inventory.receive` | تراکنش موجودی |
| اصلاح موجودی | `inventory.adjust` | تراکنش موجودی |
| انتقال قفسه | `inventory.transfer` | تراکنش انتقال |
| ایجاد فاکتور | `invoice.create` | فاکتور رسمی |
| پرداخت فاکتور | `invoice.pay` | پرداخت |
| ایجاد محصول | `product.create` | محصول |
| ویرایش محصول | `product.update` | محصول ویرایش‌شده |

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
