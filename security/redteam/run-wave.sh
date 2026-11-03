#!/usr/bin/env bash
# Red-team wave runner (security/redteam/PLAN.md §4–5). Usage: security/redteam/run-wave.sh 1|2|3|all
# Runs the wave's attack suites and the static gates; exit 0 == all attacks failed as expected and all gates green.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOLS="$ROOT/security/redteam/tools"
cd "$ROOT"
wave="${1:-all}"
rc=0
step() { echo; echo "═══ $* ═══"; }
run()  { "$@"; local r=$?; [[ $r -ne 0 ]] && { echo "✗ FAILED: $*"; rc=1; } || echo "✓ $*"; return 0; }

static_gates() {
  step "static: slither"
  if [[ -d packages/contracts/src ]] && ls packages/contracts/src/*.sol > /dev/null 2>&1; then
    (cd packages/contracts && run slither . --foundry-compile-all --config-file "$TOOLS/slither.config.json")
  else echo "(no contracts yet)"; fi
  step "static: semgrep"
  if command -v semgrep > /dev/null; then run semgrep --config "$TOOLS/semgrep/recharge.yml" --error --metrics=off --quiet apps packages services scripts; else echo "semgrep missing: pip install semgrep"; rc=1; fi
  step "static: forbidden patterns (fixtures, docs, scripts)"
  paths=(); for p in fixtures docs scripts; do [[ -e $p ]] && paths+=("$p"); done
  [[ ${#paths[@]} -gt 0 ]] && run bash "$TOOLS/scan.sh" "${paths[@]}"
  step "static: dependencies and secrets"
  run bash "$TOOLS/deps-check.sh"
}

wave1() {
  step "wave 1: contracts attack + invariant tests"
  if ls packages/contracts/test/attack/*.t.sol > /dev/null 2>&1; then
    (cd packages/contracts && run forge test --match-path 'test/attack/*' && FOUNDRY_INVARIANT_RUNS=256 FOUNDRY_INVARIANT_DEPTH=64 run forge test --match-path 'test/invariant/*')
    (cd packages/contracts && [[ -f .gas-snapshot ]] && run forge snapshot --check --tolerance 5 || echo "(no gas snapshot yet)")
  else echo "no attack tests yet — see security/redteam/attacks/wave1-contracts.md"; rc=1; fi
  step "wave 1: octroi / crypto / eip3009 attack suites"
  for pkg in octroi crypto eip3009; do
    if [[ -d packages/$pkg ]]; then run pnpm --filter "@ethglobal/$pkg" test -- --run; else echo "packages/$pkg missing"; rc=1; fi
  done
  step "wave 1: adapters attack + fixture contract tests"
  run pnpm --filter @ethglobal/adapters test -- --run
}
wave2() {
  step "wave 2: api + agent attack suites"
  run pnpm --filter @ethglobal/api test -- --run
  [[ -d services/agent ]] && run pnpm --filter @ethglobal/agent test -- --run || { echo "services/agent missing"; rc=1; }
  step "wave 2: full local loop with log capture + forbidden-pattern scan"
  if [[ -x scripts/e2e-local.sh ]]; then
    mkdir -p /tmp/recharge-redteam; run bash scripts/e2e-local.sh > /tmp/recharge-redteam/e2e.log 2>&1
    run bash "$TOOLS/scan.sh" /tmp/recharge-redteam/e2e.log
    [[ -f /tmp/recharge-redteam/ledger-dump.json ]] && run bash "$TOOLS/scan.sh" /tmp/recharge-redteam/ledger-dump.json
  else echo "scripts/e2e-local.sh missing"; rc=1; fi
}
wave3() {
  step "wave 3: PWA abuse flows"
  if [[ -d apps/web/e2e/abuse ]]; then run pnpm --filter @ethglobal/web e2e:abuse; else echo "apps/web/e2e/abuse missing"; rc=1; fi
  step "wave 3: live-build must not contain the demo wallet key"
  if NEXT_PUBLIC_MODE=live pnpm --filter @ethglobal/web build > /dev/null 2>&1; then
    grep -R -q 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' apps/web/.next && { echo "✗ Anvil key in live bundle (T-63)"; rc=1; } || echo "✓ bundle clean"
  else echo "(web build failed or not present)"; rc=1; fi
}

case "$wave" in
  1) wave1; static_gates ;;
  2) wave2; static_gates ;;
  3) wave3; static_gates ;;
  all) wave1; wave2; wave3; static_gates ;;
  *) echo "usage: run-wave.sh 1|2|3|all" >&2; exit 2 ;;
esac
echo; [[ $rc -eq 0 ]] && echo "RED TEAM: wave $wave — all attacks failed as expected, gates green" || echo "RED TEAM: wave $wave — NOT CLEARED (see ✗ above)"
exit $rc
