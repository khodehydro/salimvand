#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${EUID}" -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
EMAIL="${CERTBOT_EMAIL:?Set CERTBOT_EMAIL before running}"
certbot --nginx --non-interactive --agree-tos --email "$EMAIL" --redirect \
  -d salimvand.ir -d www.salimvand.ir -d cms.salimvand.ir -d api.salimvand.ir
systemctl reload nginx
certbot renew --dry-run
echo 'TLS certificates installed and renewal verified.'
