#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not available. Connect a PostgreSQL and Redis server, then set DATABASE_URL and REDIS_URL in .env." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but the Docker service is not running." >&2
  exit 1
fi

corepack pnpm install --frozen-lockfile=true
cp -n .env.example .env || true
docker compose -f docker-compose.dev.yml up -d

until docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U parts_store -d parts_store >/dev/null 2>&1; do
  echo "Waiting for PostgreSQL..."
  sleep 2
done

corepack pnpm --filter @salimvand/api exec prisma generate
corepack pnpm --filter @salimvand/api exec prisma migrate dev --name init
corepack pnpm --filter @salimvand/api prisma:seed

echo "Local services are ready. Run: corepack pnpm dev"
