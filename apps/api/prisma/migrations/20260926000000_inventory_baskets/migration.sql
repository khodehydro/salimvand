-- سبد (basket): the third level of the placement tree — انبار › قفسه › سبد.
-- Every stock line keeps its own shelf AND, optionally, its own basket, so a
-- part can be addressed as «انبار اصلی · A-03 · سبد ۲».

-- ۱) نوعِ تازهٔ محل: سبد
ALTER TYPE "LocationType" ADD VALUE IF NOT EXISTS 'basket';

-- ۲) اشاره‌گر سبد روی هر قلم موجودی (هر قلم قفسهٔ خودش را هم دارد)
ALTER TABLE "inventory_items" ADD COLUMN "basketId" UUID;

-- ۳) ایندکس و کلید خارجی — حذفِ سبد فقط جای کالا را خالی می‌کند (SET NULL)،
--    درست مثل قفسه؛ موجودی هرگز با حذف محل از بین نمی‌رود.
CREATE INDEX "inventory_items_basketId_idx" ON "inventory_items"("basketId");

ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_basketId_fkey"
  FOREIGN KEY ("basketId") REFERENCES "locations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
