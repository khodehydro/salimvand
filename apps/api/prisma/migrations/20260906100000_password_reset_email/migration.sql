ALTER TABLE "users" ADD COLUMN "email" VARCHAR(255);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE TABLE "password_reset_tokens" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" VARCHAR(128) NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "usedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "password_reset_tokens_tokenHash_key" UNIQUE ("tokenHash"),
  CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "password_reset_tokens_userId_expiresAt_idx" ON "password_reset_tokens"("userId", "expiresAt");
