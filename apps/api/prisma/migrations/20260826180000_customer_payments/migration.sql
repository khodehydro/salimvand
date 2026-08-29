CREATE TABLE "customer_payments" (
  "id" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "invoiceId" UUID,
  "amount" BIGINT NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "notes" TEXT,
  "receivedById" UUID NOT NULL,
  "paidAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "customer_payments_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "customer_payments_customerId_paidAt_idx" ON "customer_payments"("customerId", "paidAt");
