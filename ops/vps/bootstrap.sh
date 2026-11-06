#!/usr/bin/env bash
# Recharge VPS bootstrap — Ubuntu 24.04, one command: Node 22 + pnpm 10.28.0 + Caddy, the repo at $REF in /opt/recharge,
# three hardened systemd units (recharge-api, recharge-agent, recharge-web) and HTTPS for $DOMAIN (web) and
# api.$DOMAIN (API). With APP_HOST set, the web app is served on $APP_HOST instead and $DOMAIN only answers a 308 to
# https://$APP_HOST (path and query kept). Idempotent: re-run with a new REF to redeploy. Recipe: ops/vps/README.md.
#
#   DOMAIN=recharge.example REPO_URL=<git url> REF=<sha|branch> sudo -E bash ops/vps/bootstrap.sh   # first run
#   DOMAIN=recharge.ajudiya.com APP_HOST=app.recharge.ajudiya.com ... bootstrap.sh                 # app host
#   REF=<sha> sudo -E bash /opt/recharge/ops/vps/bootstrap.sh                                      # redeploy
#   ... bootstrap.sh --no-systemd   # smoke mode (ops/vps/smoke.sh runs it in docker): no unit or caddy is started; the
#                                   # three commands run in the background from the same env, /healthz and / are
#                                   # curled, then everything is killed. Never use it on the real VPS.
#
# Refuses to run without /etc/recharge/.env or with MODE=local in it (T-85). No secret touches a command line or this
# script's output: systemd reads the file as root (EnvironmentFile=), the `recharge` user cannot open it (0600
# root:recharge), and the web process gets only NEXT_PUBLIC_* + PRINT_TOKEN (/etc/recharge/web.env).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

DOMAIN="${DOMAIN:?DOMAIN is required: the web host (the API is served at api.\$DOMAIN)}"
# optional: the one host the web app is served on; $DOMAIN then redirects there
APP_HOST="${APP_HOST:-}"
REF="${REF:-claude/ethglobal-mumbai-build}"
REPO_URL="${REPO_URL:-}"
APP=/opt/recharge
STATE=/var/lib/recharge
ENV_FILE=/etc/recharge/.env
WEB_ENV=/etc/recharge/web.env
WEB_PORT=3000
DRY=0; [[ "${1:-}" == "--no-systemd" ]] && DRY=1

