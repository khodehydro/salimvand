CREATE TABLE "product_operations" ("id" UUID NOT NULL, "operationId" VARCHAR(100) NOT NULL, "productId" UUID NOT NULL, "type" VARCHAR(40) NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "product_operations_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "product_operations_operationId_key" ON "product_operations"("operationId");
CREATE INDEX "product_operations_productId_idx" ON "product_operations"("productId");
