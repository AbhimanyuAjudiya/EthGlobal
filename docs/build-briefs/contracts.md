# Build brief — `contracts` (wave 1)

**You are building:** `packages/contracts` — `DataDrop.sol` (sponsor pools that pay the service once per verified human) and `MockUSDC3009.sol` (a 6-decimal test USDC with EIP-3009), with Foundry tests, the deploy script, and the ABI/address artefacts the TypeScript side consumes. Everything runs on Anvil (chain 31337) in the sandbox; humans deploy the same script to Hedera testnet (chain 296) on Wednesday.

**Read first (in this order, nothing else is required):** this brief; `docs/INTERFACES.md` §6 (the interfaces below are copied from it verbatim) and §13; `docs/THREAT-MODEL.md` §5.1–5.2 (T-01…T-17: the properties your tests must prove); the scaffold: `packages/contracts/{README.md,foundry.toml,package.json,deploy/chains.json,script/Deploy.s.sol,test/Deploy.t.sol,src/README.md,test/README.md}`.

**Toolchain:** forge 1.5.1, solc 0.8.30 (static binary in `~/.svm/0.8.30`, `offline = true`), OpenZeppelin 5.7.0 and forge-std 1.17.0 via `pnpm --filter @ethglobal/contracts deps`, slither 0.11.6. Tests: `pnpm test:contracts` (= `forge test`), fuzz 512 runs, invariant 64 runs × depth 32 (already in `foundry.toml`). Formatting: `forge fmt --check` is in CI.

---

## 1. What the contract does in the product

A sponsor funds a **campaign** with USDC. When a human proves personhood to the API, the API's **attestor** key calls `claim(id, claimKey)`; the contract pays `pricePerClaim` USDC to the service's `payout` address and records that `claimKey` so the same human cannot claim twice from this campaign. `claimKey = keccak256(abi.encodePacked(id, campaignClaimKey))` where `campaignClaimKey` is an HMAC pseudonym the API derives — the raw World ID nullifier never reaches the chain. An **hourly cap** bounds what a compromised attestor can drain; the sponsor can **pause**; the attestor can pause but never unpause; the sponsor can **refund** the unspent budget after expiry or after 24 h of pause. On Hedera the contract must **associate** the HTS USDC token before it can hold it; if the HTS ERC-20 facade misbehaves at the Wednesday pre-deploy, the contract is deployed in **`LEDGER_ONLY`** mode (`usdc == address(0)`): same state and events, no token movement (sponsor funds move natively on HTS).

`MockUSDC3009` exists so the x402 "exact" scheme (a signed EIP-3009 `transferWithAuthorization`, relayed by our facilitator) and the shared `@ethglobal/eip3009` TypeScript package are exercised against Circle's exact digest layout on Anvil.

## 2. Files

Create:
```
packages/contracts/src/DataDrop.sol
packages/contracts/src/MockUSDC3009.sol
packages/contracts/src/interfaces/IDataDrop.sol
packages/contracts/src/interfaces/IEIP3009.sol
packages/contracts/src/interfaces/IHederaTokenService.sol       // associateToken(address account, address token) returns (int64) only
packages/contracts/test/DataDrop.t.sol
packages/contracts/test/MockUSDC3009.t.sol
packages/contracts/test/invariant/DataDropInvariant.t.sol
packages/contracts/test/invariant/handlers/DataDropHandler.sol
packages/contracts/test/mocks/ReentrantToken.sol                 // ERC-20 whose transfer re-enters claim/refund
packages/contracts/test/mocks/HtsPrecompileMock.sol              // etched at 0x0000000000000000000000000000000000000167; records calls, returns 22
packages/contracts/test/Vectors.t.sol                            // asserts digests against fixtures/eip3009/vectors.json
packages/contracts/script/EmitVectors.s.sol                      // writes fixtures/eip3009/vectors.json (run by `pnpm vectors`)
packages/contracts/abi/DataDrop.json                             // generated, committed
packages/contracts/abi/MockUSDC3009.json                         // generated, committed
packages/contracts/.gas-snapshot                                 // `forge snapshot`, committed
```
Modify:
```
packages/contracts/script/Deploy.s.sol        // deploy both on Anvil, DataDrop only on live chains; write deploy/addresses.<slug>.json
packages/contracts/test/Deploy.t.sol          // new ChainRecord fields; addresses file written; mode asserted per chain
packages/contracts/deploy/chains.json         // + "usdc", "usdcHts" on every chain (alphabetical keys!)
packages/contracts/foundry.toml               // fs_permissions: write ./deploy, write ./abi, write ../../fixtures/eip3009
packages/contracts/package.json               // scripts: abi, abi:check, vectors, snapshot:check; "exports": {"./abi/*": "./abi/*.json", "./addresses/*": "./deploy/addresses.*.json"}
packages/contracts/README.md                  // commands, modes, Hedera notes
.gitignore                                    // packages/contracts/deploy/addresses.anvil.json
```

