-- Add payment lifecycle fields for operational invoices
ALTER TABLE "invoices" ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'unpaid';
ALTER TABLE "invoices" ADD COLUMN "paymentMethod" "PaymentMethod";
ALTER TABLE "invoices" ADD COLUMN "paidAmount" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "paidAt" TIMESTAMPTZ(6);
