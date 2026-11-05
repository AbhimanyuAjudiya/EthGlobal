#!/usr/bin/env bash
# The check for ops/vps/bootstrap.sh: runs it with --no-systemd inside a throwaway ubuntu:24.04 container against a FAKE
# MODE=live env (random 32-byte secrets, every URL a dead local port — the shape of security/redteam/wave3-ops/live-env.sh).
# Proves the apt/node/pnpm steps, the frozen install, the build, the unit files, the Caddyfile and a MODE=live /healthz
# and / answer. Nothing leaves the box except apt and the npm registry. Needs docker. A second run is the redeploy path
# (the two named volumes keep /opt/recharge and the pnpm store).
#   bash ops/vps/smoke.sh            # ≈ 10 min the first time
#   bash ops/vps/smoke.sh --fresh    # drop the volumes first
#   APP_HOST=app.recharge.example.com bash ops/vps/smoke.sh   # the app-host layout ($DOMAIN redirects there)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOMAIN=recharge.example.com
APP_HOST="${APP_HOST:-}"
WEB="https://${APP_HOST:-$DOMAIN}"
[[ "${1:-}" == "--fresh" ]] && docker volume rm -f recharge-smoke-app recharge-smoke-state > /dev/null
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
branch="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
git -C "$ROOT" bundle create --quiet "$tmp/repo.bundle" "$branch"
hex() { printf '0x%s' "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"; }
tok() { head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n'; }
fake_env() { # the MODE=live names from .env.example / ONSITE-RUNBOOK; no real value anywhere
  cat << EOF
MODE=live
PORT=8787
HOST=127.0.0.1
LOG_LEVEL=info
TRUST_PROXY=1
CHAIN=84532
RPC_URL=http://127.0.0.1:9/
DATADROP_ADDRESS=0x90193C961A926261B756D1E5bb255e67ff9498A1
OCTROI_SECRET=$(hex)
SERVER_SEAL_KEY=$(hex)
ATTESTOR_PRIVATE_KEY=$(hex)
RELAYER_PRIVATE_KEY=$(hex)
TREASURY_PRIVATE_KEY=$(hex)
ARKIV_PRIVATE_KEY=$(hex)
PAYOUT_ADDRESS=0x1111111111111111111111111111111111111111
X402_NETWORKS=eip155:84532
X402_FACILITATOR=remote
X402_FACILITATOR_URL_EVM=http://localhost:9/
RESELLER=esimaccess
RESELLER_FALLBACK=none
ESIMACCESS_ACCESS_CODE=$(tok)
ESIMACCESS_WEBHOOK_TOKEN=$(tok)
ESIMACCESS_BASE_URL=http://127.0.0.1:9/
WORLD_APP_ID=app_abc123
WORLD_RP_ID=rp_abc123
WORLD_RP_SIGNING_KEY=$(hex)
WORLD_VERIFY_BASE_URL=http://127.0.0.1:9/
ARKIV_CHAIN_ID=7794095
ARKIV_RPC_URL=http://127.0.0.1:9/
ARKIV_ACCESS_KEY=$(tok)
HEDERA_ACCOUNT_ID=0.0.5005
HEDERA_PRIVATE_KEY=$(hex)
HCS_TOPIC_ID=0.0.6006
HEDERA_MIRROR_URL=http://127.0.0.1:9/
ENS_RPC_URL=http://127.0.0.1:9/
CORS_ORIGINS=$WEB
STATE_FILE=/var/lib/recharge/api/state.json
PRINT_TOKEN=$(tok)
AGENT_API_URL=http://127.0.0.1:8787
AGENT_PAYTO_ALLOWLIST='hedera:testnet|0.0.429274|0.0.7007|0.0.9185802'
AGENT_OWNER=0x2222222222222222222222222222222222222222
AGENT_LEDGER_WRITER=0x3333333333333333333333333333333333333333
AGENT_HEDERA_ACCOUNT_ID=0.0.8008
AGENT_HEDERA_PRIVATE_KEY=$(hex)
AGENT_STATE_DIR=/var/lib/recharge/agent
NEXT_PUBLIC_MODE=live
NEXT_PUBLIC_API_URL=https://api.$DOMAIN
NEXT_PUBLIC_PUBLIC_ORIGIN=$WEB
NEXT_PUBLIC_WORLD_APP_ID=app_abc123
EOF
}
docker run --rm -i \
  -v "$tmp/repo.bundle:/src/repo.bundle:ro" -v "$ROOT/ops/vps/bootstrap.sh:/src/bootstrap.sh:ro" \
  -v recharge-smoke-app:/opt/recharge -v recharge-smoke-state:/var/lib/recharge \
  -e DOMAIN="$DOMAIN" -e APP_HOST="$APP_HOST" -e REPO_URL=/src/repo.bundle -e REF="$branch" \
  ubuntu:24.04 bash -c 'install -d -m 0700 /etc/recharge && cat > /etc/recharge/.env && exec bash /src/bootstrap.sh --no-systemd' < <(fake_env)
