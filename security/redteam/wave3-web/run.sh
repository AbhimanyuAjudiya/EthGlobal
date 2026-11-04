#!/usr/bin/env bash
# Red team wave 3 — web half (security/redteam/attacks/wave3-web-ops.md W1–W11 + the wave3-web product probes;
# THREAT-MODEL T-31, T-47, T-58–T-64, T-70, T-72, T-73, T-76, T-81, T-85). Three parts:
#   1. Playwright attack suite apps/web/test/redteam/rt-*.spec.ts against the REAL local stack (Anvil + services/api +
#      `next start` of apps/web). A failing test named `…_RTFINDING` is a confirmed finding (findings/RT-W-<nn>.md);
#      any other failing test is a REGRESSION (a property that held before is broken).
#   2. The design-ban gate (packages/ui tokens.test.ts "design bans", via scripts/check-design-bans.sh).
#   3. MODE=live: `NEXT_PUBLIC_MODE=live next build`, boot `next start` with MODE=live (and, worst case, the local
#      demo variables still exported), enumerate every route incl. /api/demo-wallet, /__local/*, /ui/*, /print/cards,
#      and grep the live bundle (.next/static + .next/server) for keys, mnemonics, RP keys and local-only code.
# Exit 0 only when every check is ✓. Scratch goes to $RT_OUT (never the repo).
#
#   security/redteam/wave3-web/run.sh            # everything (reuses a running stack on :8546/:8788/:3000, else starts one)
#   security/redteam/wave3-web/run.sh --no-live  # skip part 3 (keeps apps/web/.next as the local build)
#   security/redteam/wave3-web/run.sh --live-only
#   NEXT_DIST_DIR=.next-fix PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 PLAYWRIGHT_API_URL=http://127.0.0.1:8808 \
#     security/redteam/wave3-web/run.sh --no-live   # against a verification build served beside apps/web/.next
#
# Part 3 never touches apps/web/.next (other sessions serve it): the live build is made in a git-ignored copy at
# tmp/rt-web-live (same depth as apps/web, node_modules symlinked, so the relative pnpm links and next.config's repo
# root still resolve). Part 1's static checks read NEXT_DIST_DIR (default .next) like next.config.ts does.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
WEB="$ROOT/apps/web"
TOOLS="$ROOT/security/redteam/tools"
RT_OUT="${RT_OUT:-${TMPDIR:-/tmp}/recharge-redteam}/wave3-web"; mkdir -p "$RT_OUT"
LIVE=1; SUITE=1
for a in "$@"; do case "$a" in --no-live) LIVE=0 ;; --live-only) SUITE=0 ;; esac; done
export MODE=local
API_URL="${PLAYWRIGHT_API_URL:-http://127.0.0.1:8788}"
BASE_URL="${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:3000}"
PRINT_TOKEN="${PRINT_TOKEN:-local-e2e-print-token-0001}"
pass=0; fail=0
ok()      { echo "✓ $*"; pass=$((pass+1)); }
finding() { echo "✗ RT-FINDING $1 ${2}_RTFINDING: $3"; fail=$((fail+1)); }
regress() { echo "✗ REGRESSION: $*"; fail=$((fail+1)); }
section() { echo; echo "── $* ──"; }
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && { pkill -P "$p" 2>/dev/null; kill "$p" 2>/dev/null; }; done; }
trap cleanup EXIT INT TERM
up() { curl -fsS -m 3 "$1" > /dev/null 2>&1; }
wait_up() { for _ in $(seq 1 "${2:-240}"); do up "$1" && return 0; sleep 1; done; return 1; }

# map a failing test title to its finding id (the findings carry the attack_test path)
finding_for() { grep -l -F "$1" "$ROOT"/security/redteam/findings/RT-W-*.md 2>/dev/null | head -1 | xargs -r basename | sed 's/\.md$//'; }

