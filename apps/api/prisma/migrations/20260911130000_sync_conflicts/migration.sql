CREATE TYPE "SyncConflictStatus" AS ENUM ('open', 'resolved');
CREATE TABLE "sync_conflicts" (
  "id" UUID NOT NULL, "operationId" VARCHAR(100) NOT NULL, "userId" UUID NOT NULL,
  "deviceId" VARCHAR(100) NOT NULL, "type" VARCHAR(80) NOT NULL, "code" VARCHAR(80) NOT NULL,
  "payload" JSONB NOT NULL, "serverState" JSONB, "status" "SyncConflictStatus" NOT NULL DEFAULT 'open',
  "resolution" JSONB, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "resolvedAt" TIMESTAMPTZ(6),
  CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sync_conflicts_userId_status_createdAt_idx" ON "sync_conflicts"("userId", "status", "createdAt");
CREATE UNIQUE INDEX "sync_conflicts_operationId_status_key" ON "sync_conflicts"("operationId", "status");
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
