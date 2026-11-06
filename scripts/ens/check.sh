#!/usr/bin/env bash
# Gas-free proofs (eth_call) for the spike: sponsor's per-key role, the revert reason, non-transferability.
# Usage: scripts/ens/check.sh <userRegistry> <resolver> <sponsor>
set -uo pipefail
RPC=${RPC:-https://ethereum-sepolia-rpc.publicnode.com}
UREG=$1 RES=$2 SPONSOR=$3
NAME_DNS=0x057370696b650972652d6368617267650365746800   # spike.re-charge.eth
c() { cast call "$@" --rpc-url "$RPC" 2>&1 | tail -1; }
key() { cast to-dec "$(cast keccak "$1")"; }
echo "sponsor ROLE_SET_TEXT on key 'avatar' : $(c "$RES" 'hasRoles(uint256,uint256,address)(bool)' "$(key avatar)" 16 "$SPONSOR")"
echo "sponsor ROLE_SET_TEXT on key 'url'    : $(c "$RES" 'hasRoles(uint256,uint256,address)(bool)' "$(key url)" 16 "$SPONSOR")"
echo "sponsor ROLE_SET_TEXT on root         : $(c "$RES" 'hasRootRoles(uint256,address)(bool)' 16 "$SPONSOR")"
echo "sponsor setText(url) simulated        : $(c "$RES" 'setText(bytes,string,string)' $NAME_DNS url https://evil.example --from "$SPONSOR")"
id=$(c "$UREG" 'getTokenId(uint256)(uint256)' "$(cast keccak spike)" | cut -d' ' -f1)
echo "spike tokenId                         : $id  owner $(c "$UREG" 'ownerOf(uint256)(address)' "$id")"
echo "spike token roles of owner            : $(c "$UREG" 'roles(uint256,address)(uint256)' "$id" "$SPONSOR")"
echo "owner transfer simulated              : $(c "$UREG" 'safeTransferFrom(address,address,uint256,uint256,bytes)' "$SPONSOR" 0x000000000000000000000000000000000000dEaD "$id" 1 0x --from "$SPONSOR")"
echo "owner unsafeTransfer simulated        : $(c "$UREG" 'unsafeTransfer(address,uint256,bytes)' 0x000000000000000000000000000000000000dEaD "$id" 0x --from "$SPONSOR")"
echo "spike record id                       : $(c "$RES" 'getRecordId(bytes32)(uint256)' "$(cast namehash spike.re-charge.eth)")"
echo "defaults record id                    : $(c "$RES" 'getRecordId(bytes32)(uint256)' "$(cast namehash defaults.re-charge.eth)")"
echo "factory verifyContract(resolver)      : $(c 0xda70306c98e97ece36f997a21368e53298572991 'verifyContract(address)(address)' "$RES")"
echo "factory verifyContract(userRegistry)  : $(c 0xda70306c98e97ece36f997a21368e53298572991 'verifyContract(address)(address)' "$UREG")"
echo "ETHRegistry subregistry(re-charge)    : $(c 0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4 'getSubregistry(string)(address)' re-charge)"
echo "ETHRegistry expiry(re-charge)         : $(c 0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4 'findExpiry(string)(uint64)' re-charge)"
echo "ETHRegistry owner(re-charge)          : $(c 0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4 'findOwner(string)(address)' re-charge)"
