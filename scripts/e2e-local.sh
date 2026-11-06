#!/usr/bin/env bash
# The MODE=local real-stack loop (BUILD-PLAN §4): Anvil 31337 (1 s blocks) + Deploy.s.sol via scripts/dev-chain.sh, the
# API with X402_FACILITATOR=self RESELLER=mock (real EIP-3009 settlement on MockUSDC3009, real DataDrop.claim), the demo
# seed (scripts/demo-seed.ts), the agent's --once pass against that API (scripts/e2e-agent.ts, I-10), then the headless
# flow services/api/scripts/e2e-flow.ts (I-0…I-18), the ledger dump and a forbidden-pattern scan of every log the run
# wrote. Exits non-zero on the first failed step; prints one PASS/FAIL line per step and the elapsed time.
#
#   bash scripts/e2e-local.sh                 # ports 8546 (anvil) / 8788 (api); output in .e2e/<run-id>/ (git-ignored)
#   bash scripts/e2e-local.sh --web           # + Playwright (apps/web/e2e) against the same stack, when it exists
#   bash scripts/e2e-local.sh --redteam       # + security/redteam/run-wave.sh 3 (non-blocking in CI until R3 says so)
#   bash scripts/e2e-local.sh --keep          # leave the stack up afterwards (Ctrl-C, or `stop`, ends it)
#   bash scripts/e2e-local.sh stop            # reap every stack a previous run (or pnpm demo) left behind
#   E2E_FAULT=1 bash scripts/e2e-local.sh     # the test of the test: I-10 fails with "[E2E_FAULT planted]" ⇒ exit 1
#   E2E_ANVIL_PORT=8547 E2E_API_PORT=8789 bash scripts/e2e-local.sh
#
# Process hygiene (RT-P-02): SIGKILL cannot be trapped, so the EXIT trap is not the only reaper. Every long-lived
# process (dev-chain.sh + Anvil, the API) starts in its own session/process group (setsid; `set -m` where setsid is
# missing, e.g. macOS); the groups are listed in .e2e/pids/e2e-<chain>-<api>.pids; a detached watchdog reaps them the
# moment this shell disappears, however it died; and the next run on the same ports first reaps that pid file and any
# stale Recharge listener still holding the ports. Each run writes to its own .e2e/<run-id>/ (E2E_OUT), with
# .e2e/latest pointing at it, so concurrent runs on different ports never share or truncate each other's files.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../scripts/lib/gnu-path.sh" 2>/dev/null || true  # macOS GNU grep/timeout
umask 077 # logs, seed PINs/keys and the audit key: owner-only (RT-P-11)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="$ROOT/services/api"
E2E_ROOT="$ROOT/.e2e"
PID_DIR="$E2E_ROOT/pids"
CHAIN_PORT="${E2E_ANVIL_PORT:-8546}"
API_PORT="${E2E_API_PORT:-8788}"
RPC_URL="http://127.0.0.1:${CHAIN_PORT}"
API_URL="http://127.0.0.1:${API_PORT}"
TSX="$API/node_modules/.bin/tsx"
SCRIPTS_TSX="$ROOT/scripts/node_modules/.bin/tsx"
PIDFILE="$PID_DIR/e2e-${CHAIN_PORT}-${API_PORT}.pids"
# what a stale listener must look like before this script kills it (anything else on the port is an error)
OURS='anvil --chain-id 31337|dev-chain\.sh|src/index\.ts|tsx/dist|next-server|next (dev|start)'

