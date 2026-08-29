#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${APP_DIR:-/opt/salimvand}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/salimvand}"
[[ -f "$ROOT_DIR/.env" ]] || { echo 'Missing production .env.' >&2; exit 1; }
set -a; . "$ROOT_DIR/.env"; set +a
command -v pg_dump >/dev/null || { echo 'pg_dump is required.' >&2; exit 1; }
install -d -m 0700 "$BACKUP_DIR"
STATUS_FILE="${BACKUP_STATUS_FILE:-/var/lib/salimvand/backup-status.json}"
install -d -m 0700 "$(dirname "$STATUS_FILE")"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
backup_status="failed"
backup_file=""
encrypted=false
write_status() {
  local exit_code=$?
  printf '{"status":"%s","createdAt":"%s","file":"%s","encrypted":%s,"exitCode":%s}\n' "$backup_status" "$created_at" "$(basename "$backup_file")" "$encrypted" "$exit_code" > "$STATUS_FILE"
  chmod 0600 "$STATUS_FILE"
  exit "$exit_code"
}
trap write_status EXIT
archive="$BACKUP_DIR/postgres-$stamp.sql.gz"
pg_dump "$DATABASE_URL" --format=plain --no-owner --no-privileges | gzip -9 > "$archive"
chmod 0600 "$archive"
backup_file="$archive"
encrypted=false
if [[ -n "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
  command -v gpg >/dev/null || { echo 'gpg is required when BACKUP_ENCRYPTION_KEY is set.' >&2; exit 1; }
  gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$BACKUP_ENCRYPTION_KEY" --output "$archive.gpg" "$archive"
  shred -u "$archive"
  backup_file="$archive.gpg"
  encrypted=true
fi
chmod 0600 "$backup_file"
checksum="$(sha256sum "$backup_file" | awk '{print $1}')"
manifest="$backup_file.manifest"
printf 'version=1\ncreated_at=%s\nfile=%s\nsha256=%s\nencrypted=%s\n' "$created_at" "$(basename "$backup_file")" "$checksum" "$encrypted" > "$manifest"
chmod 0600 "$manifest"
backup_status="success"
find "$BACKUP_DIR" -type f -mtime +14 -delete
echo "Backup created in $BACKUP_DIR"
echo "Manifest: $manifest"
echo "SHA-256: $checksum"
