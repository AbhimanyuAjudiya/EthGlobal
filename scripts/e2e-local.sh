#!/usr/bin/env bash
# The MODE=local real-stack loop (BUILD-PLAN §4): Anvil 31337 (1 s blocks) + Deploy.s.sol via scripts/dev-chain.sh, the
# API with X402_FACILITATOR=self RESELLER=mock (real EIP-3009 settlement on MockUSDC3009, real DataDrop.claim), then the
# headless flow services/api/scripts/e2e-flow.ts. Exits non-zero on the first failed step; prints the elapsed time.
#
#   bash scripts/e2e-local.sh                 # ports 8546 (anvil) / 8788 (api); logs in .e2e/ (git-ignored)
#   E2E_ANVIL_PORT=8547 E2E_API_PORT=8789 bash scripts/e2e-local.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="$ROOT/services/api"
OUT="$ROOT/.e2e"
CHAIN_PORT="${E2E_ANVIL_PORT:-8546}"
API_PORT="${E2E_API_PORT:-8788}"
RPC_URL="http://127.0.0.1:${CHAIN_PORT}"
API_URL="http://127.0.0.1:${API_PORT}"
TSX="$API/node_modules/.bin/tsx"
START_NS=$(date +%s%N)

mkdir -p "$OUT"
: >"$OUT/chain.log"
: >"$OUT/api.log"
[[ -x "$TSX" ]] || { echo "e2e-local: $TSX missing (install or link services/api dependencies)" >&2; exit 1; }

CHAIN_PID=""
API_PID=""
cleanup() {
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "$CHAIN_PID" ]] && kill "$CHAIN_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

elapsed() { echo $(( ($(date +%s%N) - START_NS) / 1000000 )); }

# 1. chain + contracts (the one harness for anvil + deploy: scripts/dev-chain.sh)
ANVIL_PORT="$CHAIN_PORT" bash "$ROOT/scripts/dev-chain.sh" >"$OUT/chain.log" 2>&1 &
CHAIN_PID=$!
for _ in $(seq 1 600); do
  grep -q "deploy script finished" "$OUT/chain.log" && break
  kill -0 "$CHAIN_PID" 2>/dev/null || { cat "$OUT/chain.log" >&2; echo "e2e-local: dev-chain exited" >&2; exit 1; }
  sleep 0.1
done
grep -q "deploy script finished" "$OUT/chain.log" || { tail -20 "$OUT/chain.log" >&2; echo "e2e-local: deploy timed out" >&2; exit 1; }
echo "PASS setup: anvil on $RPC_URL, contracts deployed ($(elapsed) ms)"

# 2. the API (local mode: Anvil + mocks, self-run facilitator; no other network)
(
  cd "$API"
  MODE=local X402_FACILITATOR=self RESELLER=mock ANVIL_RPC_URL="$RPC_URL" PORT="$API_PORT" LOG_LEVEL=info \
    TRUST_PROXY=1 CAMPAIGN_ID= exec "$TSX" src/index.ts
) >"$OUT/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 300); do
  curl -fsS "$API_URL/healthz" >/dev/null 2>&1 && break
  kill -0 "$API_PID" 2>/dev/null || { cat "$OUT/api.log" >&2; echo "e2e-local: api exited" >&2; exit 1; }
  sleep 0.1
done
curl -fsS "$API_URL/healthz" | grep -q '"chainId":31337' || { tail -20 "$OUT/api.log" >&2; echo "e2e-local: api not healthy" >&2; exit 1; }
echo "PASS setup: api on $API_URL ($(elapsed) ms)"

# 3. the flow, headless
(cd "$API" && API_URL="$API_URL" RPC_URL="$RPC_URL" API_LOG="$OUT/api.log" "$TSX" scripts/e2e-flow.ts)

echo "e2e-local: all steps passed in $(elapsed) ms"
