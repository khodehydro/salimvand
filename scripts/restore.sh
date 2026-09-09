#!/usr/bin/env bash
set -Eeuo pipefail
BACKUP_FILE="${1:-}"; DRY_RUN=false
[[ "${2:-}" == "--dry-run" ]] && DRY_RUN=true
[[ -n "$BACKUP_FILE" && -f "$BACKUP_FILE" ]] || { echo 'Usage: restore.sh /path/to/full-backup.tar.gz[.gpg] [--dry-run]' >&2; exit 2; }
[[ -n "${TARGET_DATABASE_URL:-}" ]] || { echo 'TARGET_DATABASE_URL is required; refusing production DATABASE_URL.' >&2; exit 1; }
[[ "${TARGET_DATABASE_URL}" != "${DATABASE_URL:-}" ]] || { echo 'Target database must differ from production DATABASE_URL.' >&2; exit 1; }
command -v psql >/dev/null || { echo 'psql is required.' >&2; exit 1; }
manifest="$BACKUP_FILE.manifest"; [[ -f "$manifest" ]] || { echo "Missing manifest: $manifest" >&2; exit 1; }
expected="$(awk -F= '$1 == "sha256" { print $2 }' "$manifest")"; actual="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"; [[ -n "$expected" && "$expected" == "$actual" ]] || { echo 'Backup checksum verification failed.' >&2; exit 1; }
tmp="$(mktemp -d -p "${TMPDIR:-/tmp}" salimvand-restore.XXXXXX)"; cleanup(){ rm -rf "$tmp"; }; trap cleanup EXIT
target="$BACKUP_FILE"; if [[ "$BACKUP_FILE" == *.gpg ]]; then command -v gpg >/dev/null || exit 1; [[ -n "${BACKUP_ENCRYPTION_KEY:-}" ]] || { echo 'BACKUP_ENCRYPTION_KEY is required.' >&2; exit 1; }; target="$tmp/backup.tar.gz"; gpg --batch --quiet --decrypt --passphrase "$BACKUP_ENCRYPTION_KEY" --output "$target" "$BACKUP_FILE"; fi
if "$DRY_RUN"; then tar -tzf "$target" >/dev/null; echo "Full backup dry-run passed: $(basename "$BACKUP_FILE")"; exit 0; fi
[[ "${CONFIRM_RESTORE:-}" == "RESTORE_TO_TARGET" ]] || { echo 'Set CONFIRM_RESTORE=RESTORE_TO_TARGET.' >&2; exit 1; }
tar -xzf "$target" -C "$tmp"; [[ -f "$tmp/database/postgres.sql.gz" ]] || { echo 'Backup database dump is missing.' >&2; exit 1; }
gzip -dc "$tmp/database/postgres.sql.gz" | psql "$TARGET_DATABASE_URL" --set ON_ERROR_STOP=1 >/dev/null
echo 'Database restore completed. Media files are available in the extracted media directory for the controlled media restore step.'
