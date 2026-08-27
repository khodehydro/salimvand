#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yml}"
API_URL="${API_URL:-http://localhost:4000}"

command -v docker >/dev/null || { echo 'Docker is required.' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Docker daemon is not running.' >&2; exit 1; }

command -v curl >/dev/null || { echo 'curl is required.' >&2; exit 1; }
docker compose -f "$COMPOSE_FILE" ps --status running postgres | grep -q postgres || { echo 'PostgreSQL container is not running.' >&2; exit 1; }
docker compose -f "$COMPOSE_FILE" ps --status running redis | grep -q redis || { echo 'Redis container is not running.' >&2; exit 1; }
docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U parts_store -d parts_store >/dev/null || { echo 'PostgreSQL is not ready.' >&2; exit 1; }
docker compose -f "$COMPOSE_FILE" exec -T redis redis-cli -a redis_dev --no-auth-warning ping | grep -q PONG || { echo 'Redis is not ready.' >&2; exit 1; }
curl --fail --silent --show-error "$API_URL/api/v1/health" >/dev/null || { echo 'API health endpoint failed.' >&2; exit 1; }
curl --fail --silent --show-error "$API_URL/api/v1/health/ready" >/dev/null || { echo 'API readiness endpoint failed.' >&2; exit 1; }

echo 'Local PostgreSQL, Redis and API readiness checks passed.'
