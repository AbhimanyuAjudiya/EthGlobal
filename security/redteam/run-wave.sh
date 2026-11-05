#!/usr/bin/env bash
# Red-team wave runner (security/redteam/README.md, PLAN.md §4–5).
#   security/redteam/run-wave.sh 1|2|3|wave3-ops|wave3-web|all|static|contracts   # exit 0 == every attack failed as expected AND every gate is green
#   (`wave3-ops` = only security/redteam/wave3-ops/run.sh, the ops/repo half of wave 3;
#   `wave3-web` = only security/redteam/wave3-web/run.sh, the PWA half: Playwright rt-* specs + design bans + MODE=live boot;
#   `contracts` = the wave-1 contracts gates + the contract-relevant static gates, runnable before the TS packages land)
# Pass criterion: all attacks fail; every finding has a regression test (PLAN §1). Any ✗ line makes the exit status 1.
# Always MODE=local: no testnet RPC, no vendor API, no real keys (PLAN §7.1). Tools used: bash, grep -P, awk, jq, git, pnpm, forge,
# slither, semgrep, jscpd (via `pnpm dupcheck`). Nothing is installed or fetched except what pnpm's frozen lockfile already pins.
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../scripts/lib/gnu-path.sh" 2>/dev/null || true  # macOS GNU grep/timeout
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOLS="$ROOT/security/redteam/tools"
cd "$ROOT"
export MODE=local NEXT_PUBLIC_MODE=local CI="${CI:-1}"
unset ATTESTOR_PRIVATE_KEY RELAYER_PRIVATE_KEY ARKIV_PRIVATE_KEY TREASURY_PRIVATE_KEY WORLD_RP_SIGNING_KEY ESIMACCESS_ACCESS_CODE 2>/dev/null || true
E2E="$ROOT/.e2e"                                            # written by scripts/e2e-local.sh (ops-demo)
RT_OUT="${RT_OUT:-${TMPDIR:-/tmp}/recharge-redteam}"; mkdir -p "$RT_OUT"   # red-team scratch: never inside the repo
wave="${1:-all}"
rc=0; passed=0; failed=0
step() { echo; echo "═══ $* ═══"; }
ok()   { echo "✓ $*"; passed=$((passed+1)); }
ko()   { echo "✗ FAILED: $*"; failed=$((failed+1)); rc=1; }
run()  { "$@"; local r=$?; if [[ $r -eq 0 ]]; then ok "$*"; else ko "$* (exit $r)"; fi; return 0; }
# run a command inside a directory WITHOUT a subshell, so a failure still reaches $rc
run_in() { local dir="$1"; shift; pushd "$dir" > /dev/null || { ko "cd $dir"; return 0; }; run "$@"; popd > /dev/null || true; }
need() { [[ -e "$1" ]] && return 0; ko "$2 (missing: $1)"; return 1; }
# The attack suites live where the builders and the red team put them (AUD-05 a): test/redteam/ (red team, rt-*/verify-*),
# test/attack/ (builders' *.attack.test.ts) and, for the adapters, test/live/ (fixture-backed contract suites,
# wave1-adapters.md). protocol/crypto/eip3009 have no attack folder: their wave-1 attacks are octroi's
# test/redteam/rt-*.test.ts and protocol's test/redteam-octroi-regressions.test.ts. Each package's whole suite runs.
attack_paths() { # $1 package dir → the attack test paths that exist (one per line)
  local p; for p in "$1"/test/redteam "$1"/test/attack "$1"/test/live "$1"/test/redteam-*.test.ts; do [[ -e $p ]] && echo "$p"; done
}

