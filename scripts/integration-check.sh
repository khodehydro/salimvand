#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yml}"
API_PORT="${API_PORT:-4000}"
API_LOG="${TMPDIR:-/tmp}/salimvand-api-integration.log"
API_PID=""

cleanup() {
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  docker compose -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

command -v docker >/dev/null || { echo 'Docker is required for integration checks.' >&2; exit 1; }
command -v curl >/dev/null || { echo 'curl is required for integration checks.' >&2; exit 1; }

echo 'Starting PostgreSQL and Redis...'
docker compose -f "$COMPOSE_FILE" up -d --wait

export NODE_ENV=test
export TZ=UTC
export DATABASE_URL="${DATABASE_URL:-postgresql://parts_store:parts_store_dev@localhost:5432/parts_store}"
export REDIS_URL="${REDIS_URL:-redis://:redis_dev@localhost:6379}"
export API_HOST="${API_HOST:-127.0.0.1}"
export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-integration-access-secret-012345678901234567890123}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-integration-refresh-secret-012345678901234567890123}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:3000}"

pnpm --filter @salimvand/api prisma:generate
pnpm --filter @salimvand/api exec prisma migrate deploy
pnpm --filter @salimvand/api prisma:seed
pnpm --filter @salimvand/api dev >"$API_LOG" 2>&1 &
API_PID=$!

for attempt in {1..30}; do
  if curl --fail --silent "http://127.0.0.1:${API_PORT}/api/v1/health/ready" >/dev/null; then
    echo 'Integration checks passed: PostgreSQL, Redis, migrations and API readiness.'
    exit 0
  fi
  sleep 1
done

echo 'API readiness check failed.' >&2
cat "$API_LOG" >&2
exit 1
