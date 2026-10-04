-- Site analytics: one row per public page view / product view / search.
CREATE TABLE "page_visits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" VARCHAR(20) NOT NULL,
    "path" VARCHAR(300) NOT NULL,
    "term" VARCHAR(200),
    "productId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_visits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "page_visits_createdAt_idx" ON "page_visits"("createdAt");
CREATE INDEX "page_visits_kind_createdAt_idx" ON "page_visits"("kind", "createdAt");
CREATE INDEX "page_visits_productId_createdAt_idx" ON "page_visits"("productId", "createdAt");

ALTER TABLE "page_visits" ADD CONSTRAINT "page_visits_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
