CREATE TABLE "supplier_payments" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "amount" BIGINT NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "notes" TEXT,
  "paidAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedById" UUID NOT NULL,
  CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id"),
  CONSTRAINT "supplier_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "purchase_invoices"("id"),
  CONSTRAINT "supplier_payments_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id")
);
CREATE INDEX "supplier_payments_supplierId_paidAt_idx" ON "supplier_payments"("supplierId", "paidAt");
CREATE INDEX "supplier_payments_invoiceId_paidAt_idx" ON "supplier_payments"("invoiceId", "paidAt");
