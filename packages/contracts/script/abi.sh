#!/usr/bin/env bash
# Exports the ABIs TypeScript consumes (INTERFACES §6.3, T-12).
#   bash script/abi.sh          # write abi/*.json        (pnpm abi)
#   bash script/abi.sh --check  # fail on drift vs build  (pnpm abi:check, CI)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
CONTRACTS=(DataDrop MockUSDC3009)
forge build >/dev/null
if [[ "${1:-}" == "--check" ]]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  status=0
  for c in "${CONTRACTS[@]}"; do
    forge inspect "$c" abi --json >"$tmp/$c.json"
    if ! diff -u "abi/$c.json" "$tmp/$c.json"; then
      echo "abi:check: abi/$c.json is stale — run pnpm abi" >&2
      status=1
    fi
  done
  exit "$status"
fi
mkdir -p abi
for c in "${CONTRACTS[@]}"; do
  forge inspect "$c" abi --json >"abi/$c.json"
  echo "wrote abi/$c.json"
done
