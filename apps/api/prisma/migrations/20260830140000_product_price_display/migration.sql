-- Storefront price visibility per product: 'inherit' (default, follows the
-- site-wide store.pricing setting), 'show' and 'hide' override it per product.
ALTER TABLE "products" ADD COLUMN "price_display" VARCHAR(10) NOT NULL DEFAULT 'inherit';
