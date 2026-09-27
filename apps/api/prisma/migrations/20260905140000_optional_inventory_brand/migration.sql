-- Some products are generic or single-brand and do not need a brand label.
ALTER TABLE "inventory_items" ALTER COLUMN "brandId" DROP NOT NULL;