## 3. Public interface (verbatim from `docs/INTERFACES.md` §6.1–6.2)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title IDataDrop — sponsor pools that pay the service once per verified human (claimKey), with an hourly cap, pause and refund.
interface IDataDrop {
    struct Campaign {
        address sponsor;        // slot 0
        uint96 pricePerClaim;   // USDC 6-dec; paid to `payout` per claim
        uint128 budget;         // slot 1: USDC pulled at creation (token mode) or declared (LEDGER_ONLY)
        uint128 spent;
        uint32 claimsPerHour;   // slot 2
        uint64 expiresAt;       // unix seconds; no claims at or after
        uint64 pausedSince;     // 0 when not paused; set on false→true, cleared on true→false
        bool paused;
    }

    event ModeSet(bool ledgerOnly);
    event CampaignCreated(bytes32 indexed id, address indexed sponsor, uint128 budget, uint96 pricePerClaim, uint32 claimsPerHour, uint64 expiresAt);
    event Claimed(bytes32 indexed id, bytes32 indexed claimKey, uint96 paid, uint64 hourBucket);
    event Paused(bytes32 indexed id, bool paused, address by);
    event Refunded(bytes32 indexed id, uint128 amount);
    event AttestorSet(address attestor);

    error AlreadyClaimed(); error CampaignPaused(); error CampaignExpired(); error HourlyCap(); error BudgetExhausted();
    error CampaignExists(); error InvalidCampaign(); error NotAttestor(); error NotSponsor(); error NotRefundable(); error NotHedera();

    /// @notice Creates a campaign and (token mode) pulls `budget` USDC from msg.sender. Reverts CampaignExists if `id` is taken,
    ///         InvalidCampaign unless budget ≥ pricePerClaim > 0, claimsPerHour > 0, expiresAt > block.timestamp.
    function createCampaign(bytes32 id, uint128 budget, uint96 pricePerClaim, uint32 claimsPerHour, uint64 expiresAt) external;
    /// @notice onlyAttestor. claimKey = keccak256(abi.encodePacked(id, campaignClaimKey)). Pays pricePerClaim to `payout` (token mode).
    function claim(bytes32 id, bytes32 claimKey) external;
    /// @notice Sponsor may set either value; the attestor may only set `true`; anyone else reverts NotSponsor.
    function pause(bytes32 id, bool paused_) external;
    /// @notice Sponsor only; after expiresAt, or when paused for ≥ 24 h. Transfers budget − spent, then sets budget = spent.
    function refund(bytes32 id) external;
    function setAttestor(address attestor) external;           // owner (Ownable2Step)
    /// @notice Hedera only (chainid 295/296): HTS precompile associateToken(address(this), token). Reverts NotHedera elsewhere.
    function associateHts(address token) external;             // owner

