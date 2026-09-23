-- AlterTable: add discountPercent to invoices
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "discountPercent" INTEGER NOT NULL DEFAULT 0;
