#!/usr/bin/env bash
set -Eeuo pipefail

backup_file="${1:-}"
[[ -n "$backup_file" && -f "$backup_file" ]] || { echo 'Usage: verify-backup.sh /path/to/backup.sql.gz[.gpg]' >&2; exit 2; }
manifest="${backup_file}.manifest"
[[ -f "$manifest" ]] || { echo "Missing manifest: $manifest" >&2; exit 1; }
expected="$(awk -F= '$1 == "sha256" { print $2 }' "$manifest")"
actual="$(sha256sum "$backup_file" | awk '{print $1}')"
[[ -n "$expected" && "$expected" == "$actual" ]] || { echo 'Backup checksum verification failed.' >&2; exit 1; }
echo "Backup verified: $(basename "$backup_file")"
echo "SHA-256: $actual"
