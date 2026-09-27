CREATE TYPE "SyncOperationStatus" AS ENUM ('pending', 'applied', 'conflict', 'failed');

CREATE TABLE "sync_devices" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "deviceId" VARCHAR(100) NOT NULL,
  "name" VARCHAR(120),
  "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sync_devices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sync_devices_userId_deviceId_key" ON "sync_devices"("userId", "deviceId");
CREATE INDEX "sync_devices_userId_lastSeenAt_idx" ON "sync_devices"("userId", "lastSeenAt");
ALTER TABLE "sync_devices" ADD CONSTRAINT "sync_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sync_operations" (
  "id" UUID NOT NULL,
  "operationId" VARCHAR(100) NOT NULL,
  "deviceId" VARCHAR(100) NOT NULL,
  "userId" UUID NOT NULL,
  "type" VARCHAR(80) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "SyncOperationStatus" NOT NULL DEFAULT 'pending',
  "result" JSONB,
  "error" VARCHAR(500),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" TIMESTAMPTZ(6),
  CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sync_operations_operationId_key" ON "sync_operations"("operationId");
CREATE INDEX "sync_operations_userId_status_createdAt_idx" ON "sync_operations"("userId", "status", "createdAt");
CREATE INDEX "sync_operations_deviceId_createdAt_idx" ON "sync_operations"("deviceId", "createdAt");
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sync_changes" (
  "revision" BIGSERIAL NOT NULL,
  "entityType" VARCHAR(60) NOT NULL,
  "entityId" VARCHAR(100) NOT NULL,
  "action" VARCHAR(30) NOT NULL,
  "payload" JSONB,
  "operationId" VARCHAR(100),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sync_changes_pkey" PRIMARY KEY ("revision")
);
CREATE INDEX "sync_changes_createdAt_idx" ON "sync_changes"("createdAt");
CREATE INDEX "sync_changes_entityType_entityId_revision_idx" ON "sync_changes"("entityType", "entityId", "revision");
