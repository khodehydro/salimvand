-- 20260830140000 created the new column as "price_display" (snake_case) while
-- the Prisma schema declares priceDisplay without @map, so the client — like
-- every other column in this database — expects a camelCase "priceDisplay".
-- Rename the column so database and client agree again.
ALTER TABLE "products" RENAME COLUMN "price_display" TO "priceDisplay";