static_gates() {
  step "static: semgrep rules self-test (parse + behaviour, offline)"
  if command -v semgrep > /dev/null; then run bash "$TOOLS/semgrep/selftest.sh"; else ko "semgrep missing — pip3 install semgrep"; fi

  step "static: semgrep over the product"
  if command -v semgrep > /dev/null; then
    targets=(); for p in apps packages services scripts; do [[ -d $p ]] && targets+=("$p"); done
    run semgrep --config "$TOOLS/semgrep/recharge.yml" --error --metrics=off --disable-version-check --quiet "${targets[@]}"
  fi

  step "static: slither (DataDrop, MockUSDC3009)"
  if ls packages/contracts/src/*.sol > /dev/null 2>&1; then
    # no --foundry-compile-all: it runs `forge clean` (wiping builders' out/ mid-run) and crashed crytic-compile on forge 1.5 here
    run_in packages/contracts slither . --config-file "$TOOLS/slither.config.json" --fail-medium
  else echo "(no contracts yet)"; fi

  step "static: forbidden patterns (committed fixtures, docs, scripts, e2e specs)"
  paths=(); for p in fixtures docs scripts apps/web/e2e research; do [[ -e $p ]] && paths+=("$p"); done
  [[ ${#paths[@]} -gt 0 ]] && run bash "$TOOLS/scan.sh" "${paths[@]}"

  step "static: repo hygiene — artefacts that hold secrets must be git-ignored (T-86)"
  for p in .e2e/x .agent/x fixtures/inventory.enc out/x apps/web/test-results/x apps/web/playwright-report/x .env; do
    if git check-ignore -q "$p"; then ok "ignored: $p"; else ko "NOT git-ignored: $p (THREAT-MODEL §7 item 17)"; fi
  done
  tracked="$(git ls-files .e2e .agent out fixtures/inventory.enc 2>/dev/null)"
  [[ -z "$tracked" ]] && ok "no secret-bearing artefact is tracked" || ko "tracked artefacts: $tracked"

  step "static: Arkiv reads filter on \$creator (T-79)"
  if ls packages/adapters/src/live/arkiv*.ts > /dev/null 2>&1; then
    if grep -l -E '\.select\(|\.query\(' packages/adapters/src/live/arkiv*.ts > /dev/null && ! grep -q -E '\$creator|creator' packages/adapters/src/live/arkiv*.ts; then
      ko "ArkivLedger queries without a \$creator filter"
    else ok "ArkivLedger mentions a creator filter (the L16 test is the proof)"; fi
  else echo "(no ArkivLedger yet)"; fi

  step "static: duplication (jscpd 1 %), dependencies and secrets"
  [[ -f .jscpd.json ]] && run pnpm -s dupcheck
  run bash "$TOOLS/deps-check.sh"

  step "static: threat coverage matrix (THREAT-MODEL §5.12)"
  run bash "$TOOLS/coverage-check.sh"
}

wave1_contracts() {
  step "wave 1: contracts — red-team attack tests (test/redteam) + fixed-finding regressions (test/regression)"
  # attack tests for wave1-contracts.md A1–A19 live in test/redteam/ (red team) and the builder's test/DataDrop.t.sol
  # (test_Attack_*); a fixed RT-C finding's attack test moves to test/regression/T<nn>_*.t.sol as a passing regression.
  if need packages/contracts/test/redteam "red-team attack tests for wave1-contracts.md A1–A19"; then
    run_in packages/contracts forge test --match-path 'test/redteam/**' --no-match-test RTFINDING -vv
    run_in packages/contracts forge test --match-path 'test/regression/**' -vv
    run_in packages/contracts forge test --match-test '^test_Attack_|^test_Drill_' -vv
    FOUNDRY_INVARIANT_RUNS=256 FOUNDRY_INVARIANT_DEPTH=64 run_in packages/contracts forge test --match-test '^invariant_'
    # invariant entries carry no gas, and `--tolerance` mis-reports them as diffs: they are proven by the run above
    if [[ -f packages/contracts/.gas-snapshot ]]; then
      run_in packages/contracts forge snapshot --check --tolerance 5 --no-match-test 'invariant|RTFINDING'
    else echo "(no gas snapshot yet)"; fi
    run_in packages/contracts forge fmt --check
    run_in packages/contracts pnpm -s abi:check
  fi
  step "wave 1: contracts — regression tests named in THREAT-MODEL §5.12 exist"
  run bash "$TOOLS/coverage-check.sh" --require packages/contracts
}

contracts_static() {
  step "static: slither (DataDrop, MockUSDC3009)"
  run_in packages/contracts slither . --config-file "$TOOLS/slither.config.json" --fail-medium
  step "static: duplication (jscpd 1 %)"
  [[ -f .jscpd.json ]] && run pnpm -s dupcheck
  step "static: threat coverage matrix (THREAT-MODEL §5.12)"
  run bash "$TOOLS/coverage-check.sh"
}

wave1() {
  wave1_contracts
  step "wave 1: protocol / crypto / eip3009 / octroi / adapters — attack + fixture contract suites"
  for pkg in protocol crypto eip3009 octroi adapters; do
    if need "packages/$pkg/test" "test suite for @ethglobal/$pkg"; then
      run pnpm --filter "@ethglobal/$pkg" test -- --run
    fi
  done
  # the red-team suites themselves must exist (a package losing them is a failure, not a skip)
  for pkg in protocol octroi adapters; do
    [[ -n "$(attack_paths "packages/$pkg")" ]] && ok "attack suites for @ethglobal/$pkg: $(attack_paths "packages/$pkg" | tr '\n' ' ')" \
      || ko "attack tests for @ethglobal/$pkg (wave1-octroi.md / wave1-adapters.md) (missing: packages/$pkg/test/{redteam,attack,live})"
  done
  step "wave 1: regression tests named in THREAT-MODEL §5.12 exist"
  run bash "$TOOLS/coverage-check.sh" --require packages/contracts packages/protocol packages/crypto packages/eip3009 packages/octroi packages/adapters
}

wave2() {
  step "wave 2: api + agent attack suites"
  for svc in api agent; do
    if need "services/$svc/test/redteam" "attack tests for @ethglobal/$svc (wave2-api-agent.md)"; then
      run pnpm --filter "@ethglobal/$svc" test -- --run
    fi
  done
  step "wave 2: full local loop (scripts/e2e-local.sh) with log capture"
  if need scripts/e2e-local.sh "the ops-demo e2e harness"; then
    run bash scripts/e2e-local.sh --redteam
  fi
  # the ledger-dump check and the log scan read the GOOD run's .e2e/latest: they run before the E2E_FAULT run below, which
  # stops before the dump by design and re-points .e2e/latest at its own run (AUD-05 c)
  step "wave 2: forbidden-pattern scan of logs, ledger dump, HCS dump, agent journal"
  # e2e-local.sh writes each run to .e2e/<run-id>/ (RT-P-02) with .e2e/latest → it; older root-level logs are scanned too
  [[ -f "$E2E/latest/ledger-dump.json" ]] || ko "missing .e2e/latest/ledger-dump.json (AP4 step 6; e2e-local.sh step 6)"
  logs=(); for f in "$E2E"/*.log "$E2E"/*/*.log "$E2E"/latest/ledger-dump.json "$RT_OUT"/*.json "$ROOT"/.agent; do [[ -e $f ]] && logs+=("$f"); done
  if [[ ${#logs[@]} -gt 0 ]]; then run bash "$TOOLS/scan.sh" "${logs[@]}"; else ko "no .e2e logs / ledger dump to scan (scripts/dump-ledger.ts must write .e2e/latest/ledger-dump.json)"; fi
  if [[ -f scripts/e2e-local.sh ]]; then
    step "wave 2: the e2e harness can fail (E2E_FAULT=step7, OP5)"
    E2E_FAULT=step7 bash scripts/e2e-local.sh > "$RT_OUT/fault.log" 2>&1 && ko "e2e-local.sh passes with E2E_FAULT=step7 (OP5: the harness cannot fail)" || ok "e2e-local.sh fails under E2E_FAULT=step7"
  fi
  step "wave 2: regression tests named in THREAT-MODEL §5.12 exist"
  run bash "$TOOLS/coverage-check.sh" --require services/api services/agent
}

wave3() {
  step "wave 3: PWA abuse specs (Playwright, Chromium)"
  # the specs live in apps/web/test/redteam/rt-*.spec.ts and run against the real stack in wave3_web (wave3-web/run.sh)
  need apps/web/test/redteam/playwright.redteam.config.ts "Playwright abuse specs (wave3-web-ops.md W1–W11)" &&
    ok "abuse specs present: $(ls apps/web/test/redteam/rt-*.spec.ts | wc -l) rt-*.spec.ts (run by wave3-web/run.sh)"
  step "wave 3: live build carries no demo wallet, test key or server secret (T-63, T-81)"
  # built into its own dist dir: apps/web/.next may be serving another session and is never rebuilt here (AUD-11)
  local live_dist="${RT_LIVE_DIST:-.next-audit}"
  if [[ -d apps/web/app ]]; then
    if NEXT_DIST_DIR="$live_dist" NEXT_PUBLIC_MODE=live pnpm --filter @ethglobal/web build > "$RT_OUT/web-build.log" 2>&1; then
      # secret VALUES must be in neither the client nor the web server bundle; client-only CODE (the RP signer, the demo
      # banner) is checked in what the browser downloads: the server bundle resolves the real idkit-server by design
      # (RT-W-11, lib/idkit-server.browser.ts), so `signingKeyHex` there is a parameter name, not a shipped secret
      hits="$(grep -R -l -E 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80|8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba|test test test test test test test test test test test junk|sk-ant-' "apps/web/$live_dist/static" "apps/web/$live_dist/server" 2>/dev/null)"
      hits+="$(grep -R -l -E 'RP_SIGNING_KEY|signingKeyHex|idkit-core/signing|DemoWalletPanel|demo-wallet__addr' "apps/web/$live_dist/static" 2>/dev/null)"
      [[ -z "$hits" ]] && ok "live bundle clean (no test key, mnemonic or API key in static/server; no signer or demo banner in static)" || ko "secrets / demo wallet in live bundle: $hits"
      run bash "$TOOLS/scan.sh" "apps/web/$live_dist/static"
      LIVE_BUNDLE_DIR="apps/web/$live_dist" run pnpm --filter @ethglobal/web exec vitest run test/no-anvil-key-in-bundle.test.ts
    else ko "live web build failed (see $RT_OUT/web-build.log)"; fi
  else ko "apps/web/app missing"; fi
  step "wave 3: ops — seed hooks are local-only, recorder redacts, design bans"
  # a missing gate is a failure, not a skip (RT-P-09)
  if need scripts/check-design-bans.sh "the design-ban gate (BUILD-PLAN §2.4)"; then run bash scripts/check-design-bans.sh; fi
  # the ops attacks (OP2, OP5, OP6) are executable checks in wave3-ops/run.sh; their fixed findings' regressions and the
  # T-65/T-85/T-86 tests live in scripts/test/regression
  if [[ -d scripts/test/regression ]]; then
    # run without the variables an enclosing `e2e-local.sh --redteam` exports (E2E_OUT, API_URL, RPC_URL): the RT-P-02
    # sandbox tests spawn their own e2e-local.sh in an isolated root, and an inherited E2E_OUT points it at the
    # parent's run directory instead (Anvil then never comes up in the sandbox)
    if [[ -f scripts/package.json ]]; then run env -u E2E_OUT -u API_URL -u RPC_URL pnpm --dir scripts exec vitest run test/regression
    else ko "scripts/test/regression exists but scripts/ has no package.json with vitest to run it"; fi
  else ko "scripts/test/regression missing (wave3-web-ops.md OP2, OP5, OP6)"; fi
  step "wave 3: regression tests named in THREAT-MODEL §5.12 exist"
  run bash "$TOOLS/coverage-check.sh" --require apps/web scripts
}

wave3_ops() {
  # wave3-web-ops.md OP1–OP7 as executable checks (security/redteam/wave3-ops/run.sh): history + repo secrets, .gitignore,
  # seed hooks against a real MODE=live boot, process hygiene, print pipeline, deploy tooling, supply chain, CI, docs.
  # Exit non-zero while any RT-P finding is open (each failing check is printed as `RT-FINDING RT-P-<nn> <name>_RTFINDING`).
  step "wave 3: ops / repo (wave3-ops/run.sh — OP1–OP7, findings RT-P-*)"
  if need security/redteam/wave3-ops/run.sh "ops attack checks (wave3-web-ops.md OP1–OP7)"; then
    RT_OUT="$RT_OUT" run bash security/redteam/wave3-ops/run.sh
  fi
}

wave3_web() {
  # wave3-web-ops.md W1–W11 + product probes as executable checks (security/redteam/wave3-web/run.sh): the Playwright
  # suite apps/web/test/redteam/rt-*.spec.ts against the real local stack, the design-ban gate, and a NEXT_PUBLIC_MODE=live
  # build booted with MODE=live (route enumeration + bundle grep, built in a git-ignored copy so apps/web/.next is untouched).
  # Exit non-zero while any RT-W finding is open (each failing check prints `RT-FINDING RT-W-<nn> <name>_RTFINDING`).
  step "wave 3: web / PWA (wave3-web/run.sh — W1–W11 + product probes, findings RT-W-*)"
  if need security/redteam/wave3-web/run.sh "web attack checks (wave3-web-ops.md W1–W11)"; then
    # its local web build goes to its own dist dir, never apps/web/.next (another session may serve it, AUD-11)
    NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-redteam}" RT_OUT="$RT_OUT" run bash security/redteam/wave3-web/run.sh
  fi
}

case "$wave" in
  1) wave1; static_gates ;;
  contracts) wave1_contracts; contracts_static ;;
  2) wave2; static_gates ;;
  3) wave3; wave3_ops; wave3_web; static_gates ;;
  wave3-ops) wave3_ops ;;
  wave3-web) wave3_web ;;
  all) wave1; wave2; wave3; wave3_ops; wave3_web; static_gates ;;
  static) static_gates ;;
  *) echo "usage: run-wave.sh 1|2|3|wave3-ops|wave3-web|all|static|contracts" >&2; exit 2 ;;
esac
# regenerated AND formatted, so a run never leaves INDEX.md failing `prettier --check` (AUD-11)
bash "$TOOLS/findings-index.sh" > /dev/null 2>&1 && pnpm -s exec prettier --write security/redteam/findings/INDEX.md > /dev/null 2>&1 || true
findings=(security/redteam/findings/RT-*.md)
if [[ "$wave" == "contracts" ]]; then   # the contracts gate judges only findings filed against packages/contracts
  mapfile -t findings < <(grep -l -E '^module: packages/contracts/' security/redteam/findings/RT-*.md 2>/dev/null)
fi
open_blocking="$(printf '%s\n' "${findings[@]}" | xargs -r grep -l -E '^severity: (Critical|High)' 2>/dev/null | xargs -r grep -L -E '^status: (verified|closed)' 2>/dev/null)"
if [[ -n "$open_blocking" ]]; then ko "open Critical/High findings: $(echo "$open_blocking" | xargs -n1 basename | tr '\n' ' ')"; fi
missing_reg="$(printf '%s\n' "${findings[@]}" | xargs -r grep -l -E '^status: (fixed|verified|closed)' 2>/dev/null | xargs -r grep -L -E '^regression_test: *[^ #]' 2>/dev/null)"
if [[ -n "$missing_reg" ]]; then ko "findings marked fixed without regression_test: $(echo "$missing_reg" | xargs -n1 basename | tr '\n' ' ')"; fi
echo
echo "summary: $passed passed, $failed failed"
[[ $rc -eq 0 ]] && echo "RED TEAM: wave $wave — CLEARED (all attacks failed as expected, gates green)" || echo "RED TEAM: wave $wave — NOT CLEARED (see ✗ above)"
exit $rc
