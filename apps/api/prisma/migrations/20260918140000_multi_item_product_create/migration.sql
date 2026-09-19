-- Multi-brand product.create: one operation can now create several inventory
-- lines (one per brand), so inventory_operations no longer has a globally
-- unique operationId. Idempotency stays exact per (operationId, itemId) —
-- a replay never duplicates a line it already created.
ALTER TABLE "inventory_operations" DROP CONSTRAINT "inventory_operations_operationId_key";

CREATE UNIQUE INDEX "inventory_operations_operationId_itemId_key"
  ON "inventory_operations"("operationId", "itemId");

CREATE INDEX "inventory_operations_operationId_idx" ON "inventory_operations"("operationId");
