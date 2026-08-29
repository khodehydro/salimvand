-- Public invoice links are intentionally short-lived. Existing invoices remain readable
-- until they are re-issued with an expiry because this column is nullable for migration safety.
ALTER TABLE "invoices" ADD COLUMN "publicTokenExpiresAt" TIMESTAMPTZ(6);
CREATE INDEX "invoices_publicTokenExpiresAt_idx" ON "invoices"("publicTokenExpiresAt");
