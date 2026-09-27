ALTER TABLE "inventory_transactions" ADD COLUMN "operationId" VARCHAR(100);
CREATE UNIQUE INDEX "inventory_transactions_operationId_key" ON "inventory_transactions"("operationId");
