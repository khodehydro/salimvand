CREATE TABLE "settings" (
  "key" VARCHAR(100) NOT NULL,
  "value" JSONB NOT NULL,
  "updated_by_id" UUID,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "settings_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "settings_updated_by_id_idx" ON "settings"("updated_by_id");
