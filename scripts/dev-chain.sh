#!/usr/bin/env bash
# Starts Anvil (chain 31337, deterministic accounts, 1 s blocks) and broadcasts packages/contracts/script/Deploy.s.sol
# against it. Anvil keeps running in the foreground; Ctrl-C stops it.
#
#   pnpm dev:chain                 # defaults
#   ANVIL_PORT=8546 pnpm dev:chain # another port
#   pnpm dev:chain -- --no-mining  # extra flags go to anvil
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS="$ROOT/packages/contracts"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

PORT="${ANVIL_PORT:-8545}"
RPC_URL="http://127.0.0.1:${PORT}"
MNEMONIC="${ANVIL_MNEMONIC:-test test test test test test test test test test test junk}"
# Anvil's account #0 for the default mnemonic; public, never fund it anywhere else.
DEPLOYER_PRIVATE_KEY="${DEPLOYER_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"

for tool in anvil cast forge; do
  command -v "$tool" >/dev/null 2>&1 || { echo "dev-chain: $tool not found (install Foundry)" >&2; exit 1; }
done
[[ -d "$CONTRACTS/lib/forge-std" ]] || (cd "$CONTRACTS" && pnpm run deps)

anvil --chain-id 31337 --port "$PORT" --block-time 1 --mnemonic "$MNEMONIC" --silent "$@" &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 100); do
  if cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1 || { echo "dev-chain: anvil did not come up on $RPC_URL" >&2; exit 1; }

echo "dev-chain: anvil on $RPC_URL (chain 31337, mnemonic '$MNEMONIC')"
(
  cd "$CONTRACTS"
  CHAIN=31337 ANVIL_RPC_URL="$RPC_URL" forge script script/Deploy.s.sol:Deploy \
    --rpc-url "$RPC_URL" --broadcast --private-key "$DEPLOYER_PRIVATE_KEY"
  # copy the creation tx hashes into deploy/addresses.anvil.json and print it
  CHAIN=31337 node script/fill-deploy-txs.mjs
)
echo "dev-chain: deploy script finished; addresses in packages/contracts/deploy/addresses.anvil.json; anvil keeps running (Ctrl-C to stop)"

wait "$ANVIL_PID"