die() { echo "bootstrap: $*" >&2; exit 1; }
if [[ -n $APP_HOST ]]; then
  [[ $APP_HOST =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "APP_HOST must be a bare lower-case host name (no scheme, port or path)"
  [[ $APP_HOST != "$DOMAIN" && $APP_HOST != "api.$DOMAIN" ]] || die "APP_HOST must differ from DOMAIN and api.\$DOMAIN"
fi
WEB_HOST="${APP_HOST:-$DOMAIN}"
[[ $EUID -eq 0 ]] || die "run as root: sudo -E bash $0"
grep -q '^VERSION_ID="24.04"' /etc/os-release 2>/dev/null || echo "bootstrap: warning: written for Ubuntu 24.04" >&2

# ── 1. the env file: names are checked, values never enter this shell ──────────────────────────────────────────────
[[ -f $ENV_FILE ]] || die "$ENV_FILE is missing: scp the MODE=live .env there first (ops/vps/README.md)"
has() { grep -qE "^$1" "$ENV_FILE"; }
! has 'MODE=local' || die "MODE=local on the VPS is forbidden (T-85): it enables /__local/* and the X-Seed-* hooks"
d="${DOMAIN//./\\.}"
# the browser runs the app on one origin: $DOMAIN, or exactly https://$APP_HOST when set ($DOMAIN only redirects)
cors="CORS_ORIGINS=(.*,)?https://$d(,|$)" origin="NEXT_PUBLIC_PUBLIC_ORIGIN=https://$d/?$"
if [[ -n $APP_HOST ]]; then
  a="${APP_HOST//./\\.}"
  cors="CORS_ORIGINS=https://$a$" origin="NEXT_PUBLIC_PUBLIC_ORIGIN=https://$a$"
fi
for want in 'MODE=live$' 'TRUST_PROXY=1$' 'NEXT_PUBLIC_MODE=live$' "$cors" \
  "NEXT_PUBLIC_API_URL=https://api\.$d/?$" "$origin" \
  "STATE_FILE=$STATE/api/" "AGENT_STATE_DIR=$STATE/agent/?$"; do
  has "$want" || die "$ENV_FILE needs a line matching ^$want (ops/vps/README.md)"
done
! has 'HOST=' || has 'HOST=127\.0\.0\.1$' || die "HOST must be 127.0.0.1 or unset: Caddy is the only public listener (RT-P-01)"
! has 'INVENTORY_FILE=' || has "INVENTORY_FILE=$STATE/api/" || die "INVENTORY_FILE must be under $STATE/api/ (the only path the API can write)"
PORT="$(grep -E '^PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2 | tr -d '"' || true)"; PORT="${PORT:-8787}"

# ── 2. packages: git, curl, node 22 (NodeSource apt repo), pnpm 10.28.0 (corepack is unreliable), caddy (official repo)
apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates curl gnupg git > /dev/null
install -d -m 0755 /etc/apt/keyrings
if [[ "$(node -v 2> /dev/null || true)" != v22.* ]]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main' > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq && apt-get install -y -qq nodejs > /dev/null
fi
[[ "$(pnpm -v 2> /dev/null || true)" == 10.28.0 ]] || npm install -g --no-fund --no-audit --loglevel=error pnpm@10.28.0
if ! command -v caddy > /dev/null; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy > /dev/null
fi
NODE="$(command -v node)"

# ── 3. user, state dirs, env files ────────────────────────────────────────────────────────────────────────────────
id -u recharge > /dev/null 2>&1 || useradd --system --home-dir "$STATE" --shell /usr/sbin/nologin recharge
install -d -o recharge -g recharge -m 0750 "$STATE" "$STATE/api" "$STATE/agent" "$APP"
chown root:recharge "$ENV_FILE"; chmod 0600 "$ENV_FILE"
# the web process sees only its own names: NEXT_PUBLIC_* (inlined at build time anyway) and the print-route token
(umask 077; grep -E '^(NEXT_PUBLIC_[A-Z0-9_]+|PRINT_TOKEN)=' "$ENV_FILE" > "$WEB_ENV"); chown root:recharge "$WEB_ENV"
as_recharge() { runuser -u recharge -- env HOME="$STATE" CI=1 "$@"; }

# ── 4. the code at $REF (a branch, a tag or a commit reachable from one) ──────────────────────────────────────────
if [[ ! -d $APP/.git ]]; then
  [[ -n $REPO_URL ]] || die "REPO_URL is required for the first clone into $APP"
  as_recharge git clone --quiet "$REPO_URL" "$APP"
fi
cd "$APP"
[[ -z $REPO_URL ]] || as_recharge git remote set-url origin "$REPO_URL"
as_recharge git fetch --quiet --tags --force origin
sha="$(as_recharge git rev-parse --verify --quiet "origin/$REF^{commit}" || as_recharge git rev-parse --verify "$REF^{commit}")"
as_recharge git checkout --quiet --force --detach "$sha"
echo "bootstrap: $APP at $(as_recharge git log -1 --format='%h %s')"

# ── 5. install + build (the contracts package needs forge and ships its ABI committed: not built here) ────────────
mapfile -t pub < <(grep -E '^NEXT_PUBLIC_[A-Z0-9_]+=' "$ENV_FILE")
# apps/web/lib/sponsor.ts statically imports the git-ignored Anvil deploy output (used in MODE=local only and folded
# out of the live bundle); a fresh clone has none, so a zero-address stub satisfies the import. Local never runs here.
addr=packages/contracts/deploy/addresses.anvil.json
[[ -f $addr ]] || as_recharge tee "$addr" > /dev/null <<< '{"_stub":"ops/vps/bootstrap.sh","dataDrop":"0x0000000000000000000000000000000000000000","usdc":"0x0000000000000000000000000000000000000000"}'
as_recharge pnpm install --frozen-lockfile --reporter=append-only
as_recharge "${pub[@]}" pnpm -r --filter '!@ethglobal/contracts' run build

# ── 6. systemd units: systemd reads EnvironmentFile as root; the process runs as recharge with a read-only system
#       (ProtectSystem=strict) and exactly one writable state dir (StateDirectory) ────────────────────────────────
unit() { # name  description  working-dir  env-file  state-subdir  extra-lines  exec...
  local name=$1 desc=$2 dir=$3 envf=$4 state=$5 extra=$6; shift 6
  cat > "/etc/systemd/system/recharge-$name.service" << EOF
[Unit]
Description=Recharge $desc
After=network-online.target
Wants=network-online.target

[Service]
User=recharge
Group=recharge
WorkingDirectory=$dir
EnvironmentFile=$envf
Environment=NODE_ENV=production
ExecStart=$*
Restart=always
RestartSec=3
StateDirectory=$state
$extra
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictRealtime=true
LockPersonality=true
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
EOF
}
unit api 'API (MODE=live; loopback only, Caddy fronts it)' "$APP/services/api" "$ENV_FILE" recharge/api '' "$NODE" dist/index.js
unit agent 'x402 top-up agent' "$APP/services/agent" "$ENV_FILE" recharge/agent '' "$NODE" dist/index.js
unit web 'web (Next.js)' "$APP/apps/web" "$WEB_ENV" '' \
  $'Environment=NODE_OPTIONS=--experimental-require-module\nReadWritePaths=-'"$APP/apps/web/.next/cache" \
  "$APP/apps/web/node_modules/.bin/next" start -p "$WEB_PORT" -H 127.0.0.1

# ── 7. Caddy: HTTPS for every host, upstreams on loopback. Caddy writes X-Forwarded-For; with TRUST_PROXY=1 the API
#       takes its RIGHT-most hop (what Caddy saw) for rate limits and the webhook IP allow-list (basics.ts clientIp).
#       With APP_HOST, $DOMAIN serves the landing page from marketing/site at / (and its assets) and answers a 308
#       to the app host for every other path ({uri} keeps the path and the query): printed cards and old links still
#       land on the app, and the app has one origin for CORS and its own storage.
{
  echo "# written by ops/vps/bootstrap.sh (DOMAIN=$DOMAIN${APP_HOST:+ APP_HOST=$APP_HOST}); edits are overwritten on the next run"
  printf '%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$WEB_HOST" "$WEB_PORT"
  if [[ -n $APP_HOST && -f $APP/marketing/site/index.html ]]; then
    # the marketing landing page at the apex; every other path (printed cards, old links) still 308s to the app
    printf '%s {\n\troot * %s/marketing/site\n\t@landing path / /index.html /assets/* /fonts/* /images/* /favicon*\n\thandle @landing {\n\t\tfile_server\n\t}\n\thandle {\n\t\tredir https://%s{uri} 308\n\t}\n}\n' "$DOMAIN" "$APP" "$APP_HOST"
  elif [[ -n $APP_HOST ]]; then
    printf '%s {\n\tredir https://%s{uri} 308\n}\n' "$DOMAIN" "$APP_HOST"
  fi
  printf 'api.%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT"
} > /etc/caddy/Caddyfile
caddy fmt --overwrite /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null

# ── 8. go ──────────────────────────────────────────────────────────────────────────────────────────────────────────
smoke() { # --no-systemd: the units' commands, run in the background from the same env files; then killed
  local log=/var/tmp/recharge-smoke pids=() body='' code=''
  install -d -m 0700 "$log"
  spawn() { # name  env-file  dir  cmd... — root sources the env file, then drops to recharge: no secret on a command line
    local name=$1 envf=$2 dir=$3; shift 3
    # shellcheck source=/dev/null
    (set -a; . "$envf"; set +a; export HOME="$STATE" NODE_ENV=production; cd "$dir"
      exec runuser -u recharge --preserve-environment -- "$@") > "$log/$name.log" 2>&1 &
    pids+=("$!")
  }
  trap 'kill "${pids[@]}" 2> /dev/null || true' EXIT
  spawn api "$ENV_FILE" "$APP/services/api" "$NODE" dist/index.js
  spawn agent "$ENV_FILE" "$APP/services/agent" "$NODE" dist/index.js
  spawn web "$WEB_ENV" "$APP/apps/web" env NODE_OPTIONS=--experimental-require-module \
    "$APP/apps/web/node_modules/.bin/next" start -p "$WEB_PORT" -H 127.0.0.1
  for _ in $(seq 1 90); do
    body="$(curl -s "http://127.0.0.1:$PORT/healthz" || true)"; [[ $body == *'"mode":"live"'* ]] && break; sleep 1
  done
  [[ $body == *'"mode":"live"'* ]] || { echo "smoke: no MODE=live /healthz after 90 s:"; (grep -E '✖|Error|error' "$log/api.log" || tail -5 "$log/api.log") | cut -c1-200 | head -20; exit 1; }
  echo "smoke: api   GET /healthz → $body"
  for _ in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/" || true)"; [[ $code == 200 ]] && break; sleep 1
  done
  [[ $code == 200 ]] || { echo "smoke: web did not answer / (last status '$code'):"; tail -20 "$log/web.log"; exit 1; }
  echo "smoke: web   GET / → $code"
  sleep 5
  if kill -0 "${pids[1]}" 2> /dev/null; then echo "smoke: agent running"; else
    echo "smoke: agent exited (expected with placeholder Hedera/Arkiv credentials):"
    (grep -E 'ConfigError|Error|error' "$log/agent.log" || tail -3 "$log/agent.log") | cut -c1-200 | head -5 || true
  fi
  # the units through a real systemd parser (the container has none until now; nothing is started)
  apt-get install -y -qq --no-install-recommends systemd > /dev/null
  systemd-analyze verify /etc/systemd/system/recharge-api.service /etc/systemd/system/recharge-agent.service /etc/systemd/system/recharge-web.service
  echo "smoke: units in /etc/systemd/system/recharge-{api,agent,web}.service verified, /etc/caddy/Caddyfile valid; stopping"
}
if [[ $DRY -eq 1 ]]; then smoke; exit 0; fi

systemctl daemon-reload
systemctl enable --quiet --now caddy
systemctl reload-or-restart caddy
systemctl enable --quiet recharge-api recharge-agent recharge-web
systemctl restart recharge-api recharge-agent recharge-web
sleep 5
systemctl --no-pager --plain --no-legend list-units 'recharge-*' caddy.service
echo
echo "web   https://$WEB_HOST"
[[ -z $APP_HOST ]] || echo "      https://$DOMAIN/<path> → 308 → https://$APP_HOST/<path>"
echo "api   https://api.$DOMAIN/healthz"
echo "logs  journalctl -u recharge-api -f"
