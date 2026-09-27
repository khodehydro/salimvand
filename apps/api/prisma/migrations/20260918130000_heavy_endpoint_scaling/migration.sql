-- Scaling for large archives and customer search (Android agent's server brief).

-- 1) Cursor-paginated invoice archive: the keyset predicate
--    (issuedAt, id) < (cursor) with ORDER BY issuedAt DESC, id DESC.
--    The existing [status, issuedAt] index only helps status-filtered scans.
CREATE INDEX "invoices_issuedAt_id_idx" ON "invoices"("issuedAt", "id");

-- 2) Customer picker search uses ILIKE '%…%', which a B-tree cannot serve.
--    pg_trgm GIN indexes make it index-backed. The whole block degrades
--    gracefully to the previous seq scan when the extension cannot be
--    installed (non-superuser deploy on PostgreSQL < 13), so this migration
--    can never break `prisma migrate deploy`.
--    NOTE: these GIN indexes are intentionally NOT in schema.prisma —
--    Prisma has no trigram/GIN support; treat them as DB-only extras.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS "customers_name_trgm_idx"
    ON "customers" USING gin ("name" gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS "customers_mobile_trgm_idx"
    ON "customers" USING gin ("mobile" gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm GIN indexes skipped: %', SQLERRM;
END
$$;
