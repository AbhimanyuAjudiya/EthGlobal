#!/usr/bin/env bash
# Builds apps/web for the local e2e stack (NEXT_PUBLIC_* are inlined at build time) unless the existing build
# was made for the same API/RPC URLs, then serves it with the server-only demo-wallet and print settings.
set -euo pipefail
WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$WEB"
export NEXT_PUBLIC_MODE=local
export NEXT_PUBLIC_API_URL="${PLAYWRIGHT_API_URL:-http://127.0.0.1:8788}"
export NEXT_PUBLIC_ANVIL_RPC_URL="${PLAYWRIGHT_RPC_URL:-http://127.0.0.1:8546}"
export NEXT_TELEMETRY_DISABLED=1
STAMP="local|$NEXT_PUBLIC_API_URL|$NEXT_PUBLIC_ANVIL_RPC_URL"
if [[ ! -f .next/BUILD_ID || "$(cat .next/e2e-stamp 2>/dev/null)" != "$STAMP" || -n "${E2E_REBUILD:-}" ]]; then
  ./node_modules/.bin/next build
  echo "$STAMP" > .next/e2e-stamp
fi
# the public Anvil test mnemonic, server-side only (app/api/demo-wallet); never NEXT_PUBLIC_ (T-63)
export DEMO_WALLET_MNEMONIC="${DEMO_WALLET_MNEMONIC:-test test test test test test test test test test test junk}"
exec ./node_modules/.bin/next start -p "${PORT:-3000}" -H 127.0.0.1
