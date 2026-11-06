#!/usr/bin/env bash
# ENSv2 Sepolia feasibility spike: one name per sponsor campaign under re-charge.eth.
# Usage: scripts/ens/spike.sh <step>   (steps below, run in order; each logs tx hash + gas)
# Needs: KEYSTORE + PASSWORD_FILE (registrar/API signer), SPONSOR_KEYSTORE + SPONSOR_PASSWORD_FILE
# (throwaway "sponsor"), optional RPC. No secrets live in this file.
set -euo pipefail

RPC=${RPC:-https://ethereum-sepolia-rpc.publicnode.com}
STATE=${STATE:-${TMPDIR:-/tmp}/ens-spike.state}   # commit secret + deployed addresses
LOG=${LOG:-${TMPDIR:-/tmp}/ens-spike.log}          # "step | tx hash | gas | status" lines
touch "$STATE" "$LOG"
# shellcheck disable=SC1090
source "$STATE"

# ENSv2 Sepolia (contracts-v2 @07e55a0, deployments/sepolia, deployed 2026-10-01)
ETH_REGISTRAR=0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3
ETH_REGISTRY=0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4
FACTORY=0xda70306c98e97ece36f997a21368e53298572991
USER_REGISTRY_IMPL=0x9bd8a88719068d09ecee662f36c0e3856708366a
RESOLVER_IMPL=0x115eb53f0c60696633855f90b138178fb40b2b2c
MOCK_USDC=0x240b0316df57887dbbe58b586508b19e633a14aa

PARENT=re-charge
CAMPAIGN=spike
NAME=$CAMPAIGN.$PARENT.eth
YEAR=31536000

API=$(cast wallet address --keystore "$KEYSTORE" --password-file "$PASSWORD_FILE")
SPONSOR=$(cast wallet address --keystore "$SPONSOR_KEYSTORE" --password-file "$SPONSOR_PASSWORD_FILE")

# role bitmaps: regular role | (same role << 128 = its _ADMIN)
both() { python3 -c "x=$1; print(hex(x | x << 128))"; }
# UserRegistry root: REGISTRAR 1<<0 | SET_PARENT 1<<8 | UNREGISTER 1<<12 | RENEW 1<<16 | SET_RESOLVER 1<<24
REGISTRY_ROLES=$(both 0x1011101)
# PermissionedResolver root: SET_ADDRESS 1<<0 | SET_TEXT 1<<4 | SET_CONTENTHASH 1<<8 | SET_DATA 1<<24 | LINK 1<<28
RESOLVER_ROLES=$(both 0x11000111)
NAME_ROLES=0   # token roles for the campaign name: none -> no ROLE_CAN_TRANSFER_ADMIN -> non-transferable

dns() { # DNS wire-format name, as PermissionedResolver setters take it
  local out=0x l
  IFS=. read -ra labels <<<"$1"
  for l in "${labels[@]}"; do out+=$(printf %02x ${#l})$(printf %s "$l" | xxd -p | tr -d '\n'); done
  echo "${out}00"
}
save() { echo "$1=$2" >>"$STATE"; eval "$1=$2"; }

send() { # send <label> <signer: api|sponsor> <to> <sig> [args...]  (env GAS_LIMIT forces broadcast of a reverting tx)
  local label=$1 who=$2; shift 2
  local ks=$KEYSTORE pw=$PASSWORD_FILE
  [ "$who" = sponsor ] && ks=$SPONSOR_KEYSTORE pw=$SPONSOR_PASSWORD_FILE
  local out err i
  for i in 1 2 3 4 5; do # load-balanced public RPCs hand out stale nonces right after a tx: retry
    out=$(cast send --json --rpc-url "$RPC" --keystore "$ks" --password-file "$pw" ${GAS_LIMIT:+--gas-limit $GAS_LIMIT} "$@" 2>"$LOG.err") || true
    jq -e .transactionHash <<<"$out" >/dev/null 2>&1 && break
    err=$(cat "$LOG.err")
    grep -qiE 'nonce too low|underpriced' <<<"$err" || { echo "$label FAILED: $err" >&2; exit 1; }
    sleep 4
  done
  local hash gas status
  hash=$(jq -r .transactionHash <<<"$out"); gas=$(cast to-dec "$(jq -r .gasUsed <<<"$out")"); status=$(jq -r .status <<<"$out")
  echo "$label | $hash | gas $gas | status $status" | tee -a "$LOG"
}

case ${1:-} in
fund-usdc) # MockUSDC is free-mint; ETHRegistrar charges ERC20 only
  price=$(cast call $ETH_REGISTRAR 'getRegisterPrice(string,uint64,address)(uint256,uint256)' $PARENT $YEAR $MOCK_USDC --rpc-url "$RPC" | head -1 | cut -d' ' -f1)
  echo "price (USDC 6dp): $price"
  bal=$(cast call $MOCK_USDC 'balanceOf(address)(uint256)' "$API" --rpc-url "$RPC" | cut -d' ' -f1)
  [ "$bal" -ge 10000000 ] || send mint-usdc api $MOCK_USDC 'mint(address,uint256)' "$API" 10000000
  send approve-usdc api $MOCK_USDC 'approve(address,uint256)' $ETH_REGISTRAR 10000000 ;;
commit)
  [ -n "${SECRET:-}" ] || save SECRET "$(cast keccak "$(openssl rand -hex 32)")"
  c=$(cast call $ETH_REGISTRAR 'makeCommitment(string,address,bytes32,address,address,uint64,bytes32)(bytes32)' \
    $PARENT "$API" "$SECRET" 0x0000000000000000000000000000000000000000 0x0000000000000000000000000000000000000000 $YEAR 0x0000000000000000000000000000000000000000000000000000000000000000 --rpc-url "$RPC")
  send commit api $ETH_REGISTRAR 'commit(bytes32)' "$c" ;;
register-parent) # >= 60s after commit (MIN_COMMITMENT_AGE)
  send register-$PARENT.eth api $ETH_REGISTRAR 'register(string,address,bytes32,address,address,uint64,address,bytes32)' \
    $PARENT "$API" "$SECRET" 0x0000000000000000000000000000000000000000 0x0000000000000000000000000000000000000000 $YEAR $MOCK_USDC 0x0000000000000000000000000000000000000000000000000000000000000000 ;;
