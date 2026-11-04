#!/usr/bin/env bash
# The MODE=local real-stack loop (BUILD-PLAN §4): Anvil 31337 (1 s blocks) + Deploy.s.sol via scripts/dev-chain.sh, the
# API with X402_FACILITATOR=self RESELLER=mock (real EIP-3009 settlement on MockUSDC3009, real DataDrop.claim), the demo
# seed (scripts/demo-seed.ts), the agent's --once pass against that API (scripts/e2e-agent.ts, I-10), then the headless
# flow services/api/scripts/e2e-flow.ts (I-0…I-18) and a forbidden-pattern scan of every log. Exits non-zero on the
# first failed step; prints one PASS/FAIL line per step and the elapsed time.
#
#   bash scripts/e2e-local.sh                 # ports 8546 (anvil) / 8788 (api); logs in .e2e/ (git-ignored)
#   bash scripts/e2e-local.sh --web           # + Playwright (apps/web/e2e) against the same stack, when it exists
#   bash scripts/e2e-local.sh --redteam       # + security/redteam/run-wave.sh 3 (non-blocking in CI until R3 says so)
#   bash scripts/e2e-local.sh --keep          # leave the stack up afterwards (Ctrl-C stops it)
#   E2E_FAULT=1 bash scripts/e2e-local.sh     # the test of the test: the agent step asserts a wrong value ⇒ exit 1
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
SCRIPTS_TSX="$ROOT/scripts/node_modules/.bin/tsx"
START_NS=$(date +%s%N)
WEB=0
REDTEAM=0
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --web) WEB=1 ;;
    --redteam) REDTEAM=1 ;;
    --keep) KEEP=1 ;;
    --no-build) ;; # builds are the caller's job (CI runs `pnpm -r build` first); accepted for the brief's interface
    *) echo "e2e-local: unknown flag $arg" >&2; exit 2 ;;
  esac
done

mkdir -p "$OUT"
: >"$OUT/chain.log"
: >"$OUT/api.log"
: >"$OUT/agent.log"
[[ -x "$TSX" ]] || { echo "e2e-local: $TSX missing (install or link services/api dependencies)" >&2; exit 1; }
[[ -x "$SCRIPTS_TSX" ]] || { echo "e2e-local: $SCRIPTS_TSX missing (install or link scripts/ dependencies)" >&2; exit 1; }

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

export API_URL RPC_URL
# 3. the demo seed (sponsor-scoped campaign, three tiers, a gift to rahul.eth, ten cards, an agent policy)
if "$SCRIPTS_TSX" "$ROOT/scripts/demo-seed.ts" --reset --quiet; then
  echo "PASS seed: campaign funded on Anvil, 3 entitlements, gift, 10 cards, agent policy ($(elapsed) ms)"
else
  echo "FAIL seed (demo-seed.ts)"; exit 1
fi

# 4. I-10: the agent's --once pass against this API (before the flow's time travel ages the seeded plan)
"$SCRIPTS_TSX" "$ROOT/scripts/e2e-agent.ts"

# 5. the flow, headless (I-0…I-18)
(cd "$API" && API_LOG="$OUT/api.log" "$TSX" scripts/e2e-flow.ts)

# 6. I-18 for every process: the red team's forbidden-pattern list over the API and agent logs
if bash "$ROOT/security/redteam/tools/scan.sh" "$OUT/api.log" "$OUT/agent.log" >"$OUT/scan.log" 2>&1; then
  echo "PASS I-18 forbidden-pattern scan of .e2e/api.log and .e2e/agent.log (security/redteam/tools/scan.sh)"
else
  cat "$OUT/scan.log"; echo "FAIL I-18 forbidden-pattern scan"; exit 1
fi

# 7. optional: the web suite and the red-team wave
if [[ "$WEB" == 1 ]]; then
  if [[ -f "$ROOT/apps/web/playwright.config.ts" ]]; then
    (cd "$ROOT/apps/web" && PLAYWRIGHT_API_URL="$API_URL" pnpm exec playwright test) || { echo "FAIL I-19 playwright"; exit 1; }
    echo "PASS I-19 playwright (apps/web/e2e)"
  else
    echo "SKIP I-19 playwright: apps/web/playwright.config.ts does not exist yet (web workstream)"
  fi
fi
if [[ "$REDTEAM" == 1 ]]; then
  bash "$ROOT/security/redteam/run-wave.sh" 3 || { echo "FAIL I-20 red-team wave 3"; exit 1; }
  echo "PASS I-20 red-team wave 3"
fi

echo "e2e-local: all steps passed in $(elapsed) ms"
if [[ "$KEEP" == 1 ]]; then
  echo "e2e-local: --keep — anvil $RPC_URL, api $API_URL; Ctrl-C stops both"
  wait "$API_PID"
fi
