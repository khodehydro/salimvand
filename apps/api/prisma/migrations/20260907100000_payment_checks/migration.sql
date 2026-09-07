CREATE TABLE "payment_checks" (
  "id" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "checkNumber" VARCHAR(80),
  "bank" VARCHAR(120),
  "branch" VARCHAR(120),
  "amount" BIGINT NOT NULL,
  "dueDate" DATE NOT NULL,
  CONSTRAINT "payment_checks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_checks_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "payment_checks_dueDate_idx" ON "payment_checks"("dueDate");