#!/usr/bin/env bash
set -Eeuo pipefail
BACKUP_FILE="${1:-}"; DRY_RUN=false
[[ "${2:-}" == "--dry-run" ]] && DRY_RUN=true
[[ -n "$BACKUP_FILE" && -f "$BACKUP_FILE" ]] || { echo 'Usage: restore.sh /path/to/full-backup.tar.gz[.gpg] [--dry-run]' >&2; exit 2; }
[[ -n "${TARGET_DATABASE_URL:-}" ]] || { echo 'TARGET_DATABASE_URL is required; refusing production DATABASE_URL.' >&2; exit 1; }
[[ "${TARGET_DATABASE_URL}" != "${DATABASE_URL:-}" ]] || { echo 'Target database must differ from production DATABASE_URL.' >&2; exit 1; }
command -v psql >/dev/null || { echo 'psql is required.' >&2; exit 1; }
command -v pg_dump >/dev/null || { echo 'pg_dump is required for rollback safety.' >&2; exit 1; }
manifest="$BACKUP_FILE.manifest"; [[ -f "$manifest" ]] || { echo "Missing manifest: $manifest" >&2; exit 1; }
expected="$(awk -F= '$1 == "sha256" { print $2 }' "$manifest")"; actual="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"; [[ -n "$expected" && "$expected" == "$actual" ]] || { echo 'Backup checksum verification failed.' >&2; exit 1; }
tmp="$(mktemp -d -p "${TMPDIR:-/tmp}" salimvand-restore.XXXXXX)"; cleanup(){ rm -rf "$tmp"; }; trap cleanup EXIT
target="$BACKUP_FILE"
if [[ "$BACKUP_FILE" == *.gpg ]]; then
  command -v gpg >/dev/null || { echo 'gpg is required.' >&2; exit 1; }
  [[ -n "${BACKUP_ENCRYPTION_KEY:-}" ]] || { echo 'BACKUP_ENCRYPTION_KEY is required.' >&2; exit 1; }
  target="$tmp/backup.tar.gz"; gpg --batch --quiet --decrypt --passphrase "$BACKUP_ENCRYPTION_KEY" --output "$target" "$BACKUP_FILE"
fi
tar -tzf "$target" >/dev/null || { echo 'Backup archive is invalid.' >&2; exit 1; }
if "$DRY_RUN"; then echo "Full backup dry-run passed: $(basename "$BACKUP_FILE")"; exit 0; fi
[[ "${CONFIRM_RESTORE:-}" == "RESTORE_TO_TARGET" ]] || { echo 'Set CONFIRM_RESTORE=RESTORE_TO_TARGET.' >&2; exit 1; }
tar -xzf "$target" -C "$tmp"; [[ -f "$tmp/database/postgres.sql.gz" ]] || { echo 'Backup database dump is missing.' >&2; exit 1; }
# Take a rollback snapshot before replacing anything. It is kept only for this run.
pg_dump "$TARGET_DATABASE_URL" --format=plain --no-owner --no-privileges | gzip -9 > "$tmp/rollback.sql.gz"
rollback() {
  echo 'Restore failed; rolling back target database...' >&2
  if psql "$TARGET_DATABASE_URL" --set ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null && gzip -dc "$tmp/rollback.sql.gz" | psql "$TARGET_DATABASE_URL" --set ON_ERROR_STOP=1 >/dev/null; then echo 'Database rollback completed.' >&2; else echo 'CRITICAL: automatic database rollback failed.' >&2; fi
}
trap 'rollback; cleanup' ERR
# Replacing the public schema guarantees that stale rows cannot survive as duplicates.
psql "$TARGET_DATABASE_URL" --set ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null
gzip -dc "$tmp/database/postgres.sql.gz" | psql "$TARGET_DATABASE_URL" --set ON_ERROR_STOP=1 >/dev/null
# Media replacement is opt-in because the application upload path must be explicitly configured.
if [[ "${RESTORE_MEDIA:-false}" == "true" && -d "$tmp/media" ]]; then
  upload_dir="${UPLOAD_DIR:-${APP_DIR:-/opt/salimvand}/uploads}"
  media_old="$tmp/uploads-before"
  [[ -d "$upload_dir" ]] && mv "$upload_dir" "$media_old"
  mkdir -p "$upload_dir"; cp -a "$tmp/media/." "$upload_dir/"
fi
trap cleanup EXIT
echo 'Full restore completed without duplicate database rows.'
