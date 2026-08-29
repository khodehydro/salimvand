ALTER TABLE "invoices" ADD COLUMN "publicShortCodeHash" VARCHAR(128);
CREATE UNIQUE INDEX "invoices_publicShortCodeHash_key" ON "invoices"("publicShortCodeHash");
