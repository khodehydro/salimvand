#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_FILE="${1:-}"
DRY_RUN=false
[[ "${2:-}" == "--dry-run" ]] && DRY_RUN=true
[[ -n "$BACKUP_FILE" && -f "$BACKUP_FILE" ]] || { echo 'Usage: restore.sh /path/to/backup.sql.gz[.gpg] [--dry-run]' >&2; exit 2; }
[[ -n "${TARGET_DATABASE_URL:-}" ]] || { echo 'TARGET_DATABASE_URL is required; refusing to use DATABASE_URL.' >&2; exit 1; }
[[ "${TARGET_DATABASE_URL}" != "${DATABASE_URL:-}" ]] || { echo 'Target database must differ from production DATABASE_URL.' >&2; exit 1; }
command -v psql >/dev/null || { echo 'psql is required.' >&2; exit 1; }

manifest="$BACKUP_FILE.manifest"
[[ -f "$manifest" ]] || { echo "Missing manifest: $manifest" >&2; exit 1; }
expected="$(awk -F= '$1 == "sha256" { print $2 }' "$manifest")"
actual="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
[[ -n "$expected" && "$expected" == "$actual" ]] || { echo 'Backup checksum verification failed; refusing restore.' >&2; exit 1; }

target="$BACKUP_FILE"
tmp_file=""
cleanup() { [[ -n "$tmp_file" && -f "$tmp_file" ]] && shred -u "$tmp_file" || true; }
trap cleanup EXIT
if [[ "$BACKUP_FILE" == *.gpg ]]; then
  command -v gpg >/dev/null || { echo 'gpg is required for encrypted backups.' >&2; exit 1; }
  [[ -n "${BACKUP_ENCRYPTION_KEY:-}" ]] || { echo 'BACKUP_ENCRYPTION_KEY is required.' >&2; exit 1; }
  tmp_file="$(mktemp --suffix=.sql.gz)"
  gpg --batch --quiet --decrypt --passphrase "$BACKUP_ENCRYPTION_KEY" --output "$tmp_file" "$BACKUP_FILE"
  target="$tmp_file"
fi

if "$DRY_RUN"; then
  echo "Restore dry-run passed for $(basename "$BACKUP_FILE")"
  echo "Target database was not modified."
  exit 0
fi
[[ "${CONFIRM_RESTORE:-}" == "RESTORE_TO_TARGET" ]] || { echo 'Set CONFIRM_RESTORE=RESTORE_TO_TARGET for a real restore.' >&2; exit 1; }

echo "Restoring $(basename "$BACKUP_FILE") to the explicitly provided target database..."
gzip -dc "$target" | psql "$TARGET_DATABASE_URL" --set ON_ERROR_STOP=1 >/dev/null
echo 'Restore completed successfully.'