    function claimed(bytes32 id, bytes32 claimKey) external view returns (bool);
    function claimsInHour(bytes32 id, uint64 hourBucket) external view returns (uint32);
    function campaigns(bytes32 id) external view returns (Campaign memory);
    function ledgerOnly() external view returns (bool);        // usdc == address(0)
    function usdc() external view returns (address);
    function payout() external view returns (address);
    function attestor() external view returns (address);
    function currentHourBucket() external view returns (uint64); // block.timestamp / 3600
}
// constructor(IERC20 usdc_, address payout_, address attestor_, address owner_)
```

```solidity
interface IEIP3009 {
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
    function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;
    function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes calldata signature) external;
    function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;
    function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes calldata signature) external;
    function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;
}
// MockUSDC3009: ERC20("USD Coin","USDC"), decimals() == 6, EIP712("USD Coin","2"), open mint(address,uint256) (test token only).
// Typehashes (verbatim): "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)",
// "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)",
// "CancelAuthorization(address authorizer,bytes32 nonce)".
```

## 4. Implementation notes

**DataDrop.sol**
- Inherit `Ownable2Step` (owner = `owner_`), `ReentrancyGuard`; use `SafeERC20` for every token move. `usdc` and `payout` are `immutable`; there is **no** sweep/withdraw/rescue function (T-10). Constructor emits `ModeSet(usdc_ == address(0))` and `AttestorSet(attestor_)`.
- Storage exactly as INTERFACES §5.4 of ARCHITECTURE: `mapping(bytes32 => Campaign) private _campaigns; mapping(bytes32 => mapping(bytes32 => bool)) private _claimed; mapping(bytes32 => mapping(uint64 => uint32)) private _claimsInHour; address public attestor;`.
- `createCampaign`: `if (_campaigns[id].sponsor != address(0)) revert CampaignExists();` `if (budget < pricePerClaim || pricePerClaim == 0 || claimsPerHour == 0 || expiresAt <= block.timestamp) revert InvalidCampaign();` write the struct, then (token mode) `usdc.safeTransferFrom(msg.sender, address(this), budget)` — **reverts** on any failure, never silently degrades (T-09). Emit `CampaignCreated`.
- `claim` (`nonReentrant`, `onlyAttestor`): checks in this order — `sponsor != 0` else `InvalidCampaign`; `paused` → `CampaignPaused`; `block.timestamp >= expiresAt` → `CampaignExpired`; `_claimed[id][claimKey]` → `AlreadyClaimed`; `bucket = uint64(block.timestamp / 3600)`; `_claimsInHour[id][bucket] >= claimsPerHour` → `HourlyCap`; `spent + pricePerClaim > budget` → `BudgetExhausted`. Effects: set claimed, increment bucket, `spent += pricePerClaim`. Interaction last: token mode `usdc.safeTransfer(payout, pricePerClaim)`. Emit `Claimed(id, claimKey, pricePerClaim, bucket)`.
- `pause(id, p)`: `msg.sender == sponsor` → any value; `msg.sender == attestor` → only `p == true` (else `NotSponsor`); others `NotSponsor`. On `false→true` set `pausedSince = block.timestamp`; on `true→false` clear it; no-op transitions still emit `Paused`.
- `refund`: sponsor only; eligible when `block.timestamp >= expiresAt || (paused && block.timestamp - pausedSince >= 24 hours)`; `amount = budget - spent`; `amount == 0` → `NotRefundable`; set `budget = spent` (so `claim` now hits `BudgetExhausted` and a second `refund` hits `NotRefundable`); token mode `safeTransfer(sponsor, amount)`; emit `Refunded`.
- `associateHts(token)`: `onlyOwner`; `if (block.chainid != 295 && block.chainid != 296) revert NotHedera();` call `IHederaTokenService(0x0000000000000000000000000000000000000167).associateToken(address(this), token)`; `require(rc == 22, "HTS")` (22 = SUCCESS). Also require `token == address(usdc)` in token mode.
- `currentHourBucket()` is a view so the API can read the same bucket the contract uses.

**MockUSDC3009.sol**
- `ERC20("USD Coin", "USDC")`, `decimals()` returns **6**, `EIP712("USD Coin", "2")`. `mint(address, uint256)` is open (test token; say so in NatSpec).
- `_authorizationStates[authorizer][nonce]`; the 65-byte `(v,r,s)` and `bytes` overloads share one internal `_transferWithAuthorization(..., bytes32 digest, bytes memory sig)`. Signature check: `ECDSA.recover(digest, sig) == from` (OZ's `ECDSA` rejects high-`s` and bad `v`); accept 65-byte signatures only — document that EIP-2098 compact form is **not** accepted by the mock (the TS `recoverSigner` handles both, see INTERFACES §4).
- Checks: `block.timestamp > validAfter`, `block.timestamp < validBefore`, nonce unused; `receiveWithAuthorization` additionally `msg.sender == to`. Mark used, emit `AuthorizationUsed`, then `_transfer`. `cancelAuthorization` marks used and emits `AuthorizationCanceled`.
- Expose `DOMAIN_SEPARATOR()` and the three typehash constants publicly so `Vectors.t.sol` and the TS vectors agree.

**Deploy.s.sol**
- Keep the `CHAIN` check. Read `ChainRecord` with the two new fields (`usdc`, `usdcHts`; keep struct fields alphabetical: `explorer, gasToken, name, rpcEnv, slug, usdc, usdcHts`).
- Roles from env with Anvil defaults when `CHAIN == 31337`: `PAYOUT_ADDRESS` (Anvil #1), `ATTESTOR_ADDRESS` (Anvil #2), `OWNER_ADDRESS` (deployer). On 31337: deploy `MockUSDC3009`, mint `1_000_000e6` to Anvil #0–#7, deploy `DataDrop(mock, payout, attestor, owner)`. On live chains: `usdc` from `chains.json` unless `LEDGER_ONLY=true` (then `address(0)`); deploy `DataDrop` only; on 295/296 call `associateHts(usdc)` right after deployment (same broadcast). Assert the intended mode (`require(dataDrop.ledgerOnly() == (usdc == address(0)))`).
- Write `deploy/addresses.<slug>.json` with `vm.serializeX` + `vm.writeJson` in exactly the shape of INTERFACES §6.3 (field names and order as listed).

**Artefacts**
- `pnpm abi`: `forge build && forge inspect DataDrop abi --json > abi/DataDrop.json && forge inspect MockUSDC3009 abi --json > abi/MockUSDC3009.json`; `pnpm abi:check` regenerates to a temp dir and diffs (CI step, T-12). `pnpm vectors`: `forge script script/EmitVectors.s.sol` writes `fixtures/eip3009/vectors.json` — 8 fixed `(from, to, value, validAfter, validBefore, nonce)` tuples × domains `(chainId 31337, token 0x…)` and `(84532, 0x036C…)` with `transfer` and `receive` digests, plus one signature per tuple from Anvil key #5 (`vm.sign`). The `@ethglobal/eip3009` tests (adapters-live workstream) read this file and must reproduce every digest and recover every signer.

## 5. Dependencies on other workstreams

| Needs | From | Until it lands |
|---|---|---|
| nothing to compile or test | — | — |
| `fixtures/eip3009/vectors.json` is **consumed** by `@ethglobal/eip3009` (adapters-live) | you produce it | they skip `Vectors.test.ts` with `describe.skipIf(!exists)` |
| `abi/*.json` and `deploy/addresses.anvil.json` are consumed by `services/api`, `apps/web`, `scripts/` | you produce them | they read `DATADROP_ADDRESS` / `USDC_ADDRESS` from env |

## 6. Acceptance tests (Foundry; names are binding so the red team can reference them)

`test/DataDrop.t.sol`
- `test_ConstructorEmitsModeAndAttestor` — `ModeSet(false)` in token mode, `ModeSet(true)` with `address(0)`; `AttestorSet`.
- `test_CreateCampaignPullsBudget` — sponsor approves, creates; `usdc.balanceOf(dataDrop) == budget`; event fields.
- `test_RevertWhen_CreateCampaignIdExists` (T-04) — second `createCampaign(sameId)` from a stranger reverts `CampaignExists`; `sponsor`/`spent` unchanged.
- `test_RevertWhen_CreateCampaignInvalid` (T-07) — each of `budget < price`, `price == 0`, `claimsPerHour == 0`, `expiresAt <= now` reverts `InvalidCampaign`.
- `test_RevertWhen_CreateCampaignTransferFails` (T-09) — token returns false / insufficient allowance ⇒ revert; no campaign stored.
- `test_ClaimPaysPayoutOnce` — `Claimed` event; `payout` balance += price; `claimed(id,key) == true`; `spent == price`.
- `test_RevertWhen_ClaimTwiceSameKey` (T-03) — `AlreadyClaimed`; same key on a different campaign succeeds (by design).
- `test_RevertWhen_ClaimNotAttestor` (T-05) — sponsor, owner, stranger all `NotAttestor`.
- `test_RevertWhen_ClaimPaused` / `test_RevertWhen_ClaimExpired` / `test_RevertWhen_ClaimBudgetExhausted` — leaves remainder refundable.
- `test_HourlyCapAcrossBucketBoundary` (T-01, T-02) — cap N: N claims at `t = 3599` succeed, N+1 reverts `HourlyCap`; `vm.warp(3600)`: N more succeed, 2N+1 reverts; `claimsInHour(id, b)` and `currentHourBucket()` agree.
- `test_PauseMatrix` (T-05) — 3 callers × {true,false}: sponsor both ok; attestor `true` ok, `false` reverts `NotSponsor`; stranger reverts; `Paused(id, p, by)` emitted; `pausedSince` set/cleared.
- `test_RefundOnlyAfterExpiryOrLongPause` (T-06) — before: `NotRefundable`; after `expiresAt`: pays `budget − spent`, sets `budget == spent`; pause→unpause→pause resets the 24 h clock; second refund `NotRefundable`; claims after refund `BudgetExhausted`.
- `test_LedgerOnlyMovesNoTokens` (T-09) — all functions work, `usdc()` is zero, no `Transfer` events, balances unchanged.
- `test_AssociateHtsOnlyOnHedera` (T-09) — on 31337 reverts `NotHedera`; `vm.chainId(296)` + `vm.etch(0x…0167, HtsPrecompileMock)` ⇒ the mock records `(dataDrop, token)` and returns 22; non-owner reverts.
- `test_NoTokenMovesOutsideThreeFunctions` (T-10) — ABI inspection: iterate the ABI JSON (via `vm.readFile` + `vm.parseJson`) and assert the only non-view functions are `createCampaign, claim, pause, refund, setAttestor, associateHts, transferOwnership, acceptOwnership, renounceOwnership`.
- `test_ReentrantTokenCannotDoubleClaim` (T-11) — `ReentrantToken.transfer` re-enters `claim` ⇒ `ReentrancyGuard` revert; state consistent.
- `test_Decimals6` (T-08) — `usdc.decimals() == 6`; `$0.50 == 500_000`; a campaign priced `500_000 * 1e12` cannot be funded by a 1 M-USDC sponsor (reverts on transfer).
- `testFuzz_PriceLeqBudget(uint128 budget, uint96 price)` — `createCampaign` succeeds iff `budget ≥ price > 0` (with fixed valid cap/expiry).
- `testFuzz_ClaimSequenceRespectsCapAndBudget(uint8 n, uint32 cap, uint32 warpSeconds)` — after any sequence `spent ≤ budget`, `claimsInHour ≤ cap`.
- `test_GasSnapshot_Claim` — `claim` ≤ 100 000 gas in token mode (snapshot committed; `forge snapshot --check` in CI).

`test/invariant/DataDropInvariant.t.sol` (handler: create ≤ 3 campaigns, random claims with fresh/repeated keys, pause toggles, warps, refunds, attestor rotations)
- `invariant_SpentNeverExceedsBudget`, `invariant_SpentEqualsClaimsTimesPrice`, `invariant_TokenBalanceMatchesLedger` (`balanceOf(dataDrop) == Σ(budget − spent)` after refunds), `invariant_PaidInBucketLeqCap`, `invariant_ClaimKeyUniquePerCampaign`.

`test/MockUSDC3009.t.sol`
- `test_TransferWithAuthorizationValid` (both overloads), `test_ReceiveWithAuthorizationRequiresRecipient` (T-13), `test_RevertWhen_NonceReused` / `_Expired` / `_NotYetValid` / `_WrongSigner`, `test_CancelAuthorization`, `test_RevertWhen_HighS` (T-17), `test_DomainSeparatorMatchesChainId` (T-14: digests differ for chainId 31337 vs 84532 via `vm.chainId`; the foreign one is rejected), `test_Decimals6`.

`test/Vectors.t.sol` — every tuple in `fixtures/eip3009/vectors.json` reproduces its digest with the contract's `DOMAIN_SEPARATOR()` and typehash; `ecrecover` of the recorded signature equals Anvil #5.

`test/Deploy.t.sol` (extend) — Anvil path deploys both and writes `addresses.anvil.json` with the INTERFACES §6.3 shape; `vm.chainId(296)` + `LEDGER_ONLY=true` deploys DataDrop with `address(0)` and asserts `ledgerOnly()`; every chain record decodes with the two new fields.

Slither: `slither . --foundry-compile-all --exclude-informational --fail-medium` clean (config in `security/redteam/tools/slither.config.json` once the red team adds it; until then run with defaults).

## 7. Gas and chain notes

- Target: `claim` ≈ 75–95 k gas (two cold SSTOREs for `claimed` and the bucket counter, one warm for `spent`, one ERC-20 transfer). Do not add per-claim storage beyond these. `createCampaign` ≈ 120 k + the transfer.
- Hedera JSON-RPC relay: gas is paid in HBAR, exposed as 18-decimal wei by the relay while native HBAR has 8 decimals — **never price gas in app code**; `forge script --rpc-url hedera_testnet --legacy` may be required by the relay (`[verify Wed]`); `eth_estimateGas` on Hedera can under-estimate for precompile calls — pass `--gas-limit 1_000_000` for `associateHts`. HTS USDC's ERC-20 facade may return a response code instead of reverting on failure — that is exactly why `createCampaign` uses `SafeERC20` and asserts the balance delta in `Deploy.t.sol`.
- `uint96 pricePerClaim` caps a claim at ≈ 7.9 × 10¹⁶ base units — far above any real price; `uint128 budget` likewise.

## 8. Definition of done

- `pnpm --filter @ethglobal/contracts deps && forge build && forge test -vvv && forge fmt --check && forge snapshot --check` green; slither clean at high/medium; coverage of `src/` 100 % lines by `forge coverage`.
- `pnpm abi` and `pnpm vectors` run and their outputs are committed; `pnpm abi:check` passes.
- `bash scripts/dev-chain.sh` (scaffold) still works and now prints the deployed addresses; `deploy/addresses.anvil.json` is git-ignored and regenerated on every run.
- `README.md` documents token vs `LEDGER_ONLY` mode, the Hedera `associateHts` step, env variables for roles, and the Wednesday pre-deploy command sequence.
- No function in the ABI moves tokens except `createCampaign`, `claim`, `refund` (asserted by test).

## 9. The three most likely bugs — avoid them

1. **`stdJson` decodes object keys alphabetically.** Adding `usdc`/`usdcHts` to `chains.json` means the Solidity `ChainRecord` struct must list fields in alphabetical order (`explorer, gasToken, name, rpcEnv, slug, usdc, usdcHts`) and **every** chain entry must carry both keys (empty strings), or `abi.decode` silently misaligns fields. Same discipline for the addresses file you write.
2. **Checks-effects-interactions in `claim` and the bucket type.** Increment `_claimsInHour[id][bucket]` and `spent` **before** the token transfer; compute `bucket` once as `uint64(block.timestamp / 3600)`; never compare a `uint64` bucket to `block.timestamp` directly. The hour-boundary test (`vm.warp`) catches an off-by-one only if you assert both `N` at `3599` and `N` at `3600`.
3. **EIP-712 domain drift.** OZ `EIP712("USD Coin","2")` caches the domain separator per `chainId`/`address(this)`; tests that `vm.chainId()` must read `DOMAIN_SEPARATOR()` afresh, and the TS side must use the **same** name/version — the fixture `fixtures/eip3009/domains.json` records that Base Sepolia's faucet USDC may use a different `name()`; the mock is "USD Coin"/"2" by construction, real tokens are read at runtime (`readDomain`). Also: 6 decimals — never `1 ether` in a USDC test.
