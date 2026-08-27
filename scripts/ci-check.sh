#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if command -v corepack >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
elif command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
else
  echo 'pnpm or corepack is required.' >&2
  exit 1
fi

run() { echo; echo ">>> $*"; "$@"; }
run "${PNPM[@]}" install --frozen-lockfile
run "${PNPM[@]}" --filter @salimvand/api prisma:generate
run "${PNPM[@]}" --filter @salimvand/api prisma:validate
run "${PNPM[@]}" typecheck
run "${PNPM[@]}" test
run "${PNPM[@]}" build
run "${PNPM[@]}" format:check

echo
echo 'CI quality checks passed.'