if [[ $SUITE -eq 1 ]]; then
  section "stack (Anvil + API + next start, MODE=local)"
  WEB_STARTED=0
  if ! up "$API_URL/healthz"; then
    bash "$ROOT/scripts/e2e-local.sh" --keep > "$RT_OUT/stack.log" 2>&1 & PIDS+=($!)
    wait_up "$API_URL/healthz" 300 && ok "local stack up ($API_URL)" || { regress "local stack did not come up (see $RT_OUT/stack.log)"; exit 1; }
  else ok "reusing the running API at $API_URL"; fi
  if ! up "$BASE_URL/offline"; then
    (cd "$WEB" && PORT="${BASE_URL##*:}" PRINT_TOKEN="$PRINT_TOKEN" PLAYWRIGHT_API_URL="$API_URL" \
      PRINT_CARDS_FILE="${PRINT_CARDS_FILE:-$ROOT/.e2e/web-print-cards.json}" bash e2e/serve.sh > "$RT_OUT/web.log" 2>&1) & PIDS+=($!)
    WEB_STARTED=1
    wait_up "$BASE_URL/offline" 400 && ok "web up ($BASE_URL)" || { regress "web did not come up (see $RT_OUT/web.log)"; exit 1; }
  else ok "reusing the running web app at $BASE_URL"; fi

  section "W1–W11 + product probes (Playwright, apps/web/test/redteam)"
  (cd "$WEB" && PLAYWRIGHT_BASE_URL="$BASE_URL" PLAYWRIGHT_API_URL="$API_URL" PRINT_TOKEN="$PRINT_TOKEN" RT_OUT="$RT_OUT" \
    ./node_modules/.bin/playwright test -c test/redteam/playwright.redteam.config.ts --reporter=json > "$RT_OUT/pw.json" 2> "$RT_OUT/pw.stderr")
  if ! jq -e '.suites' "$RT_OUT/pw.json" > /dev/null 2>&1; then regress "Playwright produced no report (see $RT_OUT/pw.stderr)"
  else
    while IFS=$'\t' read -r status title file; do
      if [[ "$status" == "expected" || "$status" == "skipped" ]]; then ok "$file › $title"
      elif [[ "$title" == *_RTFINDING ]]; then id="$(finding_for "${title%_RTFINDING}")"; finding "${id:-RT-W-??}" "$(echo "${title%_RTFINDING}" | tr ' ' '_' | cut -c1-60)" "$file"
      else regress "$file › $title ($status)"; fi
    done < <(jq -r '.. | objects | select(has("specs")) | .specs[] as $s | $s.tests[] | [.status, $s.title, $s.file] | @tsv' "$RT_OUT/pw.json")
  fi
  [[ $WEB_STARTED -eq 1 ]] && { pkill -f "next start -p ${BASE_URL##*:}" 2>/dev/null; true; }

  section "design bans (packages/ui tokens.test.ts via scripts/check-design-bans.sh)"
  if bash "$ROOT/scripts/check-design-bans.sh" > "$RT_OUT/design-bans.log" 2>&1; then ok "design-ban grep passes"; else regress "design-ban grep fails (see $RT_OUT/design-bans.log)"; fi
fi

