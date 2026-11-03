# @ethglobal/contracts

Foundry project (forge 1.5.1, solc 0.8.30, `evm_version = "cancun"`, optimizer 200 runs, 512 fuzz runs, invariants
64 × 32, fixed fuzz seed). Contracts: **`DataDrop`** (sponsor pools that pay the service once per verified human) and
**`MockUSDC3009`** (6-decimal test USDC with Circle FiatTokenV2_2's EIP-3009 surface). Binding interface:
`docs/INTERFACES.md` §6; threats: `docs/THREAT-MODEL.md` T-01…T-17; red-team script:
`security/redteam/attacks/wave1-contracts.md` (every Foundry case in it is encoded in `test/`).

```
src/DataDrop.sol                    sponsor pools: one claim per (id, claimKey), hourly cap, pause, refund, LEDGER_ONLY, HTS hook
src/EIP3009Token.sol                abstract 6-dec ERC-20 + EIP-3009 (configurable EIP-712 name/version, Circle digest layout)
src/MockUSDC3009.sol                EIP3009Token("USD Coin","USDC","2") + open mint — Anvil only
src/interfaces/                     IDataDrop, IEIP3009 (verbatim INTERFACES §6.1–6.2), IHederaTokenService (associateToken only)
script/Deploy.s.sol                 chain-agnostic deploy (CHAIN env), writes deploy/addresses.<slug>.json
script/fill-deploy-txs.mjs          copies creation tx hashes from broadcast/ into addresses.<slug>.json → txs
script/EmitVectors.s.sol            writes fixtures/eip3009/vectors.json (16 vectors: 8 tuples × 2 domains)
script/abi.sh                       abi/*.json export and drift check
abi/DataDrop.json, abi/MockUSDC3009.json   committed ABIs (`@ethglobal/contracts/abi/DataDrop.json`)
deploy/chains.json                  chain id → explorer, gasToken, name, rpcEnv, slug, usdc, usdcHts (alphabetical keys)
deploy/addresses.<slug>.json        deploy output; committed for live chains, git-ignored for anvil
test/                               DataDrop.t.sol, MockUSDC3009.t.sol, Vectors.t.sol, Deploy.t.sol, invariant/, mocks/
.gas-snapshot                       `forge snapshot`, checked in CI
```

## Commands

| Command                            | What it does                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm deps`                        | `forge install` of the pinned libraries (`--no-git`; skipped when `lib/` is populated)               |
| `pnpm build` / `pnpm test`         | `forge build` / `forge test` (root: `pnpm test:contracts`)                                           |
| `pnpm fmt` / `pnpm fmt:check`      | `forge fmt`                                                                                          |
| `pnpm abi` / `pnpm abi:check`      | export `abi/*.json` / fail when they differ from a fresh `forge inspect` (CI, T-12)                  |
| `pnpm vectors`                     | regenerate `fixtures/eip3009/vectors.json` (deterministic: RFC 6979 signatures)                      |
| `pnpm snapshot` / `snapshot:check` | `forge snapshot` / `forge snapshot --check`                                                          |
| `pnpm deploy:txs`                  | fill `txs` in `deploy/addresses.<slug>.json` from the last broadcast (`CHAIN` env)                   |
| `pnpm slither`                     | `slither . --filter-paths lib` (red-team config: `../../security/redteam/tools/slither.config.json`) |
| `pnpm dev:chain` (repo root)       | Anvil on 31337 + `Deploy.s.sol` broadcast + `fill-deploy-txs`; prints the addresses file             |

## DataDrop

- **Units.** Every amount is a USDC base-unit integer, **6 decimals**: `$0.50 = 500_000`, `$1 = 1e6`. `pricePerClaim`
  is `uint96`, `budget`/`spent` `uint128`, checked arithmetic. Nothing on a USDC path is ever `1e18`/`parseEther`
  (`test_Decimals6`, `test_Attack_EighteenDecimalPriceCannotBeFunded`).
- **`claim` check order** (the API decodes reverts by name): `InvalidCampaign` (no such id) → `CampaignPaused` →
  `CampaignExpired` (`now ≥ expiresAt`) → `AlreadyClaimed` → `HourlyCap` (bucket = `block.timestamp / 3600`) →
  `BudgetExhausted`. Effects (claimed flag, bucket counter, `spent`) and the `Claimed` event precede the single
  `safeTransfer(payout, price)`; `nonReentrant` (OZ `ReentrancyGuardTransient`) on `createCampaign`, `claim`, `refund`.
- **Pause.** Sponsor sets either value; attestor may only pause (`false` ⇒ `NotSponsor`); anyone else `NotSponsor`;
  unknown id `InvalidCampaign`. `pausedSince` is set on false→true only and cleared on true→false, so a no-op re-pause
  never moves the 24 h refund clock and unpause→pause restarts it.
- **Refund.** Sponsor only, when `now ≥ expiresAt` or paused for ≥ 24 h; returns `budget − spent`, then `budget = spent`
  (a second refund is `NotRefundable`, later claims `BudgetExhausted`). `refund(id, to)` pays a recipient of the
  sponsor's choice (for example when the issuer blacklisted the sponsor's address, RT-C-03); it is never an owner power.
- **Campaign ids (RT-C-02).** Use **sponsor-scoped ids**, `scopedCampaignId(sponsor, salt)` = `sponsor ‖ 0x00000000 ‖
salt`: only that sponsor can create one (anyone else gets `NotSponsor`), so it cannot be squatted or front-run. Any other
  id is first come, never reusable (`CampaignExists`) and never overwritten. The API and seed pin `(id, sponsor)`.
- **Budget check (RT-C-07).** `claim` tests `price > budget − spent` before adding, so it reports `BudgetExhausted` (never
  `Panic`) up to `uint128` max.
- **No other token path.** `usdc` and `payout` are immutable; there is no sweep/withdraw/rescue. Only `createCampaign`,
  `claim` and `refund` move tokens (`test_NoTokenMovesOutsideThreeFunctions` inspects the ABI and the logs).

### Roles and keys

| Role     | Powers                                                                     | Key                                  | Anvil default |
| -------- | -------------------------------------------------------------------------- | ------------------------------------ | ------------- |
| owner    | `setAttestor`, `setLedgerSponsor` (non-zero), `associateHts`; Ownable2Step | cold, on-site                        | deployer (#0) |
| attestor | `claim`; `pause(id, true)` on any campaign                                 | API hot key (`ATTESTOR_PRIVATE_KEY`) | #2            |
| sponsor  | `createCampaign`; `pause` both ways and `refund` on own                    | sponsor wallet                       | #3 (demo)     |
| payout   | receives every claim payment (immutable)                                   | never on the API host (A-31)         | #1            |

`renounceOwnership()` is **disabled**: it always reverts with `RenounceDisabled` (RT-C-06). An ownerless DataDrop could
never rotate a stolen attestor key, and rotation is the T-01 recovery. Because the risk is now removed rather than
accepted, it needs no row in THREAT-MODEL §8, which covers only the T-01 self-attestation itself. Ownership still moves
with `transferOwnership` + `acceptOwnership`. A stolen attestor key can pause every campaign (a DoS that sponsors undo by
unpausing) and can drain at most the bound below.

### Drain bound (T-01, T-02)

Per hour, with a stolen attestor key: `Σ_live min(budget − spent, pricePerClaim × claimsPerHour)`; at an hour-bucket
edge up to **2 × pricePerClaim × claimsPerHour** within seconds (N claims at `t ≡ 3599`, N more at `t ≡ 0 mod 3600`;
`test_HourlyCapAcrossBucketBoundary`, `test_Attack_BucketEdgeAllowsExactlyTwoCaps`). Rotation does not reset the cap
(it is per campaign-hour). Demo campaign ($0.50 × 100/h, $500): **$50 per hour, $100 worst burst** until paused.

### Modes

| Mode          | Constructed with     | Behaviour                                                                                                                                                                                                                                                                                                                |
| ------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| token         | `usdc_ = <USDC>`     | `createCampaign` pulls `budget` with `safeTransferFrom` **and** checks the balance delta (`BudgetNotReceived`), so a facade that returns success without moving funds reverts (T-09)                                                                                                                                     |
| `LEDGER_ONLY` | `usdc_ = address(0)` | same state and events, no token calls; `ModeSet(true)` at construction. **Only owner-allow-listed sponsors** (`setLedgerSponsor`, after the owner has seen their native HTS funding) may create campaigns; others get `NotSponsor` (RT-C-01). For Hedera if the HTS ERC-20 facade misbehaves at the Wednesday pre-deploy |

The mode is fixed at construction (`ModeSet(bool)` event, `ledgerOnly()` view) and the deploy script asserts it. Every
`createCampaign` also emits `CampaignFunded(id, funder, amount)`: in token mode the tokens moved, in LEDGER_ONLY an
allow-listed sponsor declared the budget.

## MockUSDC3009 / EIP3009Token

`ERC20("USD Coin","USDC")`, `decimals() == 6`, EIP-712 domain `("USD Coin","2", chainid, address(this))`, exposes
`DOMAIN_SEPARATOR()`, `version()`, ERC-5267 `eip712Domain()` and the three typehash constants. FiatTokenV2_2 semantics:
`validAfter < now < validBefore` (both strict), nonces single-use per authorizer across transfer/receive/cancel,
`receiveWithAuthorization` only by `to`, `AuthorizationUsed` before the balance moves, `cancelAuthorization` (v,r,s and
bytes overloads). Signatures: 65-byte only (OZ `ECDSA`: high-`s` ⇒ `ECDSAInvalidSignatureS`, bad `v` ⇒
`ECDSAInvalidSignature`); **EIP-2098 64-byte compact signatures revert** (`ECDSAInvalidSignatureLength`) — the TS
`recoverSigner` must expand them before relaying. No pause/blacklist/EIP-1271 (test token). `mint` is open: Anvil only.
The domain name is configurable in `EIP3009Token`; `test/mocks/MockUSDC3009Named.sol` reproduces Base Sepolia's
`("USDC","2")` domain (A-21).

`fixtures/eip3009/vectors.json` — domains `(USD Coin, 2, 31337, 0x5FbDB2315678afecb367f032d93F642f64180aa3)` (the mock as
`Deploy.s.sol` places it on a fresh Anvil) and `(USDC, 2, 84532, 0x036CbD53842c5426634e7929541eC2318f3dCF7e)`; per
vector `from, to, value, validAfter, validBefore, nonce` (integers as decimal strings), `transferDigest`,
`receiveDigest`, `transferSignature`, `receiveSignature` (r‖s‖v by Anvil #5). `test/Vectors.t.sol` deploys the token at
each recorded address/chain, reproduces every digest from `DOMAIN_SEPARATOR()`, recovers #5 and executes every vector.

## Deploying

Env (root `.env`): `PAYOUT_ADDRESS`, `ATTESTOR_ADDRESS`, `OWNER_ADDRESS` (on 31337 default to Anvil #1, #2 and the
deployer; required elsewhere), `LEDGER_ONLY` (default `false`), `ANVIL_MNEMONIC`. No key lives in `script/`.

- **31337:** `MockUSDC3009` + `DataDrop(mock, payout, attestor, owner)`; mints 1 000 000 USDC to Anvil #0–#8 (#8 is the
  local treasury, A-31).
- **Live chains:** `DataDrop` only, `usdc` from `deploy/chains.json`; `LEDGER_ONLY=true` ⇒ `address(0)`. A chain whose
  record has no `usdc` refuses to deploy unless `LEDGER_ONLY=true` is explicit (THREAT-MODEL §6.1 rule 5 — echo it into
  `DISCLOSURE.md`). On 295/296 in token mode the script deploys owned by the broadcaster, calls `associateHts(usdc)` in
  the same broadcast, then `transferOwnership(OWNER_ADDRESS)` — **the owner must then call `acceptOwnership()`**.
- Live token mode refuses a `usdc` without code or with `decimals() != 6` (RT-C-04). On Hedera a codeless HTS
  long-zero alias is tolerated ([verify Wed]; check decimals on the mirror node), but a contract that answers
  `decimals()` must answer 6.
- Output: `deploy/addresses.<slug>.json` in the INTERFACES §6.3 shape (`txs` filled by `pnpm deploy:txs`). `owner` is the
  on-chain owner and `pendingOwner` the cold owner that still has to `acceptOwnership()` (RT-C-05). After accepting, run
  `CHAIN=<id> RPC_URL=… pnpm deploy:txs` to refresh both fields from the chain.

```sh
CHAIN=31337 forge script script/Deploy.s.sol:Deploy --rpc-url anvil --broadcast --private-key $DEPLOYER_PRIVATE_KEY
CHAIN=84532 forge script script/Deploy.s.sol:Deploy --rpc-url base_sepolia --broadcast --private-key $DEPLOYER_PRIVATE_KEY
```

### Hedera notes ([verify Wed] unless stated)

- USDC = HTS **`0.0.429274`**, 6 decimals; EVM long-zero alias **`0x0000000000000000000000000000000000068cDa`**
  (429274 = 0x68CDA; this is the EIP-55 checksum — the spelling `…68cDA` in INTERFACES/brief is not a valid checksum and
  strict parsers such as viem `getAddress` reject it). Confirm on HashScan.
- HTS system contract `0x…0167`, `associateToken(address(this), token)`; response code 22 = SUCCESS, anything else
  reverts `HtsAssociationFailed(rc)` (21 when the call returns no data). Called with a low-level call, as Hedera's own
  `HederaTokenService.sol` does.
- The relay may need `--legacy`; `eth_estimateGas` under-estimates precompile calls ⇒ pass `--gas-limit 1000000` (the
  association runs inside the deploy broadcast). Gas is HBAR exposed as 18-dec weibar — never price it in app code.
- `ReentrancyGuardTransient` needs EIP-1153 (TSTORE/TLOAD); the package already targets Cancun, so the bytecode needs a
  Cancun-capable EVM regardless. If the Hedera relay rejects the deploy, rebuild with `ReentrancyGuard` (storage) — the
  revert selector is identical; `claim` costs ≈ 5 k more.

### Wednesday pre-deploy (Hedera testnet, 296)

```sh
cd packages/contracts
pnpm deps && forge build && forge test && pnpm abi:check && pnpm snapshot:check
export PAYOUT_ADDRESS=0x… ATTESTOR_ADDRESS=0x… OWNER_ADDRESS=0x…           # on-site keys, never Anvil's
# 1. token mode (default)
CHAIN=296 forge script script/Deploy.s.sol:Deploy --rpc-url hedera_testnet --broadcast --legacy \
  --gas-limit 1000000 --private-key $DEPLOYER_PRIVATE_KEY
CHAIN=296 pnpm deploy:txs                                                   # file shows pendingOwner = OWNER_ADDRESS
cast send $DATADROP "acceptOwnership()" --rpc-url hedera_testnet --legacy --private-key $OWNER_PRIVATE_KEY
CHAIN=296 RPC_URL=$HEDERA_TESTNET_RPC_URL pnpm deploy:txs                   # file now: owner = cold, pendingOwner = 0
# payout must be associated with HTS USDC before the first claim (else every claim reverts; campaigns stay refundable)
# demo campaign id: cast call $DATADROP "scopedCampaignId(address,uint64)(bytes32)" $SPONSOR 1
# 2. smoke: sponsor approves + createCampaign (small budget), attestor claim → one Claimed on HashScan
# 3. if transferFrom/association misbehaves: redeploy with LEDGER_ONLY=true (record it in DISCLOSURE.md)
LEDGER_ONLY=true CHAIN=296 forge script script/Deploy.s.sol:Deploy --rpc-url hedera_testnet --broadcast --legacy \
  --private-key $DEPLOYER_PRIVATE_KEY
# … then, once the sponsor's native HTS transfer is seen on HashScan, allow-list it (owner key):
cast send $DATADROP "setLedgerSponsor(address,bool)" $SPONSOR true --rpc-url hedera_testnet --legacy --private-key $OWNER_PRIVATE_KEY
```

## Gas (`.gas-snapshot`)

`claim` in token mode, cold, payout balance 0 → non-zero: **98 627** gas measured around the call
(`test_GasSnapshot_Claim`, asserted ≤ 100 000); on Anvil a full `claim` tx (21 k base + calldata included) is ≈ 98.6 k
with a funded payout, i.e. ≈ 77 k execution. `createCampaign` ≈ 131 k per tx including the `transferFrom`. Fuzz
determinism comes from three settings. A fixed `seed`. `include_push_bytes = false`, because bytecode constants include
the metadata hash and would make the snapshot depend on build flags. `max_fuzz_dictionary_literals = 0`, because source
literals are sampled from the selected test set and a `--match`/`--no-match` filter would otherwise change fuzz inputs.
The red team overrides these for wider exploration. The snapshot contains everything, so a bare `forge snapshot --check`
passes. The red-team gate runs `forge snapshot --check --tolerance 5 --no-match-test 'invariant|RTFINDING'`: invariant
entries carry no gas, `--tolerance` mis-reports them as diffs, and they are proven by their own 256 × 64 run.

## Tests

`test/DataDrop.t.sol`, `MockUSDC3009.t.sol`, `Vectors.t.sol`, `Deploy.t.sol` (builder); `test/invariant/` (builder
invariants); `test/redteam/` (red team, attack scripts A1–A19 and model invariants); `test/regression/T<nn>_*.t.sol`, the
THREAT-MODEL §5.12 regression files. Each fixed red-team finding RT-C-01…07 has its former `_RTFINDING` attack test there,
now passing. Gate: `security/redteam/run-wave.sh contracts`.

## Slither (`slither . --filter-paths lib`, 0.11.6)

No high or medium findings (`--fail-medium` exits 0, also with `security/redteam/tools/slither.config.json`). Low /
informational, justified:

| Detector                  | Where                                     | Why it stays                                                                                                   |
| ------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `shadowing-local`         | `IDataDrop.setAttestor(address attestor)` | parameter name is verbatim from INTERFACES §6.1 (the implementation uses `attestor_`)                          |
| `reentrancy-events`       | `associateHts` emits after the HTS call   | the event reports the call's success; callee is the Hedera system contract; owner-only; no state written after |
| `timestamp`               | expiry, 24 h pause, EIP-3009 windows      | inherent to the spec; granularity is seconds–hours, far above validator skew                                   |
| `naming-convention`       | `DOMAIN_SEPARATOR()`                      | EIP-2612/FiatToken name that tooling expects                                                                   |
| `unindexed-event-address` | `AttestorSet(address)`                    | verbatim INTERFACES §6.1 event; changing it would break consumers' topic decoding                              |

## Offline compiler

`offline = true` keeps forge from contacting binaries.soliditylang.org (blocked in the build sandbox); solc
0.8.30 must therefore exist under `~/.svm/0.8.30/`. CI exports `FOUNDRY_OFFLINE=false` so a fresh runner can
download it.
