#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yml}"
API_URL="${API_URL:-http://localhost:4000}"

command -v docker >/dev/null || { echo 'Docker is required.' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Docker daemon is not running.' >&2; exit 1; }

docker compose -f "$COMPOSE_FILE" ps --status running postgres redis | grep -q postgres || { echo 'PostgreSQL container is not running.' >&2; exit 1; }
docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U parts_store -d parts_store >/dev/null
docker compose -f "$COMPOSE_FILE" exec -T redis redis-cli -a redis_dev --no-auth-warning ping | grep -q PONG
curl --fail --silent --show-error "$API_URL/api/v1/health" >/dev/null

echo 'Local dependencies and API health check passed.'
