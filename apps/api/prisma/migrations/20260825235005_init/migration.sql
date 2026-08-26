-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('active', 'hidden');

-- CreateEnum
CREATE TYPE "AvailabilityOverride" AS ENUM ('coming_soon', 'discontinued');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('warehouse', 'aisle', 'shelf', 'level', 'box');

-- CreateEnum
CREATE TYPE "InventoryTransactionType" AS ENUM ('initial', 'purchase', 'sale', 'return', 'adjustment', 'transfer');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('issued', 'voided');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('paid', 'partial', 'unpaid');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'card', 'transfer', 'credit');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'manager', 'seller', 'warehouse', 'accountant');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('create', 'update', 'delete', 'restore', 'adjust', 'issue', 'void', 'pay', 'return', 'login');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "slug" VARCHAR(220) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "categoryId" UUID NOT NULL,
    "description" TEXT,
    "specs" JSONB,
    "partNumber" VARCHAR(60),
    "aparatVideoId" VARCHAR(30),
    "status" "ProductStatus" NOT NULL DEFAULT 'active',
    "availabilityOverride" "AvailabilityOverride",
    "seoTitle" VARCHAR(255),
    "seoDescription" VARCHAR(320),
    "seoKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "path" VARCHAR(255) NOT NULL,
    "alt" VARCHAR(255),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_makes" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "vehicle_makes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_models" (
    "id" UUID NOT NULL,
    "makeId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "productionFrom" INTEGER,
    "productionTo" INTEGER,

    CONSTRAINT "vehicle_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_trims" (
    "id" UUID NOT NULL,
    "modelId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "vehicle_trims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_vehicle_compat" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "modelId" UUID NOT NULL,
    "trimId" UUID,

    CONSTRAINT "product_vehicle_compat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "type" "LocationType" NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "barcode" VARCHAR(20) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "purchasePrice" BIGINT NOT NULL DEFAULT 0,
    "salePrice" BIGINT NOT NULL DEFAULT 0,
    "minStock" INTEGER,
    "locationId" UUID,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" BIGSERIAL NOT NULL,
    "itemId" UUID NOT NULL,
    "type" "InventoryTransactionType" NOT NULL,
    "quantityChange" INTEGER NOT NULL,
    "quantityAfter" INTEGER NOT NULL,
    "refType" VARCHAR(30),
    "refId" UUID,
    "reason" VARCHAR(255),
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "mobile" VARCHAR(20),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counters" (
    "key" VARCHAR(100) NOT NULL,
    "lastValue" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "publicTokenHash" VARCHAR(128) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'issued',
    "customerName" VARCHAR(150),
    "customerMobile" VARCHAR(20),
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "discount" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "issuedById" UUID NOT NULL,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMPTZ(6),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "productName" VARCHAR(200) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "lineTotal" BIGINT NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdByIp" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "userId" UUID,
    "action" VARCHAR(60) NOT NULL,
    "entityType" VARCHAR(60) NOT NULL,
    "entityId" UUID,
    "before" JSONB,
    "after" JSONB,
    "ip" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "categories_code_key" ON "categories"("code");

-- CreateIndex
CREATE INDEX "categories_parentId_isActive_idx" ON "categories"("parentId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_categoryId_deletedAt_idx" ON "products"("categoryId", "deletedAt");

-- CreateIndex
CREATE INDEX "products_partNumber_idx" ON "products"("partNumber");

-- CreateIndex
CREATE INDEX "product_images_productId_sort_idx" ON "product_images"("productId", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_makes_name_key" ON "vehicle_makes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_models_makeId_name_key" ON "vehicle_models"("makeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_trims_modelId_name_key" ON "vehicle_trims"("modelId", "name");

-- CreateIndex
CREATE INDEX "product_vehicle_compat_modelId_trimId_idx" ON "product_vehicle_compat"("modelId", "trimId");

-- CreateIndex
CREATE UNIQUE INDEX "product_vehicle_compat_productId_modelId_trimId_key" ON "product_vehicle_compat"("productId", "modelId", "trimId");

-- CreateIndex
CREATE UNIQUE INDEX "locations_parentId_code_key" ON "locations"("parentId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_barcode_key" ON "inventory_items"("barcode");

-- CreateIndex
CREATE INDEX "inventory_items_productId_idx" ON "inventory_items"("productId");

-- CreateIndex
CREATE INDEX "inventory_items_locationId_idx" ON "inventory_items"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_productId_brandId_key" ON "inventory_items"("productId", "brandId");

-- CreateIndex
CREATE INDEX "inventory_transactions_itemId_createdAt_idx" ON "inventory_transactions"("itemId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_publicTokenHash_key" ON "invoices"("publicTokenHash");

-- CreateIndex
CREATE INDEX "invoices_status_issuedAt_idx" ON "invoices"("status", "issuedAt");

-- CreateIndex
CREATE INDEX "invoice_items_invoiceId_idx" ON "invoice_items"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_revokedAt_idx" ON "refresh_tokens"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_models" ADD CONSTRAINT "vehicle_models_makeId_fkey" FOREIGN KEY ("makeId") REFERENCES "vehicle_makes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_trims" ADD CONSTRAINT "vehicle_trims_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "vehicle_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_vehicle_compat" ADD CONSTRAINT "product_vehicle_compat_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_vehicle_compat" ADD CONSTRAINT "product_vehicle_compat_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "vehicle_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_vehicle_compat" ADD CONSTRAINT "product_vehicle_compat_trimId_fkey" FOREIGN KEY ("trimId") REFERENCES "vehicle_trims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
