CREATE TABLE "suppliers" (
  "id" UUID NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "mobile" VARCHAR(20),
  "phone" VARCHAR(30),
  "address" TEXT,
  "taxId" VARCHAR(30),
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "suppliers_isActive_deletedAt_idx" ON "suppliers"("isActive", "deletedAt");
