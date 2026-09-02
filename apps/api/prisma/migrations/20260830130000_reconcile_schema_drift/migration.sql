-- Reconcile the hand-written migration DDL with schema.prisma.
--
-- The earlier migrations were written with snake_case settings columns
-- (updated_at / updated_by_id) while the Setting model expects camelCase
-- (updatedAt / updatedById), so every prisma.setting query failed with
-- P2022 "The column `updatedAt` does not exist in the current database" —
-- including prisma:seed, which aborted every deploy before the build step.
-- The purchase/supplier foreign keys were also created with different
-- ON DELETE rules than the schema declares, and a few stray DB defaults
-- plus invoices_publicTokenExpiresAt_idx are not part of the schema.
--
-- Verified against a database built from migrations up to
-- 20260827150000_system_tables (both a fresh database and the production
-- VPS): every dropped object below is created by an earlier migration.

ALTER TABLE "purchase_invoice_items" DROP CONSTRAINT "purchase_invoice_items_inventoryItemId_fkey";

ALTER TABLE "purchase_invoice_items" DROP CONSTRAINT "purchase_invoice_items_invoiceId_fkey";

ALTER TABLE "purchase_invoices" DROP CONSTRAINT "purchase_invoices_issuedById_fkey";

ALTER TABLE "purchase_invoices" DROP CONSTRAINT "purchase_invoices_supplierId_fkey";

ALTER TABLE "settings" DROP CONSTRAINT "settings_updated_by_id_fkey";

ALTER TABLE "supplier_payments" DROP CONSTRAINT "supplier_payments_invoiceId_fkey";

ALTER TABLE "supplier_payments" DROP CONSTRAINT "supplier_payments_receivedById_fkey";

ALTER TABLE "supplier_payments" DROP CONSTRAINT "supplier_payments_supplierId_fkey";

DROP INDEX "invoices_publicTokenExpiresAt_idx";

DROP INDEX "settings_updated_by_id_idx";

-- gen_random_uuid()/now() defaults live in the client (Prisma supplies ids
-- and updatedAt itself), not in the database.
ALTER TABLE "customers" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "payments" ALTER COLUMN "id" DROP DEFAULT;

ALTER TABLE "settings" DROP COLUMN "updated_at";
ALTER TABLE "settings" DROP COLUMN "updated_by_id";

ALTER TABLE "settings" ADD COLUMN "updatedAt" TIMESTAMPTZ(6);
UPDATE "settings" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL;
ALTER TABLE "settings" ALTER COLUMN "updatedAt" SET NOT NULL;

ALTER TABLE "settings" ADD COLUMN "updatedById" UUID;

ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "settings" ADD CONSTRAINT "settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
