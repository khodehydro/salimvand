ALTER TABLE "invoices" ADD COLUMN "operationId" VARCHAR(100);
CREATE UNIQUE INDEX "invoices_operationId_key" ON "invoices"("operationId");
ALTER TABLE "payments" ADD COLUMN "operationId" VARCHAR(100);
CREATE UNIQUE INDEX "payments_operationId_key" ON "payments"("operationId");
ALTER TABLE "purchase_invoices" ADD COLUMN "operationId" VARCHAR(100);
CREATE UNIQUE INDEX "purchase_invoices_operationId_key" ON "purchase_invoices"("operationId");
ALTER TABLE "supplier_payments" ADD COLUMN "operationId" VARCHAR(100);
CREATE UNIQUE INDEX "supplier_payments_operationId_key" ON "supplier_payments"("operationId");
