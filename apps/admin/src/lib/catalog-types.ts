/**
 * Shapes of the catalog/warehouse list payloads (`GET /products`,
 * `GET /inventory/items`). The unified «محصولات و انبار» list reads the
 * products endpoint, which already carries every stock line of a product
 * together with its brand, supplier, shelf (قفسه), basket (سبد), prices and
 * quantity — so one request can feed the whole table.
 */

export type InventoryLine = {
  id: string;
  barcode?: string | null;
  quantity: number;
  salePrice: string | number;
  purchasePrice?: string | number | null;
  minStock?: number | null;
  isActive?: boolean;
  /** When the current sale price took effect (ISO) — the Shamsi price badge. */
  priceUpdatedAt?: string | null;
  brandId?: string | null;
  brand?: { id?: string; name: string } | null;
  supplierId?: string | null;
  supplier?: { id: string; name: string } | null;
  location?: {
    id?: string;
    code: string;
    name: string;
    parent?: { id?: string; name: string } | null;
  } | null;
  basket?: { id?: string; code: string; name?: string } | null;
};

export type ProductRow = {
  id: string;
  name: string;
  code: string;
  slug: string;
  status: string;
  deletedAt?: string | null;
  partNumber?: string | null;
  seoKeywords?: string[];
  createdAt?: string;
  category?: { id?: string; name: string } | null;
  supplier?: { id: string; name: string } | null;
  compatibilities?: Array<{ model: { name: string; make: { name: string } } }>;
  images?: Array<{ path: string; alt?: string | null; isPrimary?: boolean }>;
  inventoryItems?: InventoryLine[];
};

export type ProductDetail = {
  id: string;
  name: string;
  code: string;
  slug: string;
  status: string;
  /** Storefront price visibility: 'inherit' follows the site-wide switch. */
  priceDisplay?: string;
  description?: string | null;
  partNumber?: string | null;
  supplierId?: string | null;
  supplier?: { id: string; name: string } | null;
  aparatVideoId?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoKeywords?: string[];
  /** Optimistic shell built from the list row before the detail GET lands. */
  partial?: boolean;
  category?: { id: string; name: string };
  images?: Array<{
    id: string;
    path: string;
    alt?: string | null;
    isPrimary: boolean;
    sort: number;
  }>;
  compatibilities?: Array<{
    id: string;
    model: { id: string; name: string; make: { id: string; name: string } };
    trim?: { id: string; name: string } | null;
  }>;
  inventoryItems?: Array<{
    id: string;
    barcode: string;
    quantity: number;
    salePrice: string;
    purchasePrice: string;
    minStock?: number | null;
    isActive: boolean;
    priceUpdatedAt?: string | null;
    brandId?: string | null;
    brand?: { id: string; name: string } | null;
    supplierId?: string | null;
    supplier?: { id: string; name: string } | null;
    location?: { id: string; code: string; name: string } | null;
    /** سبد — the basket of this line inside its shelf. */
    basket?: { id: string; code: string; name: string } | null;
  }>;
};

export type Category = { id: string; name: string };
export type Brand = { id: string; name: string };
export type Supplier = { id: string; name: string };
export type Location = {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId?: string | null;
  parent?: { id: string; name: string } | null;
  children?: Array<Location & { _count?: { items: number; basketItems?: number } }>;
  _count?: { items: number; basketItems?: number };
};
export type VehicleMake = {
  id: string;
  name: string;
  models: Array<{ id: string; name: string; trims: Array<{ id: string; name: string }> }>;
};
