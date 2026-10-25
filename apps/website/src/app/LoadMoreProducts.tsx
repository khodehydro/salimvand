'use client';

import { CatalogProducts, type CatalogProductsProps } from './CatalogProducts';
import { ProductCard, type CardContact } from './ProductCard';

/** Storefront view over the shared bounded pagination / return-state engine. */
export function LoadMoreProducts({
  contact,
  heading = 'h3',
  ...props
}: Omit<CatalogProductsProps, 'renderProduct'> & {
  contact?: CardContact;
  heading?: 'h2' | 'h3';
}) {
  return (
    <CatalogProducts
      {...props}
      renderProduct={(product) => (
        <ProductCard key={product.slug} product={product} heading={heading} contact={contact} />
      )}
    />
  );
}
