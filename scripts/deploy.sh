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
# Load production values for Prisma seed, migration and build-time tooling.
set -a
. "$ROOT_DIR/.env"
set +a
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

# Next standalone is nested because this is a workspace monorepo. Copy runtime assets
# beside the standalone server as required by Next.js production output.
STANDALONE="$ROOT_DIR/apps/website/.next/standalone"
if [[ -d "$ROOT_DIR/apps/website/.next/static" ]]; then
  install -d "$STANDALONE/apps/website/.next"
  rm -rf "$STANDALONE/apps/website/.next/static"
  cp -a "$ROOT_DIR/apps/website/.next/static" "$STANDALONE/apps/website/.next/static"
fi
if [[ -d "$ROOT_DIR/apps/website/public" ]]; then
  rm -rf "$STANDALONE/public"
  cp -a "$ROOT_DIR/apps/website/public" "$STANDALONE/public"
fi
chown -R salimvand:salimvand "$STANDALONE"

install -d -o salimvand -g salimvand "$ROOT_DIR/uploads/products"
install -m 0644 deploy/systemd/salimvand-api.service /etc/systemd/system/salimvand-api.service
install -m 0644 deploy/systemd/salimvand-website.service /etc/systemd/system/salimvand-website.service
install -m 0644 deploy/systemd/salimvand-worker.service /etc/systemd/system/salimvand-worker.service
systemctl daemon-reload
systemctl enable --now salimvand-api.service salimvand-website.service salimvand-worker.service
systemctl restart salimvand-api.service salimvand-website.service salimvand-worker.service

for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error http://127.0.0.1:4000/api/v1/health/ready >/dev/null; then
    echo "Release $(git rev-parse --short HEAD) is live."
    exit 0
  fi
  sleep 2
done
echo 'API did not become ready within 60 seconds.' >&2
systemctl status salimvand-api.service --no-pager -l >&2 || true
exit 1
