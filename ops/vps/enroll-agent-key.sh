#!/usr/bin/env bash
# Enroll a paid plan in the live top-up agent (services/agent/README.md: live watches AGENT_WATCH_KEYS only, and pays
# only under policies signed by AGENT_OWNER). Puts the plan's entitlement key in AGENT_WATCH_KEYS and its payer wallet
# in AGENT_OWNER — in .env.vps (laptop, so the next deploy keeps it) and /etc/recharge/.env (box) — then restarts
# recharge-agent. Keys of other payers are dropped from the list (they would only log `not-mine`).
#   bash ops/vps/enroll-agent-key.sh 'https://app.recharge.ajudiya.com/plan/paid%3A0x…%3A0x…'   # the plan's
#   "Open on another device" link, or the bare `paid:<payer>:<nonce>` key. DRY=1 edits .env.vps only.
set -euo pipefail
IP="${IP:-13.202.231.9}"; KEY="${KEY:-$HOME/.ssh/recharge-live.pem}"; ENV_FILE="${ENV_FILE:-$PWD/.env.vps}"
[[ $# -eq 1 ]] || { echo "usage: $0 '<plan link or entitlement key>'"; exit 2; }
[[ -w "$ENV_FILE" ]] || { echo "env file $ENV_FILE missing"; exit 2; }
raw="${1##*/plan/}"; raw="${raw%%\?*}"; raw="${raw%%#*}"
plan="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote(sys.argv[1]).strip())' "$raw")"
[[ "$plan" =~ ^paid:(0x[0-9a-fA-F]{40}):0x[0-9a-fA-F]+$ ]] || { echo "not a paid plan key (${plan:0:10}…): only paid plans can enroll an agent"; exit 2; }
owner="${BASH_REMATCH[1]}"; owner_lc="$(printf '%s' "$owner" | tr '[:upper:]' '[:lower:]')"
current="$(grep -E '^AGENT_WATCH_KEYS=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d "'\"" || true)"
keys="$plan"; IFS=',' read -r -a old <<< "$current"
for k in "${old[@]:-}"; do [[ -n "$k" && "$k" != "$plan" && "$k" == "paid:$owner_lc:"* ]] && keys="$keys,$k"; done
# the values travel on stdin (never on a command line), the same snippet edits both files
PY='import sys,re
path=sys.argv[1]; keys,owner=[l.rstrip("\n") for l in sys.stdin.readlines()[:2]]
s=open(path).read()
def put(s,name,val):
    return re.sub(rf"^{name}=.*$", f"{name}={val}", s, count=1, flags=re.M) if re.search(rf"^{name}=", s, re.M) else s.rstrip("\n")+f"\n{name}={val}\n"
open(path,"w").write(put(put(s,"AGENT_WATCH_KEYS",keys),"AGENT_OWNER",owner))'
printf '%s\n%s\n' "$keys" "$owner" | python3 -c "$PY" "$ENV_FILE"
digest="$(printf '%s' "$plan" | shasum -a 256 | cut -c1-16)"
echo "laptop: $ENV_FILE now watches $(tr ',' '\n' <<< "$keys" | grep -c .) key(s) for owner $owner (plan sha256 $digest…)"
[[ "${DRY:-0}" == 1 ]] && { echo "DRY=1: box untouched"; exit 0; }
printf '%s\n%s\n' "$keys" "$owner" | ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "ubuntu@$IP" \
  "sudo python3 -c '$PY' /etc/recharge/.env && sudo systemctl restart recharge-agent && sleep 8 && sudo journalctl -u recharge-agent -n 3 --no-pager -o cat | cut -c1-200"
echo "box: enrolled and recharge-agent restarted; the lines above are its first ticks (expect verdict ok/threshold, not not-mine)"
