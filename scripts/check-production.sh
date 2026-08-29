#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${APP_DIR:-/opt/salimvand}"
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ROOT_DIR/.env"
  set +a
fi

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
HTTPS_URL="${HTTPS_URL:-https://127.0.0.1}"
API_URL="${API_URL:-http://127.0.0.1:4000}"

for service in salimvand-api.service salimvand-website.service salimvand-worker.service nginx fail2ban; do
  systemctl is-active --quiet "$service" || { echo "Service is not active: $service" >&2; exit 1; }
done
fail2ban-client status sshd >/dev/null 2>&1 || { echo 'Fail2ban sshd jail is not available.' >&2; exit 1; }
curl --fail --silent --show-error "$API_URL/api/v1/health/ready" >/dev/null
curl --fail --silent --show-error --max-time 10 "$BASE_URL/" >/dev/null
curl --fail --silent --show-error --insecure --max-time 10 "$HTTPS_URL/" >/dev/null

# Validate the browser-facing CMS proxy, not only the private API port. This
# catches a missing `location /api/` that otherwise serves index.html and makes
# login fail even while the API readiness probe is green.
if [[ -n "${ADMIN_URL:-}" ]]; then
  admin_health="$(curl --fail --silent --show-error --max-time 10 "${ADMIN_URL%/}/api/v1/health")"
  grep -q '"service":"api"' <<<"$admin_health" || {
    echo "CMS API proxy returned a non-API response: ${ADMIN_URL%/}/api/v1/health" >&2
    exit 1
  }
fi

if ss -ltnH 'sport = :4000' | grep -qvE '127\.0\.0\.1:4000|\[::1\]:4000'; then
  echo 'API is exposed on a non-loopback address.' >&2
  exit 1
fi

echo 'Production checks passed.'
