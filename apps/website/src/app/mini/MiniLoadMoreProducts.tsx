'use client';
import { CatalogProducts, type CatalogProductsProps } from '../CatalogProducts';
import { MiniProductCard } from './MiniProductCard';

/** Next links + host SDK code stay out of the regular storefront bundle. */
export function MiniLoadMoreProducts({
  productPath,
  ...props
}: Omit<CatalogProductsProps, 'renderProduct'> & { productPath: string }) {
  return (
    <CatalogProducts
      {...props}
      spaReturn
      renderProduct={(product) => (
        <MiniProductCard key={product.slug} product={product} productPath={productPath} />
      )}
    />
  );
}
