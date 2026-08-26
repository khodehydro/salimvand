#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${APP_DIR:-/opt/salimvand}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/salimvand}"
[[ -f "$ROOT_DIR/.env" ]] || { echo 'Missing production .env.' >&2; exit 1; }
set -a; . "$ROOT_DIR/.env"; set +a
command -v pg_dump >/dev/null || { echo 'pg_dump is required.' >&2; exit 1; }
install -d -m 0700 "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$BACKUP_DIR/postgres-$stamp.sql.gz"
pg_dump "$DATABASE_URL" --format=plain --no-owner --no-privileges | gzip -9 > "$archive"
chmod 0600 "$archive"
if [[ -n "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
  command -v gpg >/dev/null || { echo 'gpg is required when BACKUP_ENCRYPTION_KEY is set.' >&2; exit 1; }
  gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$BACKUP_ENCRYPTION_KEY" --output "$archive.gpg" "$archive"
  shred -u "$archive"
fi
find "$BACKUP_DIR" -type f -mtime +14 -delete
echo "Backup created in $BACKUP_DIR"
