#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

command -v bash >/dev/null || { echo 'bash is required.' >&2; exit 1; }
command -v node >/dev/null || { echo 'Node.js is required.' >&2; exit 1; }
if command -v corepack >/dev/null 2>&1; then PNPM=(corepack pnpm); elif command -v pnpm >/dev/null 2>&1; then PNPM=(pnpm); else echo 'pnpm or corepack is required.' >&2; exit 1; fi

for script in scripts/*.sh; do
  bash -n "$script"
done

echo 'Shell syntax checks passed.'
"${PNPM[@]}" --filter @salimvand/api prisma:generate
"${PNPM[@]}" --filter @salimvand/api prisma:validate
"${PNPM[@]}" typecheck
"${PNPM[@]}" test
"${PNPM[@]}" build

echo 'Release candidate checks passed.'
