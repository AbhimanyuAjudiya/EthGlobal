#!/usr/bin/env bash
# Red team wave 3 — ops / repo half (security/redteam/attacks/wave3-web-ops.md OP1–OP7; THREAT-MODEL T-50, T-52, T-63–T-67,
# T-69, T-85, T-86). Every check prints one line: "✓ <property>" when the attack failed as expected, or
# "✗ RT-FINDING RT-P-<nn> <name>_RTFINDING: …" when it succeeded (a confirmed finding, security/redteam/findings/RT-P-<nn>.md),
# or "✗ REGRESSION …" when a property that held before is broken. Exit 0 only when every check is ✓.
#
#   security/redteam/wave3-ops/run.sh            # everything (boots MODE=live + Anvil on spare ports, ≈ 1–2 min)
#   security/redteam/wave3-ops/run.sh --static   # no process is started (CI-friendly subset)
#   RT_OUT=/tmp/x security/redteam/wave3-ops/run.sh
#
# Never touches a testnet or vendor: the live API gets a fake env whose every URL is a dead local port. Scratch goes to
# $RT_OUT (never the repo). packages/contracts/deploy/addresses.anvil.json is backed up and restored around the Anvil boots.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
TOOLS="$ROOT/security/redteam/tools"
RT_OUT="${RT_OUT:-${TMPDIR:-/tmp}/recharge-redteam}/wave3-ops"; mkdir -p "$RT_OUT"
STATIC=0; [[ "${1:-}" == "--static" ]] && STATIC=1
cd "$ROOT"
export MODE=local
pass=0; fail=0
ok()      { echo "✓ $*"; pass=$((pass+1)); }
finding() { echo "✗ RT-FINDING $1 ${2}_RTFINDING: $3"; fail=$((fail+1)); }
regress() { echo "✗ REGRESSION: $*"; fail=$((fail+1)); }
section() { echo; echo "── $* ──"; }
port_listen() { # $1 port → "127.0.0.1" | "0.0.0.0" | "" (IPv4 listeners; /proc/net/tcp on Linux, lsof elsewhere)
  local hex; hex="$(printf '%04X' "$1")"
  if [[ -r /proc/net/tcp ]]; then
    awk -v h=":$hex" 'NR>1 && $4=="0A" && substr($2, length($2)-4)==h {print $2}' /proc/net/tcp | head -1 |
      awk -F: '{ if ($1=="00000000") print "0.0.0.0"; else if ($1=="0100007F") print "127.0.0.1"; else print $1 }'
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $9}' | grep -oE '^[^:]+' | sed 's/^\*$/0.0.0.0/' | head -1
  else
    echo "port_listen: no /proc/net/tcp and no lsof" >&2; echo ""
  fi
}
ADDR="$ROOT/packages/contracts/deploy/addresses.anvil.json"
backup_addresses()  { [[ -f "$ADDR" ]] && cp "$ADDR" "$RT_OUT/addresses.anvil.json.bak"; }
restore_addresses() { [[ -f "$RT_OUT/addresses.anvil.json.bak" ]] && cp "$RT_OUT/addresses.anvil.json.bak" "$ADDR"; }
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && { pkill -P "$p" 2>/dev/null; kill "$p" 2>/dev/null; }; done; restore_addresses; }
trap cleanup EXIT INT TERM

# ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section "OP1.3/1.4 secrets and keys in the repo and its history (T-63, T-86)"
# Property: no commit on any ref ever added a real-looking key, mnemonic, access code, signing key, LPA, Arkiv access key,
# Hedera DER key or postage batch. The added lines of `git log -p --all` are scanned with the forbidden-pattern list in its
# fixtures/tests profile (synthetic Anvil/MockReseller values allowed, everything real-format fires) plus vendor-token rules.
HIST="$RT_OUT/history/fixtures/history-added.txt"; mkdir -p "$(dirname "$HIST")"
ALL="$RT_OUT/history/all-added.txt"
git log -p --all --no-color --format='commit %h' -- . ':!pnpm-lock.yaml' | grep '^+' | grep -v '^+++' > "$ALL"
# the full list runs over non-test paths; test files legitimately hold public vendor sample LPAs and synthetic ?token= values
git log -p --all --no-color --format='commit %h' -- . ':!pnpm-lock.yaml' ':!**/test/**' ':!**/*.test.ts' ':!**/*.spec.ts' \
  ':!**/e2e/**' ':!security/**' | grep '^+' | grep -v '^+++' > "$HIST"
if bash "$TOOLS/scan.sh" "$HIST" > "$RT_OUT/history-scan.txt" 2>&1; then ok "history ($(wc -l < "$HIST") added non-test lines, $(git rev-list --all | wc -l) commits): no forbidden pattern"
else regress "history carries a forbidden pattern (redacted head: $(grep -m3 -E '^ +[0-9]+:' "$RT_OUT/history-scan.txt" | cut -c1-40 | tr '\n' ' '))"; fi
vendor="$(grep -noE -- '-----BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|xox[abp]-[0-9A-Za-z-]{10,}|AIza[0-9A-Za-z_-]{35}|sk-ant-[A-Za-z0-9_-]{20,}|302e020100300506032b657004220420[0-9a-fA-F]{64}|3030020100300706052b8104000a04220420[0-9a-fA-F]{64}' "$ALL" | head -3)"
[[ -z "$vendor" ]] && ok "history: no PEM private key / cloud / GitHub / Slack / Anthropic token" || regress "history: vendor token at lines $(echo "$vendor" | cut -d: -f1 | tr '\n' ' ')"
# Allowed by EXACT value only (AUD-06): the public Anvil/Hardhat mnemonic, and the two synthetic phrases of
# scripts/test/regression/verify-rt-a-14-dev-chain-mnemonic.test.ts (6d67ddb) — the BIP-39 "abandon … about" test vector and
# an invented 12-word list. Any other phrase, or these words in another order, still fires.
MN_ALLOWED=(
  'test test test test test test test test test test test junk'
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  'zebra quantum lattice orbit nectar velvet harbor tundra pixel saffron glacier ember'
)
mn="$(grep -oE "[\"'\`]([a-z]{3,8} ){11,23}[a-z]{3,8}[\"'\`]" "$ALL" | sed -E "s/^[\"'\`]//; s/[\"'\`]$//" | sort -u |
  grep -v -x -F "$(printf '%s\n' "${MN_ALLOWED[@]}")")"
