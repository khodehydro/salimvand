-- Sale-price audit trail for inflation tracking: every actual salePrice change
-- writes one inventory_price_history row, and the item itself carries a
-- denormalized priceUpdatedAt for the light-weight badges (site, panel, app).
CREATE TABLE "inventory_price_history" ("id" BIGSERIAL NOT NULL, "itemId" UUID NOT NULL, "oldSalePrice" BIGINT, "newSalePrice" BIGINT NOT NULL, "userId" UUID, "source" VARCHAR(30) NOT NULL DEFAULT 'panel', "operationId" VARCHAR(100), "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "inventory_price_history_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "inventory_price_history_operationId_key" ON "inventory_price_history"("operationId");
CREATE INDEX "inventory_price_history_itemId_createdAt_idx" ON "inventory_price_history"("itemId", "createdAt" DESC);
ALTER TABLE "inventory_price_history" ADD CONSTRAINT "inventory_price_history_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_price_history" ADD CONSTRAINT "inventory_price_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_items" ADD COLUMN "priceUpdatedAt" TIMESTAMPTZ(6);