user-registry) # proxy via VerifiableFactory, API gets root roles, then parent -> subregistry
  salt=$(cast keccak "$PARENT.eth/user-registry")
  addr=$(cast call $FACTORY 'predictProxyAddress(address,uint256)(address)' "$API" "$salt" --rpc-url "$RPC")
  init=$(cast calldata 'initialize((address,uint256)[])' "[($API,$REGISTRY_ROLES)]")
  send deploy-user-registry api $FACTORY 'deployProxy(address,uint256,bytes)' $USER_REGISTRY_IMPL "$salt" "$init"
  save USER_REGISTRY "$addr"
  send set-subregistry api $ETH_REGISTRY 'setSubregistry(uint256,address)' "$(cast keccak $PARENT)" "$USER_REGISTRY" ;;
campaign) # per campaign: (1) resolver proxy with records in its initializer, (2) register the name
  d=$(dns "$NAME")
  calls="[$(cast calldata 'setText(bytes,string,string)' "$d" url "https://app.recharge.ajudiya.com/c/$CAMPAIGN")"
  calls+=",$(cast calldata 'setText(bytes,string,string)' "$d" recharge.campaign 0x0000000000000000000000000000000000000000000000000000000000000001)"
  calls+=",$(cast calldata 'setText(bytes,string,string)' "$d" recharge.pool eip155:296:0x2d4d52989545FF0d0CD91D77A33f14063f57c9E6)"
  calls+=",$(cast calldata 'setText(bytes,string,string)' "$d" recharge.bundle '1 GB · 7 days')]"
  init=$(cast calldata 'initialize((address,uint256)[],bytes[])' "[($API,$RESOLVER_ROLES)]" "$calls")
  salt=$(cast namehash "$NAME")   # API: use keccak(campaignId) so a re-registered label gets a fresh proxy
  addr=$(cast call $FACTORY 'predictProxyAddress(address,uint256)(address)' "$API" "$salt" --rpc-url "$RPC")
  send deploy-resolver+records api $FACTORY 'deployProxy(address,uint256,bytes)' $RESOLVER_IMPL "$salt" "$init"
  save RESOLVER "$addr"
  send register-$NAME api "$USER_REGISTRY" 'register(string,address,address,address,uint256,uint64)' \
    $CAMPAIGN "$SPONSOR" 0x0000000000000000000000000000000000000000 "$RESOLVER" $NAME_ROLES $(($(date +%s) + 2 * 86400)) ;;
sponsor-role) # sponsor may set ONLY text("avatar") on this campaign's resolver
  setter=$(cast calldata 'setText(bytes,string,string)' 0x00 avatar '')   # only selector + key matter
  send grant-avatar-setter api "$RESOLVER" 'grantSetterRoles(bytes,address)' "$setter" "$SPONSOR"
  send fund-sponsor api "$SPONSOR" --value 0.01ether ;;
sponsor-proof)
  d=$(dns "$NAME")
  send sponsor-set-avatar sponsor "$RESOLVER" 'setText(bytes,string,string)' "$d" avatar https://app.recharge.ajudiya.com/icon.png
  GAS_LIMIT=100000 send sponsor-set-url-MUST-REVERT sponsor "$RESOLVER" 'setText(bytes,string,string)' "$d" url https://evil.example ;;
link) # record aliasing: defaults.<parent> shares this resolver; link spike's node to it, then restore
  dd=$(dns "defaults.$PARENT.eth")
  send register-defaults api "$USER_REGISTRY" 'register(string,address,address,address,uint256,uint64)' \
    defaults "$API" 0x0000000000000000000000000000000000000000 "$RESOLVER" 0 $(($(date +%s) + 2 * 86400))
  send defaults-set-terms api "$RESOLVER" 'setText(bytes,string,string)' "$dd" recharge.terms 'https://app.recharge.ajudiya.com/terms'
  send link-spike-to-defaults api "$RESOLVER" 'linkToNode(bytes,bytes32)' "$(dns "$NAME")" "$(cast namehash "defaults.$PARENT.eth")" ;;
unlink)
  send restore-spike-record api "$RESOLVER" 'linkToRecord(bytes,uint256)' "$(dns "$NAME")" 1 ;;
*) echo "steps: fund-usdc commit register-parent user-registry campaign sponsor-role sponsor-proof link unlink"; exit 1 ;;
esac
