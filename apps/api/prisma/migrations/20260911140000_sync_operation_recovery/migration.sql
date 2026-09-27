ALTER TABLE "sync_operations" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sync_operations" ADD COLUMN "lastAttemptAt" TIMESTAMPTZ(6);
CREATE INDEX "sync_operations_status_lastAttemptAt_idx" ON "sync_operations"("status", "lastAttemptAt");
