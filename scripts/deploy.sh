#!/usr/bin/env bash
set -Eeuo pipefail

# One-shot, repeatable production release. Run as root on the VPS after .env is configured.
ROOT_DIR="${APP_DIR:-/opt/salimvand}"
# Production deploys the reviewed main branch by default; override only for a planned release.
BRANCH="${DEPLOY_BRANCH:-main}"
LOCK_FILE=/var/lock/salimvand-deploy.lock
exec 9>"$LOCK_FILE"
flock -n 9 || { echo 'Another deployment is already running.' >&2; exit 1; }

cd "$ROOT_DIR"
[[ -f .env ]] || { echo "Missing $ROOT_DIR/.env; refusing to deploy." >&2; exit 1; }
# Load production values for Prisma seed, migration and build-time tooling.
set -a
. "$ROOT_DIR/.env"
set +a
# Minimal-PATH invocations (`sudo bash -c`, cron, plain ssh) must still find
# Node and pnpm: scan the usual install locations (nvm homes, distro and
# NodeSource prefixes, pnpm's own directory) before deciding they are missing.
if ! command -v node >/dev/null 2>&1 \
  || { ! command -v pnpm >/dev/null 2>&1 && ! command -v corepack >/dev/null 2>&1; }; then
  for _candidate in \
    "$HOME"/.nvm/versions/node/*/bin \
    /home/*/.nvm/versions/node/*/bin \
    /usr/local/bin \
    /usr/bin \
    /opt/node/bin \
    "$HOME"/.local/share/pnpm; do
    [[ -d "$_candidate" ]] && PATH="$_candidate:$PATH"
  done
  export PATH
fi
# nvm keeps corepack beside node; activate its shims so plain `pnpm` resolves.
if ! command -v pnpm >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  _node_dir="$(dirname "$(command -v node)")"
  [[ -x "$_node_dir/corepack" ]] && "$_node_dir/corepack" enable >/dev/null 2>&1 || true
fi
if command -v corepack >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
elif command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
elif command -v npm >/dev/null 2>&1; then
  # Node exists without corepack: install the pinned pnpm globally once.
  echo 'pnpm not found — installing pnpm@9.15.0 with npm...'
  npm install -g pnpm@9.15.0
  PNPM=(pnpm)
else
  echo 'Node.js 20+ (with npm, corepack or pnpm) is required on this server.' >&2
  echo 'See docs/server-verification.md for the approved install steps.' >&2
  exit 1
fi
command -v node >/dev/null 2>&1 || { echo 'Node.js 20+ is required (node not found in PATH).' >&2; exit 1; }
command -v pg_isready >/dev/null || { echo 'PostgreSQL client is required.' >&2; exit 1; }

export NODE_ENV=production
export TZ=UTC
bash "$ROOT_DIR/scripts/verify-production-config.sh"

echo "Fetching $BRANCH..."
git fetch --prune origin "$BRANCH"
git checkout --detach "origin/$BRANCH"
# Record the live release: the API exposes it on /health and the panel shows
# it in the sidebar so anyone can confirm the deploy actually landed.
printf '{"commit":"%s","branch":"%s","builtAt":"%s"}\n' \
  "$(git rev-parse HEAD)" "$BRANCH" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$ROOT_DIR/version.json"
chown salimvand:salimvand "$ROOT_DIR/version.json" 2>/dev/null || true
# Build, Prisma CLI and seed use devDependencies; production mode must not omit them.
"${PNPM[@]}" install --frozen-lockfile --prod=false
# prisma:seed imports @salimvand/shared, whose entry point is dist/ — build it
# before seeding so a fresh server never runs seed against a stale/missing dist.
"${PNPM[@]}" --filter @salimvand/shared build
"${PNPM[@]}" --filter @salimvand/api exec prisma generate
"${PNPM[@]}" --filter @salimvand/api exec prisma migrate deploy
"${PNPM[@]}" --filter @salimvand/api prisma:seed
if [[ "${SKIP_TYPECHECK:-0}" != "1" ]]; then
  "${PNPM[@]}" typecheck
fi
# Unit tests run in CI workflows and local development; skip during production VPS rollout by default for fast, reliable releases
if [[ "${RUN_TESTS:-0}" == "1" || "${SKIP_TESTS:-1}" == "0" ]]; then
  "${PNPM[@]}" test
fi
# The CMS and API are intentionally same-origin in production. Never allow a
# local/development VITE_API_URL from .env to be embedded in the browser bundle.
export VITE_API_URL=/api/v1
# Customer-facing links (invoice short links, QR codes) are built in the
# panel bundle and must point at the public storefront — never at the cms.*
# host the panel itself is served from. PUBLIC_SITE_URL comes from .env
# (verify-production-config.sh already requires it).
export VITE_PUBLIC_SITE_URL="${PUBLIC_SITE_URL:-https://salimvand.ir}"
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
install -d -o salimvand -g salimvand "$STANDALONE/apps/website/.next/cache"
chown -R salimvand:salimvand "$STANDALONE"

install -d -o salimvand -g salimvand "$ROOT_DIR/uploads/products"
install -d -o salimvand -g salimvand "$ROOT_DIR/uploads/site"
# Panel-triggered backups run as the salimvand service user (the API spawns
# scripts/backup.sh), so both the archive dir and the status dir must be
# writable by it — otherwise every run dies with "Permission denied".
install -d -o salimvand -g salimvand -m 0700 /var/backups/salimvand
install -d -o salimvand -g salimvand -m 0700 /var/lib/salimvand
# The CMS must serve uploaded media (/uploads) same-origin for the media
# library and settings previews. Never overwrite the live vhost — certbot
# edits it in place for TLS — only insert the location if it is missing.
NGINX_CONF=""
if [[ -f /etc/nginx/sites-available/salimvand.conf ]]; then
  NGINX_CONF=/etc/nginx/sites-available/salimvand.conf
elif [[ -f /etc/nginx/conf.d/salimvand.conf ]]; then
  NGINX_CONF=/etc/nginx/conf.d/salimvand.conf
fi
if [[ -n "$NGINX_CONF" ]] && grep -q 'server_name cms' "$NGINX_CONF" \
   && { ! grep -q 'location \^~ /uploads/' "$NGINX_CONF" \
       || ! grep -q 'location = /index.html' "$NGINX_CONF"; }; then
  python3 - "$NGINX_CONF" <<'NGINXPY'
import sys

path = sys.argv[1]
newline = chr(10)
raw = open(path).read()
lines = raw.split(newline)
block = []
if 'location ^~ /uploads/' not in raw:
    block += [
        '    # Uploaded media (product images, logo, favicon) served to the CMS.',
        '    location ^~ /uploads/ {',
        '        alias /opt/salimvand/uploads/;',
        '        expires 30d;',
        '        add_header Cache-Control "public, immutable";',
        '        try_files $uri =404;',
        '    }',
    ]
if 'location = /index.html' not in raw:
    block += [
        '    # Always revalidate the SPA shell so a new release is picked up.',
        '    location = /index.html {',
        '        add_header Cache-Control "no-cache";',
        '    }',
    ]
out = []
in_cms = False
has_api = False
inserted = False
for line in lines:
    if 'server_name cms' in line:
        in_cms = True
    if 'location /api/' in line:
        has_api = True
    if in_cms and line == '}':
        # Insert into the cms server block that actually proxies the API
        # (certbot may add a separate HTTP->HTTPS redirect block first).
        if has_api and not inserted:
            out.extend(block)
            inserted = True
        in_cms = False
        has_api = False
    out.append(line)
if inserted:
    open(path, 'w').write(chr(10).join(out))
    print('Patched the CMS vhost: /uploads serving and/or index.html no-cache.')
NGINXPY
fi
if [[ -n "$NGINX_CONF" ]] && command -v nginx >/dev/null 2>&1; then
  # Phase-1 performance patch for the LIVE vhost. Certbot owns its 443
  # blocks, so only additive, idempotent changes are ever made — and the
  # vhost is backed up first, with a listener canary that rolls the whole
  # patch back if nginx ends up listening on fewer ports than before.
  VHOST_BACKUP="/root/salimvand-vhost-$(date -u +%Y%m%dT%H%M%SZ).conf"
  cp -a "$NGINX_CONF" "$VHOST_BACKUP"
  listeners() {
    ss -ltnH 2>/dev/null | awk '{print $4}' | grep -oE ':[0-9]+$' | sort -u | tr '\n' ' '
  }
  LISTENERS_BEFORE="$(listeners)"
  rollback_vhost() {
    cp -a "$VHOST_BACKUP" "$NGINX_CONF"
    nginx -t && systemctl reload nginx
    echo "nginx patch failed; vhost restored from $VHOST_BACKUP." >&2
    exit 1
  }
  if ! grep -q 'gzip_proxied' "$NGINX_CONF"; then
    python3 - "$NGINX_CONF" <<'GZIP_PY'
import sys

path = sys.argv[1]
# Read BEFORE opening for write — open(path, 'w') truncates the file, so
# reading after it would wipe the whole vhost (that exact bug took
# production down once; this line order is load-bearing).
raw = open(path).read()
block = """# Compress proxied JSON/asset responses (mobile sync payloads shrink
# 80-90%). gzip_proxied is mandatory: nginx skips proxied responses otherwise.
gzip on;
gzip_proxied any;
gzip_vary on;
gzip_min_length 1024;
gzip_comp_level 5;
gzip_types application/json application/javascript application/xml text/css text/plain text/xml image/svg+xml;

"""
open(path, 'w').write(block + raw)
print('Patched the live vhost: gzip enabled for proxied responses.')
GZIP_PY
  fi
  sed -i '/^[[:space:]]*listen/ { /http2/! s/443 ssl;/443 ssl http2;/ }' "$NGINX_CONF"
  nginx -t || rollback_vhost
  systemctl reload nginx
  sleep 1
  LISTENERS_AFTER="$(listeners)"
  if [[ -n "$LISTENERS_BEFORE" && "$LISTENERS_BEFORE" != "$LISTENERS_AFTER" ]]; then
    echo "nginx listener set changed ($LISTENERS_BEFORE -> $LISTENERS_AFTER)." >&2
    rollback_vhost
  fi
fi
install -m 0644 deploy/systemd/salimvand-api.service /etc/systemd/system/salimvand-api.service
# Enforce the private API bind even when an older /opt/salimvand/.env contains
# API_HOST=0.0.0.0. Nginx is the only public entry point in production.
install -d /etc/systemd/system/salimvand-api.service.d
cat > /etc/systemd/system/salimvand-api.service.d/10-production-bind.conf <<'API_BIND'
[Service]
Environment=API_HOST=127.0.0.1
Environment=API_PORT=4000
API_BIND
install -m 0644 deploy/systemd/salimvand-website.service /etc/systemd/system/salimvand-website.service
install -m 0644 deploy/systemd/salimvand-worker.service /etc/systemd/system/salimvand-worker.service
systemctl daemon-reload
systemctl enable --now salimvand-api.service salimvand-website.service salimvand-worker.service

# Keep SSH brute-force protection consistent across releases when Fail2ban is installed.
if command -v fail2ban-client >/dev/null 2>&1; then
  install -d /etc/fail2ban/jail.d
  install -m 0644 "$ROOT_DIR/deploy/fail2ban/sshd.local" /etc/fail2ban/jail.d/sshd-salimvand.local
  systemctl enable --now fail2ban
  fail2ban-client reload
fi
# Build-only releases (staged for a restart window) are requested from the
# remote PowerShell wrapper with SKIP_RESTART=1.
if [[ "${SKIP_RESTART:-0}" == "1" ]]; then
  echo "SKIP_RESTART=1 — services left running; release $(git rev-parse --short HEAD) is built and staged."
  exit 0
fi
systemctl restart salimvand-api.service salimvand-website.service salimvand-worker.service

for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error http://127.0.0.1:4000/api/v1/health/ready >/dev/null; then
    systemctl is-active --quiet salimvand-api.service
    systemctl is-active --quiet salimvand-website.service
    systemctl is-active --quiet salimvand-worker.service
    curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3000/ >/dev/null
    # Check the same CMS route used by browser login, not only the private API.
    if [[ -n "${ADMIN_URL:-}" ]]; then
      admin_health="$(curl --fail --silent --show-error --max-time 10 "${ADMIN_URL%/}/api/v1/health")"
      grep -q '"service":"api"' <<<"$admin_health" || {
        echo 'CMS /api reverse proxy is not returning the API health payload.' >&2
        exit 1
      }
    fi
    if ss -ltnH 'sport = :4000' | grep -qvE '127\.0\.0\.1:4000|\[::1\]:4000'; then
      echo 'API is listening on a non-loopback address; refusing to mark release live.' >&2
      ss -ltnH 'sport = :4000' >&2 || true
      exit 1
    fi
    echo "Release $(git rev-parse --short HEAD) is live."
    exit 0
  fi
  sleep 2
done

echo 'API did not become ready within 60 seconds.' >&2
systemctl status salimvand-api.service --no-pager -l >&2 || true
exit 1
