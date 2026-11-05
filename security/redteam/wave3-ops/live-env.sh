# shellcheck shell=bash
# A complete, FAKE MODE=live environment (no real key; every RPC points at a dead local port so nothing leaves the box).
# Mirrors services/api/test/deps.live.test.ts FAKE_LIVE. Sourced by live-seed-probe.sh.
k() { local b="$1" s=""; for _ in $(seq 1 32); do s+="$b"; done; printf '0x%s' "$s"; }
LIVE_ENV=(
  MODE=live CHAIN=84532 RPC_URL=http://127.0.0.1:9/ DATADROP_ADDRESS=0x90193C961A926261B756D1E5bb255e67ff9498A1
  OCTROI_SECRET="$(k 21)" SERVER_SEAL_KEY="$(k 22)" ATTESTOR_PRIVATE_KEY="$(k 23)" RELAYER_PRIVATE_KEY="$(k 24)"
  TREASURY_PRIVATE_KEY="$(k 25)" ARKIV_PRIVATE_KEY="$(k 26)" WORLD_RP_SIGNING_KEY="$(k 27)"
  WORLD_RP_ID=rp_abc123 WORLD_APP_ID=app_abc123 PAYOUT_ADDRESS=0x1111111111111111111111111111111111111111
  X402_NETWORKS=eip155:84532 X402_FACILITATOR=remote X402_FACILITATOR_URL_EVM=http://localhost:9/
  RESELLER=esimaccess RESELLER_FALLBACK=none ESIMACCESS_WEBHOOK_TOKEN=a-very-long-webhook-token-0123456789
  ESIMACCESS_ACCESS_CODE=access-code-0123456789 ESIMACCESS_BASE_URL=http://127.0.0.1:9/
  HEDERA_ACCOUNT_ID=0.0.5005 HEDERA_PRIVATE_KEY="$(k 31)" HCS_TOPIC_ID=0.0.6006 HEDERA_MIRROR_URL=http://127.0.0.1:9/
  ENS_RPC_URL=http://127.0.0.1:9/ ARKIV_RPC_URL=http://127.0.0.1:9/ WORLD_VERIFY_BASE_URL=http://127.0.0.1:9/
  TRUST_PROXY=1 LOG_LEVEL=info
)
