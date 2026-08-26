#!/usr/bin/env bash
set -Eeuo pipefail

# One-shot, repeatable production release. Run as root on the VPS after .env is configured.
ROOT_DIR="${APP_DIR:-/opt/salimvand}"
BRANCH="${DEPLOY_BRANCH:-arena/01a038b2-salimvand}"
LOCK_FILE=/var/lock/salimvand-deploy.lock
exec 9>"$LOCK_FILE"
flock -n 9 || { echo 'Another deployment is already running.' >&2; exit 1; }

cd "$ROOT_DIR"
[[ -f .env ]] || { echo "Missing $ROOT_DIR/.env; refusing to deploy." >&2; exit 1; }
command -v corepack >/dev/null || { echo 'Node.js/corepack is required.' >&2; exit 1; }
command -v pg_isready >/dev/null || { echo 'PostgreSQL client is required.' >&2; exit 1; }

export NODE_ENV=production
export TZ=UTC

echo "Fetching $BRANCH..."
git fetch --prune origin "$BRANCH"
git checkout --detach "origin/$BRANCH"
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @salimvand/api exec prisma generate
corepack pnpm --filter @salimvand/api exec prisma migrate deploy
corepack pnpm --filter @salimvand/api prisma:seed
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build

install -d -o salimvand -g salimvand "$ROOT_DIR/uploads/products"
systemctl daemon-reload
systemctl enable --now salimvand-api.service salimvand-website.service salimvand-worker.service
systemctl restart salimvand-api.service salimvand-website.service salimvand-worker.service

curl --fail --silent --show-error --retry 10 --retry-delay 2 http://127.0.0.1:4000/api/v1/health/ready >/dev/null
echo "Release $(git rev-parse --short HEAD) is live."