[[ -z "$mn" ]] && ok "history: the only BIP-39-shaped phrases ever committed are the public Anvil mnemonic and the two RT-A-14 test vectors" || regress "history: another mnemonic-shaped phrase was committed ($(echo "$mn" | wc -l))"
ac="$(grep -oiE 'rt-accesscode"?[[:space:]]*[:=,][[:space:]]*"[^"<*]{4,}"' "$ALL" | sort -u | grep -viE '"(test-access-code|access-code-0123456789)"')"
[[ -z "$ac" ]] && ok "history: RT-AccessCode only ever carried the synthetic fixture value" || regress "history: RT-AccessCode value(s) other than the fixture one"
# HEAD: the public Anvil key #0 / mnemonic only in dev tooling (dev-chain.sh, Deploy.s.sol), the sanctioned TS home
# (@ethglobal/adapters/testing), tests, red-team tooling and docs.
anvil_files="$(git grep -l -E 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80|test test test test test test test test test test test junk' HEAD -- . | sed 's/^HEAD://' |
  grep -v -E '^(packages/adapters/src/testing/|scripts/dev-chain.sh$|packages/contracts/script/(Deploy|EmitVectors).s.sol$|security/|docs/|research/)|/test/|/e2e/|\.test\.ts$|\.t\.sol$')"
[[ -z "$anvil_files" ]] && ok "HEAD: Anvil key #0 / mnemonic appear only in dev tooling, adapters/testing, tests, docs" || regress "Anvil key/mnemonic in product source: $anvil_files"
git ls-files --error-unmatch .env > /dev/null 2>&1 && regress ".env is tracked" || ok ".env is not tracked"
envex="$(grep -E '^[A-Z0-9_]*(PRIVATE_KEY|SECRET|SIGNING_KEY|ACCESS_CODE|ACCESS_KEY|SEAL_KEY|TOKEN|POSTAGE_BATCH|MNEMONIC|API_KEY)=.+' .env.example | grep -vE '=(|[0-9]+)$')"
[[ -z "$envex" ]] && ok ".env.example: every secret-named variable is empty" || regress ".env.example carries a value for: $(echo "$envex" | cut -d= -f1 | tr '\n' ' ')"

# ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section "OP1.1/1.2 artefacts that hold PINs, LPAs, keys or renders stay out of git (T-86, T-64)"
# Property: every artefact path a run writes is git-ignored, never untracked-and-addable.
missing=()
for p in .e2e/x .agent/x fixtures/inventory.enc out/cards-2026-11-05.pdf out/cards-2026-11-05.manifest.json .env .env.local \
  packages/contracts/deploy/addresses.anvil.json marketing/videos/renders/x.mp4; do
  git check-ignore -q "$p" || missing+=("$p")
