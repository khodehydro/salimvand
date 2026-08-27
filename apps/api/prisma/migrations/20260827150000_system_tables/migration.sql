-- System tables required by the architecture doc §3.6 and §3.7:
-- customer vehicles, SMS log, Telegram/Bale log and backup job history.
CREATE TYPE "SmsStatus" AS ENUM ('queued', 'sent', 'failed');

CREATE TABLE "customer_vehicles" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "trimId" UUID,
    "plate" VARCHAR(20),
    "chassis" VARCHAR(40),
    "year" INTEGER,
    "notes" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_vehicles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sms_logs" (
    "id" BIGSERIAL NOT NULL,
    "mobile" VARCHAR(20) NOT NULL,
    "template" VARCHAR(60) NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "status" "SmsStatus" NOT NULL DEFAULT 'queued',
    "provider" VARCHAR(40),
    "providerRef" VARCHAR(120),
    "error" VARCHAR(500),
    "refType" VARCHAR(40),
    "refId" UUID,
    "sentAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sms_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_logs" (
    "id" BIGSERIAL NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "chatId" VARCHAR(60) NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "status" "SmsStatus" NOT NULL DEFAULT 'queued',
    "error" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "backup_jobs" (
    "id" BIGSERIAL NOT NULL,
    "kind" VARCHAR(30) NOT NULL DEFAULT 'database',
    "status" VARCHAR(20) NOT NULL,
    "file" VARCHAR(255),
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "encrypted" BOOLEAN NOT NULL DEFAULT true,
    "destination" VARCHAR(60),
    "error" VARCHAR(500),
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(6),
    CONSTRAINT "backup_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_vehicles_customerId_trimId_plate_key" ON "customer_vehicles"("customerId", "trimId", "plate");
CREATE INDEX "customer_vehicles_customerId_idx" ON "customer_vehicles"("customerId");
CREATE INDEX "sms_logs_mobile_createdAt_idx" ON "sms_logs"("mobile", "createdAt");
CREATE INDEX "sms_logs_status_createdAt_idx" ON "sms_logs"("status", "createdAt");
CREATE INDEX "telegram_logs_channel_createdAt_idx" ON "telegram_logs"("channel", "createdAt");
CREATE INDEX "backup_jobs_startedAt_idx" ON "backup_jobs"("startedAt");

ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_trimId_fkey" FOREIGN KEY ("trimId") REFERENCES "vehicle_trims"("id") ON DELETE SET NULL ON UPDATE CASCADE;
