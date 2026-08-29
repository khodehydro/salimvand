CREATE TABLE "returns" (
  "id" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "invoiceItemId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "refundAmount" BIGINT NOT NULL,
  "reason" VARCHAR(255) NOT NULL,
  "restock" BOOLEAN NOT NULL DEFAULT true,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "returns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "returns_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "returns_invoiceItemId_fkey" FOREIGN KEY ("invoiceItemId") REFERENCES "invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "returns_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "returns_invoiceId_idx" ON "returns"("invoiceId");
