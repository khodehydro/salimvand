CREATE TYPE "PurchaseStatus" AS ENUM ('issued', 'voided');
CREATE TABLE "purchase_invoices" (
  "id" UUID NOT NULL,
  "number" VARCHAR(30) NOT NULL,
  "supplierId" UUID NOT NULL,
  "supplierName" VARCHAR(150) NOT NULL,
  "subtotal" BIGINT NOT NULL DEFAULT 0,
  "total" BIGINT NOT NULL DEFAULT 0,
  "paidAmount" BIGINT NOT NULL DEFAULT 0,
  "status" "PurchaseStatus" NOT NULL DEFAULT 'issued',
  "issuedById" UUID NOT NULL,
  "issuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_invoices_number_key" UNIQUE ("number"),
  CONSTRAINT "purchase_invoices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id"),
  CONSTRAINT "purchase_invoices_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id")
);
CREATE INDEX "purchase_invoices_supplierId_issuedAt_idx" ON "purchase_invoices"("supplierId", "issuedAt");
CREATE TABLE "purchase_invoice_items" (
  "id" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "inventoryItemId" UUID NOT NULL,
  "productName" VARCHAR(200) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPrice" BIGINT NOT NULL,
  "lineTotal" BIGINT NOT NULL,
  CONSTRAINT "purchase_invoice_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "purchase_invoices"("id"),
  CONSTRAINT "purchase_invoice_items_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id")
);
CREATE INDEX "purchase_invoice_items_invoiceId_idx" ON "purchase_invoice_items"("invoiceId");