done
[[ ${#missing[@]} -eq 0 ]] && ok "ignored: .e2e/ .agent/ inventory.enc out/ (PDF + manifest) .env* addresses.anvil.json renders" || regress "not ignored: ${missing[*]}"
missing=()
for p in apps/web/test-results/trace.zip apps/web/playwright-report/index.html fixtures/reseller/esimaccess/live-order.raw.json fixtures/world/live-verify.raw.json; do
  git check-ignore -q "$p" || missing+=("$p")
done
# RT-FINDING RT-P-03
[[ ${#missing[@]} -eq 0 ]] && ok "ignored: Playwright traces/report and raw live recordings" || finding RT-P-03 gitignore_covers_playwright_and_live_raw "not git-ignored: ${missing[*]} (THREAT-MODEL T-86 mitigation list)"
tracked="$(git ls-files .e2e .agent out fixtures/inventory.enc 'fixtures/**/live-*.raw.json' 'apps/web/test-results' 'apps/web/playwright-report')"
[[ -z "$tracked" ]] && ok "no secret-bearing artefact is tracked" || regress "tracked artefacts: $tracked"
pins="$(grep -rlE '"pin"[[:space:]]*:|\b[0-9]{16}\b' fixtures/demo 2>/dev/null)"
[[ -z "$pins" ]] && ok "fixtures/demo/*.json carry serials and MB only (no PIN, no key)" || regress "PIN-shaped value in $pins (High per OP1.2)"
paths=(); for p in fixtures docs scripts; do [[ -d $p ]] && paths+=("$p"); done
bash "$TOOLS/scan.sh" "${paths[@]}" > "$RT_OUT/scan-repo.txt" 2>&1 && ok "scan.sh fixtures docs scripts: clean" || regress "scan.sh fixtures docs scripts: $(grep -c 'FORBIDDEN PATTERN' "$RT_OUT/scan-repo.txt") file(s) (see $RT_OUT/scan-repo.txt)"
if ls .e2e/*.log > /dev/null 2>&1; then
  hits="$(grep -l -E 'LPA:1\$[A-Za-z0-9.-]+\.[a-z]+\$|payment-signature"?[[:space:]]*[:=][[:space:]]*"?[A-Za-z0-9+/=]{40,}|"pin"[[:space:]]*:[[:space:]]*"[0-9]{16}"' .e2e/*.log 2>/dev/null)"
  [[ -z "$hits" ]] && ok "existing .e2e/*.log carry no LPA, PAYMENT-SIGNATURE value or PIN" || regress "secret in $hits"
fi
# RT-FINDING RT-P-11
loose="$(for f in .e2e/cards.json .e2e/gift.json .e2e/keys.json .e2e/audit-key.txt .e2e/state.json; do [[ -f $f ]] && [[ "$(stat -c %a "$f")" != 600 ]] && echo "$f"; done)"
if grep -q "mode: 0o600" scripts/demo-seed.ts && [[ -z "$loose" ]]; then ok "demo-seed writes PINs/keys/audit key 0600"
else finding RT-P-11 seed_secrets_written_0600 "demo-seed.ts writes PINs, entitlement keys and the audit key world-readable (${loose//$'\n'/ })"; fi
seedguard="$(grep -nE "mode !== 'local'|mode: 'local'|healthz" scripts/demo-seed.ts | head -1)"
[[ -n "$seedguard" ]] && ok "demo-seed refuses an API whose /healthz is not MODE=local before --reset" || finding RT-P-11 seed_checks_target_is_local "demo-seed.ts --reset deletes .e2e state and broadcasts Anvil txs before learning the API is not MODE=local"

# ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section "OP2 seed hooks and demo plumbing (T-85, T-52)"
writes="$(grep -nE '\b(ledger\.(put|create|update|delete)|ArkivLedger|InMemoryLedger|createEntity|stores\.)' scripts/demo-seed.ts)"
[[ -z "$writes" ]] && ok "demo-seed.ts writes no ledger entity directly (public routes + the three hooks only)" || regress "demo-seed writes the ledger: $writes"
hooks="$(grep -rhoiE "x-seed-[a-z-]+" services/api/src | tr 'A-Z' 'a-z' | sort -u | tr '\n' ' ')"
[[ "$hooks" == "x-seed-card-campaign x-seed-claim-window-s x-seed-validity-s " ]] && ok "services/api/src reads exactly the three documented X-Seed-* hooks (no clock hook)" || regress "X-Seed-* headers in services/api/src: $hooks"
unguarded="$(awk '/c\.req\.header\(.x-seed-/{ if (prev !~ /=== .local./ && prev2 !~ /=== .local./) print FILENAME":"NR } {prev2=prev; prev=$0}' services/api/src/*.ts services/api/src/**/*.ts 2>/dev/null)"
[[ -z "$unguarded" ]] && ok "every X-Seed-* read sits directly under an env.MODE === 'local' guard" || regress "seed hook read outside a local guard: $unguarded"
grep -q "if (deps.env.MODE === 'local' && clock)" services/api/src/app.ts && ok "/__local/* routes are registered only when MODE=local" || regress "/__local/* registration guard changed"
livekeys="$(grep -nE "MODE: *'live'|MODE=live" scripts/*.ts scripts/lib/*.ts scripts/*.sh 2>/dev/null)"
grep -q "MODE: 'local'," scripts/lib/harness.ts && [[ -z "$livekeys" ]] && ok "scripts/lib/harness.ts starts the API with MODE=local only (never Anvil keys into a live process)" || regress "harness can start MODE=live: $livekeys"

if [[ $STATIC -eq 0 ]]; then
  # Boot the REAL API process in MODE=live with a fake env, attempt every seed path / header, then run the real demo seed
  # against it (chain half on a private Anvil). Expect: every /__local/* and /facilitator/* route 404, no hook honoured,
  # no `seed-hook` log line, and demo-seed.ts exits non-zero at its first hook.
  # shellcheck source=live-env.sh
  source "$HERE/live-env.sh"
  LPORT=18791; APORT=8597
  ( cd services/api && exec env -i PATH="$PATH" HOME="$HOME" "${LIVE_ENV[@]}" STATE_FILE="$RT_OUT/live-state.json" PORT=$LPORT node_modules/.bin/tsx src/index.ts ) > "$RT_OUT/live-api.log" 2>&1 &
  PIDS+=($!)
  for _ in $(seq 1 100); do grep -q '"api listening"' "$RT_OUT/live-api.log" 2>/dev/null && break; sleep 0.2; done
  if ! grep -q '"api listening"' "$RT_OUT/live-api.log"; then regress "MODE=live API did not boot from the fake env: $(grep -m1 -E '✖|Error' "$RT_OUT/live-api.log" | cut -c1-140) — update live-env.sh if env.ts gained a required live variable"
  else
    B="http://127.0.0.1:$LPORT"; H='content-type: application/json'
    HEX32="0x$(printf 'ab%.0s' $(seq 32))"; CID="0x$(printf 'cd%.0s' $(seq 32))"
    body="{\"advanceMs\":3600000,\"level\":\"orb\",\"signal\":\"$HEX32\",\"seed\":\"rt\"}"
    open=()
    for p in /__local/clock /__local/world-proof /__local/seed /__local/reset /__local/cards /__seed /seed /__dev /debug \
      /facilitator/supported /facilitator/verify /facilitator/settle; do
      for m in POST GET; do
        c="$(curl -s -o /dev/null -w '%{http_code}' -m5 -X $m -H "$H" -d "$body" "$B$p")"
        [[ "$c" == 404 || "$c" == 405 ]] || open+=("$m $p=$c")
      done
    done
    [[ ${#open[@]} -eq 0 ]] && ok "live: 12 seed/dev/facilitator paths × GET/POST all 404" || regress "live: reachable dev routes: ${open[*]}"
    c1="$(curl -s -o /dev/null -w '%{http_code}' -m10 -X POST -H "$H" -H "x-seed-card-campaign: $CID" -d '{"name":"bob.eth","mb":300}' "$B/gift")"
    c2="$(curl -s -o /dev/null -w '%{http_code}' -m10 -X POST -H "$H" -H 'x-seed-claim-window-s: 5' -H "x-seed-card-campaign: $CID" -d '{"name":"card","mb":300}' "$B/gift")"
    c3="$(curl -s -o /dev/null -w '%{http_code}' -m10 -X POST -H "$H" -H 'x-seed-validity-s: 90' -d '{}' "$B/claim")"
    [[ "$c1" != 201 && "$c2" != 201 && "$c3" != 201 && "$c1" != 200 ]] && ok "live: X-Seed-Card-Campaign / -Claim-Window-S / -Validity-S never mint (gift $c1, gift $c2, claim $c3)" || regress "live: a seed header minted (gift $c1/$c2, claim $c3)"
    # chain half for demo-seed: a private Anvil + Deploy.s.sol (dev-chain.sh rewrites addresses.anvil.json — restored on exit)
    backup_addresses
    ANVIL_PORT=$APORT bash scripts/dev-chain.sh > "$RT_OUT/live-chain.log" 2>&1 &
    PIDS+=($!)
    for _ in $(seq 1 240); do grep -q "deploy script finished" "$RT_OUT/live-chain.log" && break; sleep 0.5; done
    [[ "$(port_listen $APORT)" == 127.0.0.1 ]] && ok "Anvil (dev-chain.sh) binds 127.0.0.1 only" || regress "Anvil listens on $(port_listen $APORT)"
    # no --reset: the seed must not delete anybody's .e2e state while proving it fails
    API_URL="$B" RPC_URL="http://127.0.0.1:$APORT" timeout 90 scripts/node_modules/.bin/tsx scripts/demo-seed.ts --quiet > "$RT_OUT/live-seed.txt" 2>&1
    rc=$?
    restore_addresses
    if [[ $rc -ne 0 ]] && grep -q '/__local/clock → 404' "$RT_OUT/live-seed.txt"; then ok "live: demo-seed.ts fails at its first hook (POST /__local/clock → 404), exit $rc"
    else regress "live: demo-seed.ts exit $rc without failing at a hook (see $RT_OUT/live-seed.txt)"; fi
    grep -q 'seed-hook' "$RT_OUT/live-api.log" && regress "live API logged seed-hook" || ok "live: no seed-hook log line (no hook was honoured)"
    grep -qE '"path":"/gift","status":201|"path":"/claim","status":201' "$RT_OUT/live-api.log" && regress "live API created a gift/claim" || ok "live: no gift or claim was created (no 201 in the access log)"
    # RT-FINDING RT-P-01 — what the same process exposes to the LAN when it runs in MODE=local (e2e-local.sh, pnpm demo)
    bind="$(port_listen $LPORT)"
    [[ "$bind" == 127.0.0.1 ]] && ok "API binds loopback" || finding RT-P-01 api_binds_loopback "services/api listens on $bind:$LPORT (serve() has no hostname; no HOST env) — in MODE=local that publishes /__local/clock, /__local/world-proof and X-Seed-* to the LAN"
  fi
  for p in "${PIDS[@]}"; do pkill -P "$p" 2>/dev/null; kill "$p" 2>/dev/null; done; PIDS=()
  pkill -f "anvil --chain-id 31337 --port $APORT" 2>/dev/null
fi

# ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section "process hygiene: e2e-local.sh / pnpm demo (T-85, T-50)"
# RT-FINDING RT-P-01 (static form, also runs with --static)
if grep -qE "hostname|HOST" services/api/src/index.ts; then ok "services/api/src/index.ts binds an explicit host"
else finding RT-P-01 api_binds_loopback_static "serve({ fetch, port }) in services/api/src/index.ts binds every interface; scripts/e2e-local.sh, lib/harness.ts startApi and demo.ts pass no host"; fi
grep -q -- "-H '127.0.0.1'\|'-H', '127.0.0.1'" scripts/lib/harness.ts && ok "harness startWeb binds next to 127.0.0.1" || regress "next is started without -H 127.0.0.1"
if [[ $STATIC -eq 0 ]]; then
  # Kill e2e-local.sh with SIGKILL right after its stack is up (seed stubbed, isolated root so .e2e/ is not touched).
  SB="$RT_OUT/orphan"; rm -rf "$SB"; mkdir -p "$SB/root/scripts/node_modules/.bin"
  cp scripts/e2e-local.sh scripts/dev-chain.sh "$SB/root/scripts/"
  for d in services packages node_modules security; do ln -s "$ROOT/$d" "$SB/root/$d"; done
  printf '#!/bin/sh\nexec sleep 300\n' > "$SB/root/scripts/node_modules/.bin/tsx"; chmod +x "$SB/root/scripts/node_modules/.bin/tsx"
  OC=8586; OA=8799
  backup_addresses
  E2E_ANVIL_PORT=$OC E2E_API_PORT=$OA bash "$SB/root/scripts/e2e-local.sh" > "$SB/run.log" 2>&1 &
  E=$!
  for _ in $(seq 1 240); do grep -q "PASS setup: api" "$SB/run.log" && break; sleep 0.5; done
  kill -9 "$E" 2>/dev/null; sleep 3
  restore_addresses
  left_api="$(port_listen $OA)"; left_chain="$(port_listen $OC)"
  clock="$(curl -s -m3 -X POST -H 'content-type: application/json' -d '{"advanceMs":0}' "http://127.0.0.1:$OA/__local/clock")"
  # RT-FINDING RT-P-02
  if [[ -z "$left_api$left_chain" ]]; then ok "a SIGKILLed e2e-local.sh leaves nothing listening"
  else finding RT-P-02 e2e_local_reaps_stack_on_kill "after SIGKILL of e2e-local.sh: API still on ${left_api:-—}:$OA (/__local/clock → ${clock:0:24}…), Anvil on ${left_chain:-—}:$OC"; fi
  pkill -f "anvil --chain-id 31337 --port $OC" 2>/dev/null
  for p in $(pgrep -f 'tsx' 2>/dev/null); do tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null | grep -qx "PORT=$OA" && kill "$p" 2>/dev/null; done
  pkill -f "$SB/root/scripts" 2>/dev/null; pkill -f 'exec sleep 300|^sleep 300' 2>/dev/null
fi
# RT-FINDING RT-P-07: the I-18 step must scan every log the run writes, and the chain log must not print the mnemonic
grep -q 'scan.sh" "$OUT/api.log" "$OUT/agent.log" >' scripts/e2e-local.sh && finding RT-P-07 e2e_scan_covers_every_log "e2e-local.sh I-18 scans only api.log and agent.log (chain.log, web logs and the seed's stdout are unscanned)" || ok "e2e-local.sh scans every .e2e log"
grep -q "mnemonic '\$MNEMONIC'" scripts/dev-chain.sh && finding RT-P-07 dev_chain_does_not_echo_mnemonic "dev-chain.sh prints ANVIL_MNEMONIC (sourced from .env) into .e2e/chain.log, which CI uploads" || ok "dev-chain.sh does not echo the mnemonic"

# ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section "print pipeline: PDF / manifest / QR / serial → PIN (T-64)"
awk '/const manifest = \{/,/^      \};/' scripts/print-cards.ts | grep -qE '\bpin\b' && regress "print manifest mentions pin" || ok "print-cards manifest carries serial and MB only (no PIN)"
grep -q "({ serial, mb }) => ({" scripts/print-cards.ts && ok "manifest projection is exactly { serial, mb }" || regress "manifest projection changed"
grep -q "rmSync(secretDir" scripts/print-cards.ts && grep -q "mode: 0o600" scripts/print-cards.ts && ok "the one-time PIN file is 0600 and deleted in finally" || regress "PIN temp-file handling changed"
grep -q "giftId = bytesToHex(randomBytes(32))" services/api/src/flows/gift.ts && grep -q "pin = generatePin(randomBytes)" services/api/src/flows/gift.ts && ok "card serial = 32 CSPRNG bits of a random giftId, PIN = independent CSPRNG draw (serial does not predict PIN)" || regress "card serial/PIN derivation changed"
if [[ -x scripts/node_modules/.bin/tsx && -f packages/protocol/dist/pin.js ]]; then
  cat > "$RT_OUT/pin-entropy.mts" << 'TS'
const R = process.env.RT_ROOT!;
const { randomBytes } = await import(`${R}/packages/crypto/dist/index.js`);
const { generatePin, isValidPin, serialFromGiftId } = await import(`${R}/packages/protocol/dist/pin.js`);
const N = 20000, pins = new Set<string>(), counts = Array(10).fill(0);
for (let i = 0; i < N; i++) { const p = generatePin(randomBytes); if (!isValidPin(p)) throw new Error('invalid'); pins.add(p); for (const d of p.slice(0, 15)) counts[+d]++; }
const exp = (N * 15) / 10, chi = counts.reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
const serials = new Set(Array.from({ length: 2000 }, () => serialFromGiftId(`0x${Buffer.from(randomBytes(32)).toString('hex')}` as `0x${string}`)));
// chi² with 9 dof: p < 1e-4 above 33.7
console.log(JSON.stringify({ distinct: pins.size, chi: +chi.toFixed(2), serials: serials.size }));
process.exit(pins.size === N && chi < 33.7 && serials.size === 2000 ? 0 : 1);
TS
  out="$(RT_ROOT="$ROOT" scripts/node_modules/.bin/tsx "$RT_OUT/pin-entropy.mts" 2>&1)"; rc=$?
  [[ $rc -eq 0 ]] && ok "20 000 PINs: all Verhoeff-valid, distinct, body digits uniform ($out) — Verhoeff is a checksum, the 15 body digits are the secret" || regress "PIN generator: $out"
fi
# T-64: an operator-supplied PRINT_TOKEN must be ≥ 32 random bytes; print-cards forwards whatever it is given
grep -qE "PRINT_TOKEN.*length|PRINT_TOKEN.{0,80}(< ?(32|43|64))" scripts/print-cards.ts && ok "print-cards refuses a short PRINT_TOKEN" || finding RT-P-11 print_token_length_checked "print-cards.ts forwards any PRINT_TOKEN (T-64: ≥ 32 random bytes) and its local fallback is 12 bytes"

# ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section "deploy: Deploy.s.sol, fill-deploy-txs.mjs, chains.json (T-08, T-10; RT-C-04/05)"
CJ=packages/contracts/deploy/chains.json
bad="$(jq -r 'to_entries[] | select((.value|keys) != ["explorer","gasToken","name","rpcEnv","slug","usdc","usdcHts"]) | .key' $CJ)"
[[ -z "$bad" ]] && ok "chains.json: every entry has exactly the 7 alphabetical keys Deploy.loadChain reads" || regress "chains.json entries with other keys: $bad"
bad="$(jq -r 'to_entries[] | select((.value.slug|test("^[a-z0-9_]+$")|not) or (.value.usdcHts|test("^(|0\\.0\\.[0-9]+)$")|not) or (.value.usdc|test("^(|0x[0-9a-fA-F]{40})$")|not) or ((.value.name+.value.explorer+.value.gasToken+.value.rpcEnv)|test("[\"\\\\\n]"))) | .key' $CJ)"
[[ -z "$bad" ]] && ok "chains.json: slugs [a-z0-9_], usdc an address or empty, usdcHts 0.0.N or empty, no JSON metacharacters" || regress "chains.json hostile/odd entries: $bad"
if [[ -x scripts/node_modules/.bin/tsx ]]; then
  chk="$(cd scripts && node -e "
const {getAddress}=require('viem'); const c=require('../$CJ'); const out=[];
for (const [id,v] of Object.entries(c)) if (v.usdc && getAddress(v.usdc.toLowerCase())!==v.usdc) out.push(id+' not EIP-55');
const h=c['296']; if ('0x'+BigInt(h.usdcHts.split('.')[2]).toString(16).padStart(40,'0') !== h.usdc.toLowerCase()) out.push('296 usdc != long-zero(usdcHts)');
if (c['84532'].usdc!=='0x036CbD53842c5426634e7929541eC2318f3dCF7e') out.push('84532 usdc != API-FACTS');
console.log(out.join('; '));" 2>&1)"
  [[ -z "$chk" ]] && ok "USDC addresses EIP-55; Hedera alias 0x…068cDa == long-zero(0.0.429274); Base Sepolia == API-FACTS" || regress "USDC addresses: $chk"
fi
want='chainId network ledgerOnly dataDrop usdc usdcHts payout attestor owner pendingOwner deployer deployedAt txs'
spec="$(grep -m1 -oE '\{ "chainId".*"txs"' docs/INTERFACES.md | grep -oE '"[a-zA-Z]+":' | tr -d '":' | grep -vE '^(dataDrop|usdc)$|^$' >/dev/null; grep -m1 -oE '\{ "chainId": [^`]*' docs/INTERFACES.md | sed -E 's/"txs": \{[^}]*\}/"txs": X/' | grep -oE '"[a-zA-Z]+":' | tr -d '":' | tr '\n' ' ' | sed 's/ $//')"
code="$(awk '/function _writeAddresses/,/vm.writeFile/' packages/contracts/script/Deploy.s.sol | grep -oE "'  \"[a-zA-Z]+\": " | grep -oE '"[a-zA-Z]+"' | tr -d '"' | tr '\n' ' ' | sed 's/ $//')"
[[ "$spec" == "$want" && "$code" == "$want" ]] && ok "addresses.<slug>.json key order: INTERFACES §6.3 == Deploy._writeAddresses ($want)" || regress "addresses key order: spec '$spec' vs code '$code'"
grep -q "_checkUsdc(usdc, hedera)" packages/contracts/script/Deploy.s.sol && grep -q "pendingOwner: dataDrop.pendingOwner()" packages/contracts/script/Deploy.s.sol && ok "RT-C-04 (usdc code + decimals) and RT-C-05 (pendingOwner) still in Deploy.s.sol" || regress "RT-C-04/05 fix removed from Deploy.s.sol"
if [[ $STATIC -eq 0 ]] && command -v forge > /dev/null; then
  (cd packages/contracts && forge test --match-path 'test/regression/T08_Decimals.t.sol' --match-path 'test/regression/T10_DeployOwnerRecord.t.sol' > "$RT_OUT/forge-deploy.txt" 2>&1 ||
    forge test --match-contract 'T08_Decimals|T10_DeployOwnerRecord' >> "$RT_OUT/forge-deploy.txt" 2>&1)
  grep -qE "Suite result: ok" "$RT_OUT/forge-deploy.txt" && ! grep -q "FAIL" "$RT_OUT/forge-deploy.txt" && ok "forge: RT-C-04/05 regression suites green" || regress "forge RT-C-04/05 regressions (see $RT_OUT/forge-deploy.txt)"
fi
grep -q "LEDGER_ONLY" docs/DISCLOSURE.md && grep -qE "Mode chosen: .TBD by human \(Integrations, Wed 14:00\).|Mode chosen: .(token|LEDGER_ONLY)" docs/DISCLOSURE.md && ok "DISCLOSURE §2 has the LEDGER_ONLY / token-mode slot the runbook echoes into" || regress "DISCLOSURE lost the LEDGER_ONLY mode slot"
# RT-FINDING RT-P-12: a hostile/typo slug in chains.json makes `pnpm deploy:txs` rewrite a file outside deploy/
HT="$RT_OUT/deploytxs"; rm -rf "$HT" "$RT_OUT/escaped.json"; mkdir -p "$HT/script" "$HT/deploy" "$HT/broadcast/Deploy.s.sol/31337"
cp packages/contracts/script/fill-deploy-txs.mjs "$HT/script/"
echo '{"31337":{"slug":"x/../../../escaped"}}' > "$HT/deploy/chains.json"
echo '{"dataDrop":"0x1111111111111111111111111111111111111111","victim":"untouched"}' > "$RT_OUT/escaped.json"
mkdir -p "$HT/deploy/addresses.x"
echo '{"transactions":[{"transactionType":"CREATE","contractAddress":"0x1111111111111111111111111111111111111111","hash":"0xabc"}]}' > "$HT/broadcast/Deploy.s.sol/31337/run-latest.json"
(cd "$HT" && CHAIN=31337 node script/fill-deploy-txs.mjs > /dev/null 2>&1)
grep -q '"txs"' "$RT_OUT/escaped.json" && finding RT-P-12 deploy_txs_confines_writes_to_deploy "fill-deploy-txs.mjs joins chains.json slug into a path unchecked: slug 'x/../../../escaped' rewrote $RT_OUT/escaped.json outside deploy/" || ok "fill-deploy-txs.mjs refuses a slug that escapes deploy/"
grep -qE "eth_chainId|chain-id|chainId.*RPC" packages/contracts/script/fill-deploy-txs.mjs && ok "deploy:txs checks RPC_URL's chain id before trusting owner()" || finding RT-P-12 deploy_txs_checks_rpc_chain "fill-deploy-txs.mjs writes owner/pendingOwner from whatever RPC_URL answers, without checking it serves CHAIN"

# ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section "OP4 supply chain (T-65)"
mra="$(awk '/^minimumReleaseAge:/{print $2}' pnpm-workspace.yaml)"
[[ -n "$mra" && "$mra" -ge 4320 ]] && ok "pnpm-workspace.yaml minimumReleaseAge = $mra min (≥ 3 days), not weakened" || regress "minimumReleaseAge weakened or missing ($mra)"
grep -qE 'minimumReleaseAgeExclude|minimum-release-age-exclude' pnpm-workspace.yaml .npmrc 2>/dev/null && regress "a minimumReleaseAge exclusion exists" || ok "no minimumReleaseAge exclusion"
nonexact="$(awk '/^catalog:/{f=1;next} /^[^ #]/{f=0} f && /^ +[^# ]/{print}' pnpm-workspace.yaml | grep -vE ':[[:space:]]+[0-9]+\.[0-9]+\.[0-9]+$')"
[[ -z "$nonexact" ]] && ok "every catalog: pin is an exact x.y.z" || regress "non-exact catalog pins: $nonexact"
built="$(awk '/^onlyBuiltDependencies:/{f=1;next} /^[^ ]/{f=0} f && /^ *- /{sub(/^ *- /,"");print}' pnpm-workspace.yaml | tr '\n' ' ')"
[[ "$built" == "esbuild " ]] && ok "onlyBuiltDependencies = [esbuild] (unchanged)" || regress "onlyBuiltDependencies: $built"
ranges="$(for f in package.json apps/*/package.json packages/*/package.json services/*/package.json scripts/package.json; do jq -r --arg f "$f" '[.dependencies,.devDependencies,.optionalDependencies]|map(select(.))|add//{}|to_entries[]|select(.value|test("^(workspace:|catalog:|[0-9]+\\.[0-9]+\\.[0-9]+$)")|not)|"\($f):\(.key)@\(.value)"' "$f"; done)"
# RT-FINDING RT-P-05
[[ -z "$ranges" ]] && ok "no ^/~/latest range in any package.json" || finding RT-P-05 every_direct_dependency_pinned_exact "$(echo "$ranges" | wc -l) non-exact direct deps, incl. $(echo "$ranges" | grep -E 'services/api' | cut -d: -f2 | tr '\n' ' ')"
importers="$(awk '/^importers:/{f=1;next} /^[^ ]/{f=0} f && /^  [^ ]/{sub(/^  /,"");sub(/:$/,"");print}' pnpm-lock.yaml)"
# pnpm 10 writes no importer for a workspace package that declares no dependencies at all (packages/contracts is Foundry-only);
# the dynamic frozen-install probe below stays the CI truth for those. User-approved narrowing, 2026-11-05.
nolock=(); for f in apps/*/package.json packages/*/package.json services/*/package.json scripts/package.json; do d="$(dirname "$f")"; jq -e '([.dependencies,.devDependencies,.optionalDependencies] | map(. // {} | length) | add) > 0' "$f" >/dev/null || continue; grep -qx "$d" <<< "$importers" || nolock+=("$d"); done
# RT-FINDING RT-P-04
[[ ${#nolock[@]} -eq 0 ]] && ok "pnpm-lock.yaml has an importer for every workspace package" || finding RT-P-04 ci_frozen_install_succeeds "pnpm-lock.yaml lacks ${#nolock[@]} workspace importers (${nolock[*]}): CI's first step pnpm install --frozen-lockfile fails ERR_PNPM_OUTDATED_LOCKFILE, so every job (needs: checks) is skipped"
if [[ $STATIC -eq 0 ]]; then
  LP="$RT_OUT/lockprobe"; rm -rf "$LP"; mkdir -p "$LP"
  { git ls-files '*package.json' | grep -v node_modules; echo scripts/package.json; echo pnpm-lock.yaml; echo pnpm-workspace.yaml; } | sort -u | while read -r f; do [[ -f $f ]] && { mkdir -p "$LP/$(dirname "$f")"; cp "$f" "$LP/$f"; }; done
  (cd "$LP" && timeout 120 pnpm install --frozen-lockfile --offline --ignore-scripts > "$RT_OUT/frozen.txt" 2>&1); rc=$?
  [[ $rc -eq 0 ]] && ok "pnpm install --frozen-lockfile succeeds (isolated copy, offline)" || finding RT-P-04 ci_frozen_install_succeeds_dynamic "isolated pnpm install --frozen-lockfile exit $rc: $(grep -m1 -oE 'ERR_PNPM_[A-Z_]+' "$RT_OUT/frozen.txt")"
fi
grep -rnE 'curl[^|]*\|[[:space:]]*(ba)?sh|pnpm dlx [a-z@][^@ ]*( |$)|npx [a-z@][^@ ]*( |$)' .github scripts/*.sh scripts/*.ts scripts/lib 2>/dev/null | grep -q . && regress "curl|sh / unpinned dlx/npx in CI or scripts" || ok "no curl|sh, unpinned npx or pnpm dlx in CI or scripts"
grep -rqE 'link-[a-z]+\.sh|--before=|scratchpad' .github package.json scripts/*.sh 2>/dev/null && regress "CI/scripts reference the out-of-repo link scripts" || ok "the scratchpad link-*.sh scripts are not referenced by CI or root scripts"

# ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section "OP7 CI (T-67, T-86)"
CI=.github/workflows/ci.yml
grep -qE 'secrets\.' $CI && regress "ci.yml references secrets.*" || ok "ci.yml references no secrets.* (fork PRs get nothing to steal)"
grep -qE 'pull_request_target|workflow_run' $CI && regress "ci.yml runs untrusted code with a privileged trigger" || ok "no pull_request_target / workflow_run trigger"
grep -qE '^  MODE: local$' $CI && grep -qE '^  NEXT_PUBLIC_MODE: local$' $CI && ! grep -qE 'MODE: live|MODE=live' $CI && ok "CI is MODE=local everywhere" || regress "CI MODE"
filt_ci="$(grep -oE 'RTFINDING_FILTER: "[^"]+"' $CI | cut -d'"' -f2)"; filt_root="$(jq -r '.scripts["test:ci"]' package.json | grep -oE "\^\(\?!\.\*_RTFINDING\\$\)")"
[[ "$filt_ci" == '^(?!.*_RTFINDING$)' && -n "$filt_root" ]] && ok "the _RTFINDING filter (CI == pnpm test:ci) only drops names ending in _RTFINDING" || regress "_RTFINDING filter drifted: '$filt_ci'"
# every _RTFINDING test must carry a // RT-FINDING <id> marker whose finding is still open: the suffix cannot hide a real failure
orphans=()
while IFS=: read -r file line _; do
  id="$(sed -n "$((line>4?line-4:1)),${line}p" "$file" | grep -oE 'RT-FINDING RT-[A-Z]-[0-9]+' | tail -1 | awk '{print $2}')"
  st="$( [[ -n "$id" && -f security/redteam/findings/$id.md ]] && awk '/^status:/{print $2; exit}' "security/redteam/findings/$id.md")"
  [[ "$st" =~ ^(open|acknowledged|fixing|disputed)$ ]] || orphans+=("$file:$line(${id:-no id}/${st:-?})")
done < <(grep -rnE "^[[:space:]]*(it|test)(\.[a-z]+)?\(['\"\`].*_RTFINDING['\"\`]|function test_[A-Za-z0-9_]*RTFINDING" apps packages services scripts --include=*.ts --include=*.tsx --include=*.sol 2>/dev/null | grep -v node_modules)
[[ ${#orphans[@]} -eq 0 ]] && ok "every _RTFINDING test names an open RT finding (the filter cannot hide an unowned failure)" || regress "_RTFINDING tests without an open finding: ${orphans[*]}"
grep -A3 '^  redteam:' $CI | grep -q 'needs: checks' && grep -q 'continue-on-error: true' $CI && ok "redteam job is non-blocking (continue-on-error) — accepted until wave 3 clears (ops-demo §8); NOT a gate today" || regress "redteam job shape changed"
# RT-FINDING RT-P-06
unpinned="$(grep -oE 'uses: [^ ]+@[^ ]+' $CI | grep -vE '@[0-9a-f]{40}$' | sort -u | wc -l)"
[[ "$unpinned" -eq 0 ]] && ok "every action pinned to a commit SHA" || finding RT-P-06 ci_actions_pinned_by_sha "$unpinned actions pinned by mutable tag (actions/checkout@v5, pnpm/action-setup@v4, foundry-rs/foundry-toolchain@v1, …)"
grep -qE 'pip install [^|]*semgrep([[:space:]]|$)' $CI && finding RT-P-06 ci_pip_semgrep_pinned "ci.yml: pip install … semgrep (no version) in the redteam job" || ok "pip deps pinned"
grep -qE '^permissions:' $CI && ok "ci.yml sets a least-privilege permissions: block" || finding RT-P-06 ci_token_permissions_readonly "ci.yml has no permissions: block (GITHUB_TOKEN gets the repo default on push)"
# RT-FINDING RT-P-07
awk '/name: Upload logs/,/if-no-files-found/' $CI | grep -q 'if: always()' && finding RT-P-07 ci_uploads_only_scanned_logs "e2e-logs upload runs if: always() — also after the I-18 scan failed — and the playwright upload is never scanned" || ok "uploads run only after a clean scan"
grep -qE '! E2E_FAULT=1 bash scripts/e2e-local.sh' $CI && finding RT-P-07 ci_fault_run_fails_for_the_planted_reason "'! E2E_FAULT=1 …' passes when the run fails for ANY reason (port clash, build) — assert the FAIL I-10 line" || ok "fault run asserts the planted failure"

# ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section "OP3 docs consistency (DISCLOSURE, ONSITE-RUNBOOK, DEMO-SCRIPT, ARKIV_FEEDBACK, SWARM, CHANGELOG)"
DOCS=(docs/DISCLOSURE.md docs/ONSITE-RUNBOOK.md docs/DEMO-SCRIPT.md docs/ARKIV_FEEDBACK.md docs/SWARM.md docs/CHANGELOG.md)
for d in "${DOCS[@]}"; do [[ -f $d ]] || regress "missing $d"; done
noowner="$(grep -noE 'TBD by human[^(]{0,3}(\([^)]*\))?' "${DOCS[@]}" | grep -vE 'TBD by human\*?\*? ?\([A-Za-z/ ]+, [A-Z][a-z]{2} [0-9]{2}:[0-9]{2}\)' | grep -vE 'DISCLOSURE.md:8:')"
[[ -z "$noowner" ]] && ok "every 'TBD by human' slot names an owner and a time" || regress "TBD by human without owner/time: $noowner"
refs="$(grep -ohE '`[0-9a-f]{7}`' docs/DISCLOSURE.md | tr -d '`' | sort -u)"; missing=(); for h in $refs; do git cat-file -e "$h^{commit}" 2>/dev/null || missing+=("$h"); done
[[ ${#missing[@]} -eq 0 ]] && ok "every commit hash quoted in DISCLOSURE.md exists ($(echo "$refs" | wc -w))" || regress "DISCLOSURE cites unknown commits: ${missing[*]}"
grep -q 'chain 7794095' docs/DISCLOSURE.md && grep -q 'This is the only change' docs/DISCLOSURE.md && ok "DISCLOSURE: verbatim text + the single Kaolin → rabdi correction" || regress "DISCLOSURE Kaolin/rabdi footnote changed"
kao="$(grep -i -A1 --no-group-separator -n 'kaolin' docs/ONSITE-RUNBOOK.md docs/DEMO-SCRIPT.md docs/ARKIV_FEEDBACK.md docs/SWARM.md docs/CHANGELOG.md | paste -d' ' - - | grep -i 'kaolin' | grep -viE 'retired|committee text|refuses|A-23')"
[[ -z "$kao" ]] && ok "ops docs name Kaolin only as the retired chain / committee wording" || regress "ops docs use Kaolin as live: $kao"
# runbook / demo commands exist (root scripts, or the package the runbook cds into)
rootscripts="$(jq -r '.scripts|keys[]' package.json)"; missing=()
for s in $(grep -ohE '\bpnpm (run )?[a-z][a-z0-9:-]+' docs/ONSITE-RUNBOOK.md docs/DEMO-SCRIPT.md | awk '{print $NF}' | sort -u); do
  case "$s" in install|exec|why|run|deploy:txs|start) continue ;; esac
  grep -qx "$s" <<< "$rootscripts" || missing+=("$s")
done
grep -q '"deploy:txs"' packages/contracts/package.json || missing+=("deploy:txs(contracts)")
grep -q '"start"' services/agent/package.json || missing+=("start(agent)")
[[ ${#missing[@]} -eq 0 ]] && ok "every pnpm <script> in the runbook / demo script exists" || regress "runbook names missing scripts: ${missing[*]}"
# RT-FINDING RT-P-09: `pnpm audit` is pnpm's built-in registry audit, not the root "audit" gate
grep -qE 'Run `pnpm audit`' docs/ONSITE-RUNBOOK.md && jq -e '.scripts.audit' package.json > /dev/null && finding RT-P-09 runbook_runs_the_audit_gate "ONSITE-RUNBOOK Sun 06:00 says 'pnpm audit': pnpm runs its built-in vulnerability audit, never the root audit gate (needs 'pnpm run audit')" || ok "runbook invokes the audit gate with pnpm run audit"
grep -nE '(PRIVATE_KEY|SIGNING_KEY|ACCESS_CODE)=…' docs/ONSITE-RUNBOOK.md | grep -q . && finding RT-P-09 runbook_no_inline_secrets "ONSITE-RUNBOOK passes AGENT_HEDERA_PRIVATE_KEY=… inline on the command line (shell history, ps) — contradicts its own 'never on a command line' rule" || ok "runbook never puts a key on a command line"
missing=(); for f in scripts/check-forbidden.sh scripts/check-design-bans.sh scripts/dump-ledger.ts scripts/redteam/run.ts; do [[ -e $f ]] || missing+=("$f"); done
[[ ${#missing[@]} -eq 0 ]] && ok "every ops script the plans and gates reference exists" || finding RT-P-09 plan_scripts_exist "missing: ${missing[*]} (BUILD-PLAN §2.4/§4/§5.3; run-wave.sh skips design bans silently when absent)"
grep -rqiE 'Arkiv Kaolin' apps/video/src 2>/dev/null && finding RT-P-09 judge_video_says_rabdi "apps/video judge composition still captions 'Arkiv Kaolin explorer' while DISCLOSURE says rabdi" || ok "judge video names rabdi"
# RT-FINDING RT-P-10: recorded fixtures are redacted by hand and nothing blocking scans them
[[ -e scripts/record-fixture.ts ]] && ok "scripts/record-fixture.ts exists (OP6 runnable)" || finding RT-P-10 fixture_recorder_exists "scripts/record-fixture.ts is not written; ONSITE-RUNBOOK says 'redact by hand' for RT-AccessCode, RT-Signature, rp_context.signature, Arkiv access key, LPAs"
awk '/^  checks:/,/^  e2e-local:/' $CI | grep -q 'scan.sh' && ok "a blocking CI job scans committed fixtures/docs" || finding RT-P-10 ci_blocking_fixture_scan "no blocking CI job runs security/redteam/tools/scan.sh over fixtures/ (only the non-blocking redteam job, which never starts while RT-P-04 stands)"
# RT-FINDING RT-P-08: Thursday's 200 live scratch cards have no live code path
livecard="$(grep -rnE "kind: 'card'" services/api/src | grep -v 'flows/gift.ts:14[0-9]')"
if grep -q "Create them on the VPS with the sponsor's funded campaign" docs/ONSITE-RUNBOOK.md && [[ -z "$livecard" ]]; then
  finding RT-P-08 live_card_minting_path "ONSITE-RUNBOOK Thu 09:00 mints 200 campaign-funded cards 'on the VPS' but the only code that creates a card is the MODE=local X-Seed-Card-Campaign hook (services/api/src/flows/gift.ts seedCard)"
else ok "a live, authenticated card-minting path exists for the print run"; fi

echo
echo "wave3-ops: $pass passed, $fail failed"
[[ $fail -eq 0 ]] && { echo "wave3-ops: CLEARED"; exit 0; } || { echo "wave3-ops: NOT CLEARED"; exit 1; }
