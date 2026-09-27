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
backup_status=failed; backup_file=""; encrypted=false; work="$(mktemp -d -p "${TMPDIR:-/tmp}" salimvand-backup.XXXXXX)"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
write_status() { local exit_code=$?; printf '{"status":"%s","progress":%s,"phase":"%s","createdAt":"%s","file":"%s","encrypted":%s,"exitCode":%s}\n' "$backup_status" "${progress:-0}" "${phase:-starting}" "$created_at" "$(basename "$backup_file")" "$encrypted" "$exit_code" > "$STATUS_FILE"; chmod 0600 "$STATUS_FILE"; if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then chown salimvand:salimvand "$STATUS_FILE" 2>/dev/null || true; [[ -n "$backup_file" && -f "$backup_file" ]] && chown salimvand:salimvand "$backup_file" "$backup_file.manifest" 2>/dev/null || true; fi; exit "$exit_code"; }
status_progress() { progress="$1"; phase="$2"; printf '{"status":"running","progress":%s,"phase":"%s","createdAt":"%s","file":"","encrypted":false,"exitCode":null}\n' "$progress" "$phase" > "$STATUS_FILE"; chmod 0600 "$STATUS_FILE"; [[ "${EUID:-$(id -u)}" -eq 0 ]] && chown salimvand:salimvand "$STATUS_FILE" 2>/dev/null || true; }
trap write_status EXIT
status_progress 5 'آماده‌سازی فایل موقت'
mkdir -p "$work/database" "$work/media" "$work/metadata"
status_progress 15 'تهیه نسخهٔ دیتابیس'
pg_dump "$DATABASE_URL" --format=plain --no-owner --no-privileges | gzip -9 > "$work/database/postgres.sql.gz"
status_progress 55 'جمع‌آوری رسانه‌ها'
if [[ -d "$ROOT_DIR/uploads" ]]; then cp -a "$ROOT_DIR/uploads/." "$work/media/"; fi
# Only non-secret release metadata is included; credentials, tokens and keys never enter the archive.
printf '{"version":2,"createdAt":"%s","commit":"%s","database":"postgres","mediaIncluded":true}\n' "$created_at" "$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)" > "$work/metadata/manifest.json"
archive="$BACKUP_DIR/salimvand-full-$stamp.tar.gz"
status_progress 75 'ساخت آرشیو فشرده'
tar -czf "$archive" -C "$work" database media metadata
chmod 0600 "$archive"; backup_file="$archive"
status_progress 88 'رمزنگاری و تولید Checksum'
if [[ -n "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
  command -v gpg >/dev/null || { echo 'gpg is required when BACKUP_ENCRYPTION_KEY is set.' >&2; exit 1; }
  gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$BACKUP_ENCRYPTION_KEY" --output "$archive.gpg" "$archive"; shred -u "$archive"; backup_file="$archive.gpg"; encrypted=true
fi
checksum="$(sha256sum "$backup_file" | awk '{print $1}')"
printf 'version=2\ncreated_at=%s\nfile=%s\nsha256=%s\nencrypted=%s\nformat=full-archive\n' "$created_at" "$(basename "$backup_file")" "$checksum" "$encrypted" > "$backup_file.manifest"
chmod 0600 "$backup_file" "$backup_file.manifest"; progress=100; phase='پشتیبان‌گیری کامل شد'; backup_status=success
find "$BACKUP_DIR" -type f -mtime +14 -delete
echo "Full backup created: $backup_file"
echo "Manifest: $backup_file.manifest"
echo "SHA-256: $checksum"
