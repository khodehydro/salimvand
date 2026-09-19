import type {
  Category,
  Brand,
  Location,
  Product,
  ProductImage,
  InventoryItem,
  Invoice,
  InvoiceItem,
  Customer,
} from '@prisma/client';
import { formatJalaliDate } from '@salimvand/shared';

/** Entities whose SyncChange rows carry a full rebuildable snapshot for the
 * offline clients. Everything else stays metadata-only invalidation. */
export const SYNC_PAYLOAD_ENTITY_TYPES = [
  'product',
  'inventory_item',
  'invoice',
  'customer',
  'brand',
  'category',
  'location',
] as const;

export type SyncPayloadEntityType = (typeof SYNC_PAYLOAD_ENTITY_TYPES)[number];

export const isSyncPayloadEntity = (entityType: string): entityType is SyncPayloadEntityType =>
  (SYNC_PAYLOAD_ENTITY_TYPES as readonly string[]).includes(entityType);

const publicSiteUrl = () =>
  (process.env.PUBLIC_SITE_URL ?? process.env.APP_URL ?? 'https://salimvand.ir').replace(/\/$/, '');

export const productImageUrl = (path: string) =>
  /^https?:\/\//i.test(path) ? path : `${publicSiteUrl()}${path}`;

/** Lists want the 400px variant the media service already generates next to
 * every large.webp upload (small.webp); remote https URLs have no variant
 * and are returned unchanged, and legacy paths simply keep their path. */
export const productThumbUrl = (path: string) =>
  /^https?:\/\//i.test(path)
    ? path
    : `${publicSiteUrl()}${path.replace(/\/large\.webp$/, '/small.webp')}`;

/** Mirrors the product shape of GET /sync/bootstrap so a pulled change can be
 * upserted into the Android cache without any shape translation. */
export function buildProductSyncPayload(
  product: Pick<
    Product,
    | 'id'
    | 'code'
    | 'slug'
    | 'name'
    | 'categoryId'
    | 'status'
    | 'availabilityOverride'
    | 'priceDisplay'
    | 'partNumber'
    | 'updatedAt'
  > & { description?: string | null },
  image?: Pick<ProductImage, 'id' | 'path' | 'alt'> | null,
) {
  return {
    id: product.id,
    code: product.code,
    slug: product.slug,
    name: product.name,
    categoryId: product.categoryId,
    partNumber: product.partNumber,
    description: product.description ?? null,
    status: product.status,
    availabilityOverride: product.availabilityOverride,
    priceDisplay: product.priceDisplay,
    updatedAt:
      product.updatedAt instanceof Date ? product.updatedAt.toISOString() : product.updatedAt,
    image: image ? { id: image.id, path: image.path, alt: image.alt } : null,
    imageUrl: image ? productImageUrl(image.path) : null,
    thumbUrl: image ? productThumbUrl(image.path) : null,
  };
}

/** Mirrors the inventory rows of GET /sync/bootstrap (plus isActive so a
 * pulled deactivation can be applied). Money stays string-exact in rials. */
export function buildInventoryItemSyncPayload(
  item: Pick<
    InventoryItem,
    | 'id'
    | 'productId'
    | 'brandId'
    | 'barcode'
    | 'quantity'
    | 'purchasePrice'
    | 'salePrice'
    | 'minStock'
    | 'locationId'
    | 'isActive'
  > & { priceUpdatedAt?: Date | null },
) {
  return {
    id: item.id,
    productId: item.productId,
    brandId: item.brandId,
    barcode: item.barcode,
    quantity: item.quantity,
    purchasePrice: money(item.purchasePrice),
    salePrice: money(item.salePrice),
    minStock: item.minStock,
    locationId: item.locationId,
    isActive: item.isActive,
    // When the current sale price took effect — the offline price badge.
    priceUpdatedAt: item.priceUpdatedAt instanceof Date ? item.priceUpdatedAt.toISOString() : null,
    priceUpdatedAtJalali: item.priceUpdatedAt ? formatJalaliDate(item.priceUpdatedAt) : null,
  };
}

/** String-exact money: missing fields fall back to 0 so a partial Prisma
 * select can never crash the audit path; real rows always carry the columns. */
const money = (value: unknown): string => {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return value;
  return '0';
};

/** Compact invoice snapshot for pull. Public token hashes are deliberately
 * excluded — the public link is only ever handed out through the panel or SMS. */
export function buildInvoiceSyncPayload(
  invoice: Pick<
    Invoice,
    | 'id'
    | 'number'
    | 'status'
    | 'customerId'
    | 'customerName'
    | 'customerMobile'
    | 'subtotal'
    | 'discount'
    | 'total'
    | 'paymentStatus'
    | 'paymentMethod'
    | 'paidAmount'
    | 'issuedAt'
    | 'paidAt'
    | 'voidedAt'
  >,
  items: ReadonlyArray<
    Pick<
      InvoiceItem,
      'id' | 'inventoryItemId' | 'productName' | 'quantity' | 'unitPrice' | 'lineTotal'
    >
  > = [],
) {
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    customerMobile: invoice.customerMobile,
    subtotal: money(invoice.subtotal),
    discount: money(invoice.discount),
    total: money(invoice.total),
    paymentStatus: invoice.paymentStatus,
    paymentMethod: invoice.paymentMethod,
    paidAmount: money(invoice.paidAmount),
    issuedAt: invoice.issuedAt instanceof Date ? invoice.issuedAt.toISOString() : invoice.issuedAt,
    paidAt: invoice.paidAt
      ? invoice.paidAt instanceof Date
        ? invoice.paidAt.toISOString()
        : invoice.paidAt
      : null,
    voidedAt: invoice.voidedAt
      ? invoice.voidedAt instanceof Date
        ? invoice.voidedAt.toISOString()
        : invoice.voidedAt
      : null,
    items: items.map((item) => ({
      id: item.id,
      inventoryItemId: item.inventoryItemId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: money(item.unitPrice),
      lineTotal: money(item.lineTotal),
    })),
  };
}

export function buildCustomerSyncPayload(
  customer: Pick<
    Customer,
    'id' | 'name' | 'mobile' | 'address' | 'notes' | 'isActive' | 'updatedAt'
  >,
) {
  return {
    id: customer.id,
    name: customer.name,
    mobile: customer.mobile,
    address: customer.address,
    notes: customer.notes,
    isActive: customer.isActive,
    updatedAt:
      customer.updatedAt instanceof Date ? customer.updatedAt.toISOString() : customer.updatedAt,
  };
}

export function buildBrandSyncPayload(brand: Pick<Brand, 'id' | 'name' | 'isActive'>) {
  return { id: brand.id, name: brand.name, isActive: brand.isActive };
}

export function buildCategorySyncPayload(
  category: Pick<Category, 'id' | 'parentId' | 'name' | 'slug' | 'code' | 'sort' | 'isActive'>,
) {
  return {
    id: category.id,
    parentId: category.parentId,
    name: category.name,
    slug: category.slug,
    code: category.code,
    sort: category.sort,
    isActive: category.isActive,
  };
}

export function buildLocationSyncPayload(
  location: Pick<Location, 'id' | 'parentId' | 'type' | 'code' | 'name'>,
) {
  return {
    id: location.id,
    parentId: location.parentId,
    type: location.type,
    code: location.code,
    name: location.name,
  };
}
