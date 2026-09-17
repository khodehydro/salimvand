-- Idempotency ledger for offline inventory metadata operations, mirroring
-- product_operations. Stock quantities stay protected by the unique
-- operationId on inventory_transactions.
CREATE TABLE "inventory_operations" ("id" UUID NOT NULL, "operationId" VARCHAR(100) NOT NULL, "itemId" UUID NOT NULL, "type" VARCHAR(40) NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "inventory_operations_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "inventory_operations_operationId_key" ON "inventory_operations"("operationId");
CREATE INDEX "inventory_operations_itemId_idx" ON "inventory_operations"("itemId");
