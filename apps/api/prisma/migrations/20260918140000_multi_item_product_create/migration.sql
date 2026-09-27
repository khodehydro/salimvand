-- Multi-brand product.create: one operation can now create several inventory
-- lines (one per brand), so inventory_operations no longer has a globally
-- unique operationId. Idempotency stays exact per (operationId, itemId) —
-- a replay never duplicates a line it already created.
-- Prisma declares column uniques as a plain UNIQUE INDEX (not a table
-- constraint), so both drop forms are attempted; exactly one applies.
ALTER TABLE "inventory_operations" DROP CONSTRAINT IF EXISTS "inventory_operations_operationId_key";
DROP INDEX IF EXISTS "inventory_operations_operationId_key";

CREATE UNIQUE INDEX "inventory_operations_operationId_itemId_key"
  ON "inventory_operations"("operationId", "itemId");

CREATE INDEX "inventory_operations_operationId_idx" ON "inventory_operations"("operationId");
