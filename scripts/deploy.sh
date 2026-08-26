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
if command -v corepack >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
elif command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
else
  echo 'pnpm or corepack is required.' >&2
  exit 1
fi
command -v pg_isready >/dev/null || { echo 'PostgreSQL client is required.' >&2; exit 1; }

export NODE_ENV=production
export TZ=UTC

echo "Fetching $BRANCH..."
git fetch --prune origin "$BRANCH"
git checkout --detach "origin/$BRANCH"
# Build, Prisma CLI and seed use devDependencies; production mode must not omit them.
"${PNPM[@]}" install --frozen-lockfile --prod=false
"${PNPM[@]}" --filter @salimvand/api exec prisma generate
"${PNPM[@]}" --filter @salimvand/api exec prisma migrate deploy
"${PNPM[@]}" --filter @salimvand/api prisma:seed
"${PNPM[@]}" typecheck
"${PNPM[@]}" test
"${PNPM[@]}" build

install -d -o salimvand -g salimvand "$ROOT_DIR/uploads/products"
install -m 0644 deploy/systemd/salimvand-api.service /etc/systemd/system/salimvand-api.service
install -m 0644 deploy/systemd/salimvand-website.service /etc/systemd/system/salimvand-website.service
install -m 0644 deploy/systemd/salimvand-worker.service /etc/systemd/system/salimvand-worker.service
systemctl daemon-reload
systemctl enable --now salimvand-api.service salimvand-website.service salimvand-worker.service
systemctl restart salimvand-api.service salimvand-website.service salimvand-worker.service

curl --fail --silent --show-error --retry 10 --retry-delay 2 http://127.0.0.1:4000/api/v1/health/ready >/dev/null
echo "Release $(git rev-parse --short HEAD) is live."