if [[ $LIVE -eq 1 ]]; then
  section "MODE=live build: enumeration and bundle grep (T-63, T-81, T-85, W10)"
  LPORT="${RT_LIVE_PORT:-3100}"
  LW="$ROOT/tmp/rt-web-live"
  rm -rf "$LW"; mkdir -p "$LW"
  (cd "$WEB" && tar --exclude=./node_modules --exclude='./.next*' --exclude=./test --exclude=./e2e/__screenshots__ -cf - .) | (cd "$LW" && tar -xf -)
  ln -s ../../apps/web/node_modules "$LW/node_modules"
  # Tailwind's automatic source scan follows the node_modules symlink out of the copy (turbopack then refuses a loader
  # "outside configured roots"); pin the scan to the app sources in the COPY only — apps/web is never edited.
  sed -i "s|^@import 'tailwindcss';|@import 'tailwindcss' source(none);\n@source '../app';\n@source '../components';\n@source '../i18n';\n@source '../lib';|" "$LW/app/globals.css"
  if (cd "$LW" && NEXT_PUBLIC_MODE=live NEXT_PUBLIC_API_URL=https://api.recharge.example NEXT_PUBLIC_ANVIL_RPC_URL=https://rpc.invalid \
        NEXT_PUBLIC_PUBLIC_ORIGIN=https://recharge.example NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next build > "$RT_OUT/live-build.log" 2>&1); then
    ok "NEXT_PUBLIC_MODE=live next build (in tmp/rt-web-live)"
    # worst case: the operator's shell still exports the local demo variables when booting live
    (cd "$LW" && MODE=live NEXT_PUBLIC_MODE=live DEMO_WALLET_MNEMONIC='test test test test test test test test test test test junk' \
      PRINT_TOKEN="$PRINT_TOKEN" ./node_modules/.bin/next start -p "$LPORT" -H 127.0.0.1 > "$RT_OUT/live-start.log" 2>&1) & PIDS+=($!)
    if wait_up "http://127.0.0.1:$LPORT/offline" 60; then
      L="http://127.0.0.1:$LPORT"
      code() { curl -s -o "$RT_OUT/live-body.txt" -w '%{http_code}' -m 10 "$@"; }
      c="$(code -X POST "$L/api/demo-wallet" -H 'content-type: application/json' --data '{"role":"sponsor","method":"eth_requestAccounts"}')"
      [[ "$c" == 404 ]] && ok "live: POST /api/demo-wallet → 404 even with DEMO_WALLET_MNEMONIC exported" || regress "live: POST /api/demo-wallet → $c ($(head -c 120 "$RT_OUT/live-body.txt"))"
      c="$(code "$L/api/demo-wallet")"; [[ "$c" == 404 ]] && ok "live: GET /api/demo-wallet → 404" || regress "live: GET /api/demo-wallet → $c"
      for p in /__local/clock /__local/world-proof /__local /api /api/x; do
        c="$(code -X POST "$L$p" -H 'content-type: application/json' --data '{}')"
        [[ "$c" == 404 || "$c" == 405 ]] && ok "live: POST $p → $c" || regress "live: POST $p → $c"
      done
      c="$(code "$L/print/cards")"; [[ "$c" == 404 ]] && ok "live: /print/cards without token → 404" || regress "live: /print/cards → $c"
      c="$(code "$L/verify")"
      grep -q 'Simulated World ID' "$RT_OUT/live-body.txt" && regress "live: /verify HTML offers the Simulated World ID button" || ok "live: /verify has no Simulated World ID button"
      # tooling routes: the component gallery and a counterfeit-ready print sheet with Verhoeff-valid fixture PINs
      tooling=""; for p in /ui /ui/print /ui/print?count=20 /ui/tokens; do c="$(code "$L$p")"; [[ "$c" == 200 ]] && tooling+="$p "; done
      [[ -z "$tooling" ]] && ok "live: /ui tooling routes are not served (RT-W-10 fixed)" || regress "live build serves $tooling(RT-W-10: app/ui/layout.tsx must 404 outside MODE=local)"
      curl -s -D "$RT_OUT/live-headers.txt" -o /dev/null "$L/"
      grep -qi '^x-powered-by' "$RT_OUT/live-headers.txt" && echo "  (info) live responses carry X-Powered-By: Next.js — poweredByHeader: false is cheap hygiene"
    else regress "live next start did not come up (see $RT_OUT/live-start.log)"; fi
    # bundle grep: client chunks AND server output. Key VALUES, the mnemonic and server secret names are a regression;
    # the idkit-core signer CODE (signRequest/signingKeyHex) in a client chunk was RT-W-11 (W2.2, T-81): now a regression.
    keys='ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80|8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba|5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a|test test test test test test test test test test test junk|RP_SIGNING_KEY|WORLD_RP_SIGNING_KEY|OCTROI_SECRET|ESIMACCESS|sk-ant-'
    hits="$(grep -R -l -E "$keys" "$LW/.next/static" "$LW/.next/server" 2>/dev/null | sed "s|$LW/||" | head -5)"
    [[ -z "$hits" ]] && ok "live bundle (.next/static + .next/server): no key, mnemonic, RP key or server-secret name" || regress "live bundle carries a secret: $hits"
    # server-only variable NAMES may appear in .next/server (route handlers read them); never in client chunks
    names="$(grep -R -l -E 'DEMO_WALLET_MNEMONIC|PRINT_TOKEN|PRINT_CARDS_FILE' "$LW/.next/static" 2>/dev/null | head -3)"
    [[ -z "$names" ]] && ok "live client chunks: no server-only variable name (DEMO_WALLET_MNEMONIC, PRINT_TOKEN)" || regress "live client chunks name a server-only variable: $names"
    pt="$(grep -R -l -F "$PRINT_TOKEN" "$LW/.next/static" "$LW/.next/server" 2>/dev/null | head -3)"
    [[ -z "$pt" ]] && ok "live bundle: PRINT_TOKEN value absent" || regress "live bundle carries the PRINT_TOKEN value: $pt"
    signer="$(grep -R -l -E 'signingKeyHex|signRequest expects' "$LW/.next/static" 2>/dev/null | sed "s|$LW/||" | head -3)"
    [[ -z "$signer" ]] && ok "live client chunks: no rp_context signer code (idkit-core signRequest; RT-W-11 fixed)" || regress "RT-W-11: idkit-core signRequest/signingKeyHex ships in $(echo "$signer" | tr '\n' ' ')"
    client_local="$(grep -R -l -E '__local/world-proof|/api/demo-wallet|__RECHARGE_TEST__' "$LW/.next/static" 2>/dev/null | sed "s|$LW/||" | head -5)"
    [[ -z "$client_local" ]] && ok "live client chunks: local-only code compiled out (simulator call, demo-wallet transport, test hook; RT-W-12 fixed)" || regress "RT-W-12: local-only code in the live client bundle: $(echo "$client_local" | tr '\n' ' ')"
    maps="$(find "$LW/.next/static" -name '*.map' | wc -l)"; [[ "$maps" == 0 ]] && ok "live: no client source maps" || regress "live: $maps client source maps published"
    if bash "$TOOLS/scan.sh" "$LW/.next/static" > "$RT_OUT/live-scan.txt" 2>&1; then ok "forbidden-pattern scan of the live .next/static is clean"; else regress "scan.sh .next/static (see $RT_OUT/live-scan.txt)"; fi
  else regress "live build failed (see $RT_OUT/live-build.log)"; fi
fi

echo
echo "wave3-web: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
