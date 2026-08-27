#!/usr/bin/env bash
set -Eeuo pipefail

required=(DATABASE_URL REDIS_URL JWT_ACCESS_SECRET JWT_REFRESH_SECRET APP_URL ADMIN_URL PUBLIC_SITE_URL)
missing=()
for key in "${required[@]}"; do
  [[ -n "${!key:-}" ]] || missing+=("$key")
done
if ((${#missing[@]})); then
  echo "Missing required production settings: ${missing[*]}" >&2
  exit 1
fi

for key in JWT_ACCESS_SECRET JWT_REFRESH_SECRET; do
  value="${!key}"
  [[ "$value" != replace-with-* && ${#value} -ge 32 ]] || { echo "$key must be at least 32 characters and not use the placeholder." >&2; exit 1; }
done

for key in APP_URL ADMIN_URL PUBLIC_SITE_URL; do
  value="${!key}"
  [[ "$value" =~ ^https?://[^[:space:]]+$ ]] || { echo "$key must be an http(s) URL." >&2; exit 1; }
done

command -v node >/dev/null || { echo 'Node.js is required.' >&2; exit 1; }
if ! command -v pnpm >/dev/null 2>&1 && ! command -v corepack >/dev/null 2>&1; then
  echo 'pnpm or corepack is required.' >&2
  exit 1
fi

echo 'Production configuration preflight passed.'