# ── process-group helpers (kept in this file: the red team runs a copy of it in an isolated root) ──────────────────
listeners() { # $1 port → pids listening on it (lsof, else fuser)
  if command -v lsof >/dev/null 2>&1; then lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null || true
  elif command -v fuser >/dev/null 2>&1; then fuser -n tcp "$1" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true
  fi
}
group_alive() { kill -0 -- "-$1" 2>/dev/null; }
reap_groups() { # $@ pgids: TERM, up to 2 s grace, then KILL
  local g alive
  for g in "$@"; do kill -TERM -- "-$g" 2>/dev/null || true; done
  for _ in $(seq 1 20); do
    alive=0
    for g in "$@"; do group_alive "$g" && alive=1; done
    [[ $alive == 0 ]] && return 0
    sleep 0.1
  done
  for g in "$@"; do kill -KILL -- "-$g" 2>/dev/null || true; done
}
reap_pidfile() { # $1 pid file (lines: "# owner <pid>", then "<pgid> <name>")
  [[ -f "$1" ]] || return 0
  local groups owner
  owner="$(awk '/^# owner [0-9]+$/ {print $3; exit}' "$1")"
  if [[ -n "$owner" && "$owner" != "$$" ]] && kill -0 "$owner" 2>/dev/null && [[ "${2:-}" != force ]]; then
    echo "e2e-local: $(basename "$1") belongs to run $owner, which is still alive — not reaping it" >&2
    return 1
  fi
  groups="$(awk '$1 ~ /^[0-9]+$/ {print $1}' "$1")"
  # shellcheck disable=SC2086
  [[ -n "$groups" ]] && reap_groups $groups
  rm -f "$1"
}
live_owner() { # $1 pgid → the pid of a still-running e2e-local/harness run that recorded it (empty if none)
  local f owner
  for f in "$PID_DIR"/*.pids; do
    [[ -f "$f" ]] || continue
    owner="$(awk '/^# owner [0-9]+$/ {print $3; exit}' "$f")"
    [[ -z "$owner" && "$(basename "$f")" =~ ^harness-([0-9]+)\.pids$ ]] && owner="${BASH_REMATCH[1]}"
    [[ -n "$owner" && "$owner" != "$$" ]] && kill -0 "$owner" 2>/dev/null && awk -v g="$1" '$1 == g {f=1} END {exit !f}' "$f" && { echo "$owner"; return 0; }
  done
  return 0
}
free_port() { # $1 port: kill a stale Recharge listener's process group; refuse to touch anything else
  local pid args pgid owner
  for pid in $(listeners "$1"); do
    args="$(ps -o args= -p "$pid" 2>/dev/null || true)"
    [[ -z "$args" ]] && continue
    if ! grep -qE "$OURS" <<<"$args"; then
      echo "e2e-local: port $1 is held by pid $pid (${args%% *}), not a Recharge stack — stop it or pick E2E_*_PORT" >&2
      return 1
    fi
    pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
    owner="$(live_owner "$pgid")"
    if [[ -n "$owner" ]]; then
      echo "e2e-local: port $1 belongs to a run that is still alive (pid $owner) — wait for it, stop it, or pick E2E_*_PORT" >&2
      return 1
    fi
    echo "e2e-local: reaping a stale listener on :$1 (pid $pid, group $pgid: ${args%% *})" >&2
    if [[ -n "$pgid" && "$pgid" != "$(ps -o pgid= -p $$ | tr -d ' ')" ]]; then reap_groups "$pgid"; else kill "$pid" 2>/dev/null || true; fi
  done
  for _ in $(seq 1 30); do [[ -z "$(listeners "$1")" ]] && return 0; sleep 0.1; done
  echo "e2e-local: port $1 is still in use" >&2
  return 1
}
spawn_group() { # $1 name, $2 log, rest: command — runs it as a new process-group leader and records the group
  local name="$1" log="$2" pid
  shift 2
  if command -v setsid >/dev/null 2>&1; then
    setsid "$@" >"$log" 2>&1 </dev/null &
    pid=$!
  else
    set -m
    "$@" >"$log" 2>&1 </dev/null &
    pid=$!
    set +m
  fi
  # setsid execs in place (a background job is never a group leader), so pgid == pid once it has run
  for _ in $(seq 1 50); do [[ "$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')" == "$pid" ]] && break; sleep 0.02; done
  echo "$pid $name" >>"$PIDFILE"
  SPAWNED=$pid
}
start_watchdog() { # a detached reaper that outlives SIGKILL of this shell
  local src
  src="$(declare -f group_alive reap_groups reap_pidfile)"
  # shellcheck disable=SC2016
  local body='while kill -0 "$1" 2>/dev/null && [[ -f "$2" ]]; do sleep 0.5; done; reap_pidfile "$2"'
  if command -v setsid >/dev/null 2>&1; then
    setsid bash -c "$src; $body" e2e-watchdog "$$" "$PIDFILE" >/dev/null 2>&1 </dev/null &
  else
    set -m
    bash -c "$src; $body" e2e-watchdog "$$" "$PIDFILE" >/dev/null 2>&1 </dev/null &
    set +m
  fi
  WATCHDOG_PID=$!
}

if [[ "${1:-}" == "stop" ]]; then
  # every stack this script or scripts/lib/harness.ts (pnpm demo, print-cards) recorded, then the usual ports
  for f in "$PID_DIR"/*.pids; do [[ -f "$f" ]] && { echo "e2e-local: stop $(basename "$f" .pids)"; reap_pidfile "$f" force; }; done
  rc=0
  for p in 8545 8546 8787 8788 "$CHAIN_PORT" "$API_PORT"; do free_port "$p" || rc=1; done
  [[ $rc == 0 ]] && echo "e2e-local: stopped (nothing Recharge is listening on 8545/8546/8787/8788/$CHAIN_PORT/$API_PORT)"
  exit $rc
fi

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

[[ -x "$TSX" ]] || { echo "e2e-local: $TSX missing (install or link services/api dependencies)" >&2; exit 1; }
[[ -x "$SCRIPTS_TSX" ]] || { echo "e2e-local: $SCRIPTS_TSX missing (install or link scripts/ dependencies)" >&2; exit 1; }

START_NS=$(date +%s%N)
elapsed() { echo $(( ($(date +%s%N) - START_NS) / 1000000 )); }

# per-run output (RT-P-02): .e2e/<run-id>/, .e2e/latest → it; the 10 newest runs are kept
mkdir -p "$E2E_ROOT" "$PID_DIR"
chmod 700 "$E2E_ROOT" "$PID_DIR"
# files an older run (or an older script) left world-readable: PINs, keys and the audit key become owner-only
find "$E2E_ROOT" -maxdepth 1 -type f ! -perm 600 -exec chmod 600 {} + 2>/dev/null || true
RUN_ID="${E2E_RUN_ID:-run-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
[[ "$RUN_ID" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "e2e-local: E2E_RUN_ID must be [A-Za-z0-9._-]+" >&2; exit 2; }
OUT="${E2E_OUT:-$E2E_ROOT/$RUN_ID}"
mkdir -p "$OUT"
ln -sfn "$OUT" "$E2E_ROOT/latest"
# shellcheck disable=SC2012
ls -1dt "$E2E_ROOT"/run-* 2>/dev/null | tail -n +11 | while read -r old; do [[ "$old" != "$OUT" ]] && rm -rf "$old"; done
export E2E_OUT="$OUT"

# 0. a previous run on these ports that died without cleanup (SIGKILL, OOM, a CI timeout): reap it first;
#    a run that is still alive keeps its ports (refused, never killed)
reap_pidfile "$PIDFILE" || exit 1
free_port "$CHAIN_PORT"
free_port "$API_PORT"

CHAIN_PID=""
API_PID=""
WATCHDOG_PID=""
cleanup() {
  reap_pidfile "$PIDFILE" force
  [[ -n "$WATCHDOG_PID" ]] && kill "$WATCHDOG_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM
echo "# owner $$" >"$PIDFILE"
start_watchdog

# 1. chain + contracts (the one harness for anvil + deploy: scripts/dev-chain.sh)
spawn_group chain "$OUT/chain.log" env ANVIL_PORT="$CHAIN_PORT" bash "$ROOT/scripts/dev-chain.sh"
CHAIN_PID=$SPAWNED
for _ in $(seq 1 600); do
  grep -q "deploy script finished" "$OUT/chain.log" && break
  kill -0 "$CHAIN_PID" 2>/dev/null || { cat "$OUT/chain.log" >&2; echo "e2e-local: dev-chain exited" >&2; exit 1; }
  sleep 0.1
done
grep -q "deploy script finished" "$OUT/chain.log" || { tail -20 "$OUT/chain.log" >&2; echo "e2e-local: deploy timed out" >&2; exit 1; }
echo "PASS setup: anvil on $RPC_URL, contracts deployed ($(elapsed) ms)"

# 2. the API (local mode: Anvil + mocks, self-run facilitator; no other network). HOST stays loopback (RT-P-01).
# shellcheck disable=SC2016
spawn_group api "$OUT/api.log" bash -c 'cd "$0" && exec "$@"' "$API" env MODE=local HOST=127.0.0.1 X402_FACILITATOR=self RESELLER=mock \
  CORS_ORIGINS="${CORS_ORIGINS:-http://127.0.0.1:${PLAYWRIGHT_WEB_PORT:-3000},http://localhost:${PLAYWRIGHT_WEB_PORT:-3000}}" \
  ANVIL_RPC_URL="$RPC_URL" PORT="$API_PORT" LOG_LEVEL=info TRUST_PROXY=1 CAMPAIGN_ID= \
  WORLD_AGENT_PASS_CLIENT_ID=simulated WORLD_AGENT_PASS_CLIENT_SECRET="${E2E_AGENT_PASS_SECRET:-e2e-simulated}" "$TSX" src/index.ts
API_PID=$SPAWNED
for _ in $(seq 1 300); do
  curl -fsS "$API_URL/healthz" >/dev/null 2>&1 && break
  kill -0 "$API_PID" 2>/dev/null || { cat "$OUT/api.log" >&2; echo "e2e-local: api exited" >&2; exit 1; }
  sleep 0.1
done
curl -fsS "$API_URL/healthz" | grep -q '"chainId":31337' || { tail -20 "$OUT/api.log" >&2; echo "e2e-local: api not healthy" >&2; exit 1; }
echo "PASS setup: api on $API_URL ($(elapsed) ms)"

export API_URL RPC_URL
# 3. the demo seed (sponsor-scoped campaign, three tiers, a gift to rahul.eth, ten cards, an agent policy)
if "$SCRIPTS_TSX" "$ROOT/scripts/demo-seed.ts" --reset --quiet >"$OUT/seed.log" 2>&1; then
  echo "PASS seed: campaign funded on Anvil, 3 entitlements, gift, 10 cards, agent policy ($(elapsed) ms)"
else
  cat "$OUT/seed.log"; echo "FAIL seed (demo-seed.ts)"; exit 1
fi

# 3b. I-21 World ID Agent Pass (docs/WORLD_AGENT_PASS.md) against the simulated World IdP (MODE=local only): a denied
# and an expired checkpoint leave the agent's top-up refused with 403 pass_required BEFORE any 402; then the next
# attempt is scripted to approve, so the I-10 agent below hits 403, runs the checkpoint, is approved and buys once.
PAID_KEY="$(grep -o '"paid": *"[^"]*"' "$OUT/keys.json" | head -1 | sed 's/.*: *"//; s/"$//')"
[[ -n "$PAID_KEY" ]] || { echo "FAIL I-21 agent pass: no paid key in $OUT/keys.json"; exit 1; }
PAID_KEY_ENC="${PAID_KEY//:/%3A}"
PASS_URL="$API_URL/agent/policy/$PAID_KEY_ENC/pass"
pass_round() { # $1 outcome the simulator follows for the next attempt → prints the poll answer
  curl -fsS -X POST -H 'content-type: application/json' --data "{\"outcome\":\"$1\"}" "$API_URL/__local/agent-pass" >/dev/null \
    || { echo "FAIL I-21 agent pass: could not script $1"; exit 1; }
  curl -fsS -X POST "$PASS_URL/start" | grep -q '"user_code"' || { echo "FAIL I-21 agent pass: start ($1)"; exit 1; }
  curl -fsS -X POST "$PASS_URL/poll"
}
agent_topup_status() { curl -sS -o /dev/null -w '%{http_code}' -H 'X-Agent-Uaid: uaid:aid:e2e' "$API_URL/esim/topup?key=$PAID_KEY_ENC&mb=1000"; }
pass_round deny | grep -q '"state":"denied"' || { echo "FAIL I-21 agent pass: deny did not end as denied"; exit 1; }
STATUS="$(agent_topup_status)"
[[ "$STATUS" == 403 ]] || { echo "FAIL I-21 agent pass: agent top-up after deny answered $STATUS, want 403 pass_required"; exit 1; }
pass_round expire | grep -q '"state":"expired"' || { echo "FAIL I-21 agent pass: expire did not end as expired"; exit 1; }
STATUS="$(agent_topup_status)"
[[ "$STATUS" == 403 ]] || { echo "FAIL I-21 agent pass: agent top-up after expiry answered $STATUS, want 403 pass_required"; exit 1; }
curl -fsS -X POST -H 'content-type: application/json' --data '{"outcome":"approve"}' "$API_URL/__local/agent-pass" >/dev/null \
  || { echo "FAIL I-21 agent pass: could not script approve"; exit 1; }
echo "PASS I-21 agent pass (simulated World IdP): deny → denied + 403, expire → expired + 403, approve scripted for I-10 ($(elapsed) ms)"

# 4. I-10: the agent's --once pass against this API (before the flow's time travel ages the seeded plan); with the
# simulated Agent Pass on, its first buy is 403 pass_required, the checkpoint approves at the first poll, then it buys
"$SCRIPTS_TSX" "$ROOT/scripts/e2e-agent.ts"

# 5. the flow, headless (I-0…I-18)
(cd "$API" && API_LOG="$OUT/api.log" "$TSX" scripts/e2e-flow.ts)

# 6. the ledger as the API holds it (local-only route), for the red team's scan (BUILD-PLAN §4 I-18)
"$SCRIPTS_TSX" "$ROOT/scripts/dump-ledger.ts" --out "$OUT/ledger-dump.json" >/dev/null
echo "PASS ledger dump: $OUT/ledger-dump.json ($(elapsed) ms)"

# 7. I-18 for every process: the red team's forbidden-pattern list over every log and dump this run wrote (RT-P-07)
mapfile -t SCANNED < <(find "$OUT" -type f \( -name '*.log' -o -name 'ledger-dump.json' \) ! -name scan.log | sort)
if bash "$ROOT/security/redteam/tools/scan.sh" "${SCANNED[@]}" >"$OUT/scan.log" 2>&1; then
  echo "PASS I-18 forbidden-pattern scan of ${#SCANNED[@]} files in ${OUT#"$ROOT"/} ($(printf '%s ' "${SCANNED[@]##*/}"))"
else
  cat "$OUT/scan.log"; echo "FAIL I-18 forbidden-pattern scan"; exit 1
fi

# 8. optional: the web suite and the red-team wave
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

echo "e2e-local: all steps passed in $(elapsed) ms (output: ${OUT#"$ROOT"/})"
if [[ "$KEEP" == 1 ]]; then
  echo "e2e-local: --keep — anvil $RPC_URL, api $API_URL; Ctrl-C (or bash scripts/e2e-local.sh stop) stops both"
  wait "$API_PID"
fi
