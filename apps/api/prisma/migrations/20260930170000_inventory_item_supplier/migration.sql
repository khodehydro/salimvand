-- اشاره‌گر تأمین‌کننده روی قلم موجودی (اختیاری)
ALTER TABLE "inventory_items" ADD COLUMN "supplierId" UUID;

-- ایندکس تأمین‌کننده برای گزارش‌ها و فیلترهای انبار
CREATE INDEX "inventory_items_supplierId_idx" ON "inventory_items"("supplierId");

-- کلید خارجی به جدول suppliers — حذف تأمین‌کننده مقدار را خالی می‌کند (SET NULL)
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
