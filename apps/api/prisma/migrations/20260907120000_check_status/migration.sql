CREATE TYPE "CheckStatus" AS ENUM ('pending', 'cleared', 'bounced', 'cancelled');
ALTER TABLE "payment_checks" ADD COLUMN "status" "CheckStatus" NOT NULL DEFAULT 'pending';
ALTER TABLE "payment_checks" ADD COLUMN "clearedAt" TIMESTAMPTZ;
ALTER TABLE "payment_checks" ADD COLUMN "bouncedAt" TIMESTAMPTZ;
ALTER TABLE "payment_checks" ADD COLUMN "notes" TEXT;
CREATE INDEX "payment_checks_status_idx" ON "payment_checks"("status");