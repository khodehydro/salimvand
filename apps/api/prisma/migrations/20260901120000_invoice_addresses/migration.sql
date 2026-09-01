-- Addresses on the invoice document: the store address is a snapshot from
-- settings at issue time and the customer address is typed (or prefilled from
-- the customer record) so it can be printed and shown on the public invoice.
ALTER TABLE "invoices" ADD COLUMN "storeAddress" TEXT;
ALTER TABLE "invoices" ADD COLUMN "customerAddress" TEXT;
-- Saved customer address so the issue form can prefill it on the next invoice.
ALTER TABLE "customers" ADD COLUMN "address" TEXT;
