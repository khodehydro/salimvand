#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${EUID}" -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
EMAIL="${CERTBOT_EMAIL:?Set CERTBOT_EMAIL before running}"
certbot --nginx --non-interactive --agree-tos --email "$EMAIL" --redirect \
  -d salimvand.ir -d www.salimvand.ir -d cms.salimvand.ir -d api.salimvand.ir
# certbot writes `listen 443 ssl;` without HTTP/2; mobile clients benefit from
# one multiplexed connection, so add it (idempotent: lines that already have
# http2 are left untouched).
NGINX_CONF=""
if [[ -f /etc/nginx/sites-available/salimvand.conf ]]; then
  NGINX_CONF=/etc/nginx/sites-available/salimvand.conf
elif [[ -f /etc/nginx/conf.d/salimvand.conf ]]; then
  NGINX_CONF=/etc/nginx/conf.d/salimvand.conf
fi
if [[ -n "$NGINX_CONF" ]]; then
  sed -i '/^[[:space:]]*listen/ { /http2/! s/443 ssl;/443 ssl http2;/ }' "$NGINX_CONF"
fi
systemctl reload nginx
certbot renew --dry-run
echo 'TLS certificates installed and renewal verified.'
