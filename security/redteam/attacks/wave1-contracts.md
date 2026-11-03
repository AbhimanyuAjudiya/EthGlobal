# Wave 1 attack script — `packages/contracts` (`DataDrop.sol`, `MockUSDC3009.sol`, `Deploy.s.sol`)

**Run the moment wave 1 lands.** Targets: `packages/contracts/src/DataDrop.sol` (interface `IDataDrop` from `DECISION.md` §6.3), `packages/contracts/src/MockUSDC3009.sol`, `packages/contracts/script/Deploy.s.sol`. Threats: `docs/THREAT-MODEL.md` T-01…T-17. Findings go to `security/redteam/findings/RT-W1-0xx-*.md`; attack tests land in `packages/contracts/test/attack/DataDropAttack.t.sol`, `test/attack/MockUSDC3009Attack.t.sol`, `test/invariant/DataDropInvariants.t.sol`. Every test **asserts the attack fails**. Fuzz runs: `FOUNDRY_FUZZ_RUNS=4096` for the red-team run (CI keeps 512).

**If names differ** (`IDataDrop.AlreadyClaimed` is `DuplicateClaim`, `pause` is `setPaused`, …): read `src/DataDrop.sol`, use the real selector, note the rename in the wave report. If a **function in this script does not exist** (e.g. no `associateHts`, no `pausedSince`), that is a finding against `DECISION.md` §6.3, not a rename.

```sh
cd packages/contracts && forge build && forge test --match-path 'test/attack/*' -vvv
```

## 0. Shared fixture (`test/attack/DataDropAttack.t.sol` — `setUp`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {DataDrop, IDataDrop} from "../../src/DataDrop.sol";
import {MockUSDC3009} from "../../src/MockUSDC3009.sol";

contract DataDropAttackTest is Test {
    MockUSDC3009 internal usdc;
    DataDrop internal drop;

    address internal owner    = makeAddr("owner");      // cold key in production
    address internal attestor = makeAddr("attestor");   // the API's hot key — the thing we assume compromised in A1
    address internal payout   = makeAddr("payout");
    address internal sponsor  = makeAddr("sponsor");
    address internal stranger = makeAddr("stranger");
    address internal thief    = makeAddr("thief");      // holds a copy of the attestor key in A1/A18 (pranked as attestor)

    bytes32 internal constant ID = keccak256("demo-welcome");
    uint128 internal constant BUDGET = 500_000_000;          // $500.00 — 6 decimals (T-08)
    uint96  internal constant PRICE  = 500_000;              // $0.50
    uint32  internal constant CAP    = 5;                    // claims per hour, small on purpose
    uint64  internal expiresAt;

    function setUp() public {
        vm.warp(1_762_200_000);                               // Mon 3 Nov 2026 ~21:20 UTC; keeps hourBucket arithmetic readable
        usdc = new MockUSDC3009();                            // 6 decimals, EIP-712 ("USD Coin","2")
        drop = new DataDrop(usdc, payout, attestor, owner);   // token mode
        expiresAt = uint64(block.timestamp + 7 days);
        usdc.mint(sponsor, 10 * BUDGET);
        vm.startPrank(sponsor);
        usdc.approve(address(drop), type(uint256).max);
        drop.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);
        vm.stopPrank();
    }

    /// claimKey as the API computes it: keccak256(campaignId ‖ HMAC(secret, nullifierHash)). The HMAC is opaque here.
    function key(bytes32 id, uint256 human) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(id, keccak256(abi.encodePacked("hmac", human))));
    }
}
```

Expected after `setUp`: `usdc.balanceOf(address(drop)) == BUDGET`, `drop.campaigns(ID).spent == 0`, `CampaignCreated` emitted. If `createCampaign` did **not** pull the budget (balance 0) in token mode → **Critical finding** (claims will pay from nothing or revert forever).

## A1 — Compromised attestor drains the campaign (T-01)

Goal: with the attestor key, take more than `CAP × PRICE` from the campaign in one hour.

```solidity
function test_Attack_AttestorDrainStopsAtHourlyCap() public {
    vm.startPrank(attestor);                                  // the thief holds this key
    for (uint256 i = 0; i < CAP; i++) drop.claim(ID, key(ID, i));
    assertEq(usdc.balanceOf(payout), uint256(CAP) * PRICE);   // $2.50 — the bound from THREAT-MODEL §6.4
    vm.expectRevert(IDataDrop.HourlyCap.selector);
    drop.claim(ID, key(ID, 999));                             // N+1 in the same bucket
    vm.stopPrank();
    assertEq(drop.campaigns(ID).spent, uint128(CAP) * PRICE);
}
```

Also try: (a) `claim` with a **fresh id** that has no campaign → must revert (any error; `CampaignExpired`/`CampaignPaused` on a zero struct is acceptable, a successful transfer is Critical); (b) `claim` after the sponsor paused → `CampaignPaused`; (c) the thief calls `pause(ID, false)` as attestor → `NotSponsor` (attestor may pause, never unpause). Expected: all revert. Record the measured bound in the wave report: `CAP × PRICE` per campaign-hour.

## A2 — Hour-bucket edge burst (T-02)

```solidity
function test_Attack_BucketEdgeAllowsExactlyTwoCaps() public {
    uint256 edge = (block.timestamp / 3600 + 1) * 3600;       // next hour boundary
    vm.warp(edge - 1);
    vm.startPrank(attestor);
    for (uint256 i = 0; i < CAP; i++) drop.claim(ID, key(ID, i));
    vm.warp(edge);                                            // one second later, new bucket
    for (uint256 i = 0; i < CAP; i++) drop.claim(ID, key(ID, 100 + i));
    vm.expectRevert(IDataDrop.HourlyCap.selector);
    drop.claim(ID, key(ID, 200));
    vm.stopPrank();
    // 2 × CAP within two seconds is the documented bound; anything above it is a finding.
    assertEq(usdc.balanceOf(payout), 2 * uint256(CAP) * PRICE);
}
```

Check the `Claimed` event's `hourBucket` field equals `block.timestamp / 3600` for both halves (`vm.expectEmit`). If `hourBucket` is derived from anything else (block number, a stored counter) → Med finding (the API's limiter and the sponsor dashboard assume wall-clock hours).

## A3 — `claimKey` replay (T-03)

```solidity
function test_Attack_ReplaySameClaimKeyReverts() public {
    bytes32 k = key(ID, 1);
    vm.prank(attestor); drop.claim(ID, k);
    assertTrue(drop.claimed(ID, k));
    vm.prank(attestor);
    vm.expectRevert(IDataDrop.AlreadyClaimed.selector);
    drop.claim(ID, k);
}

function test_SameHumanDifferentCampaignIsAllowed() public {   // by design: one claim per (campaign, human)
    bytes32 ID2 = keccak256("second-sponsor");
    vm.prank(sponsor); drop.createCampaign(ID2, BUDGET, PRICE, CAP, expiresAt);
    vm.startPrank(attestor);
    drop.claim(ID, key(ID, 1));
    drop.claim(ID2, key(ID2, 1));                             // different claimKey because id is in the preimage
    vm.stopPrank();
}
```

Also assert that replay is checked **before** the cap and budget (a replay must say `AlreadyClaimed`, not consume a cap slot): claim `CAP` keys, then replay one → expect `AlreadyClaimed`, not `HourlyCap`. If the order is wrong it is a Low finding (misleading error, wasted gas) unless the replay also increments `spent` (Critical).

## A4 — Campaign id hijack (T-04)

```solidity
function test_Attack_CreateCampaignWithExistingIdReverts() public {
    usdc.mint(stranger, 1_000_000);
    vm.startPrank(stranger);
    usdc.approve(address(drop), type(uint256).max);
    vm.expectRevert(IDataDrop.CampaignExists.selector);       // new error — if absent, see below
    drop.createCampaign(ID, 1_000_000, 1, 1, expiresAt);
    vm.stopPrank();
    IDataDrop.Campaign memory c = drop.campaigns(ID);
    assertEq(c.sponsor, sponsor);
    assertEq(c.budget, BUDGET);
}
```

If there is **no** `CampaignExists` error and the call succeeds: **High finding** (stranger becomes sponsor: can `pause`, and `refund` the original sponsor's remaining budget to themselves if `refund` pays `msg.sender` or `campaigns[id].sponsor`). If the call reverts for an unrelated reason (e.g. the stranger's `1_000_000 < BUDGET`) re-run with a budget equal to the original — the id check must be the thing that reverts.

## A5 — Authorisation matrix (T-05)

| caller → function | `claim` | `pause(id,true)` | `pause(id,false)` | `refund` | `setAttestor` | `associateHts` |
|---|---|---|---|---|---|---|
| attestor | ok | ok | **`NotSponsor`** | `NotSponsor` | `Ownable…` revert | revert |
| sponsor | `NotAttestor` | ok | ok | ok (when refundable) | revert | revert |
| stranger | `NotAttestor` | `NotSponsor` | `NotSponsor` | `NotSponsor` | revert | revert |
| owner | `NotAttestor` | `NotSponsor` | `NotSponsor` | `NotSponsor` | ok | ok (chainid gate, A9) |

Write it as `test_Attack_<Caller>_<Function>` with `vm.prank`. Sponsor of campaign `ID` must also get `NotSponsor` on **another** sponsor's campaign (create `ID2` from `stranger`). Any cell that deviates is a finding; the attestor-can-unpause cell is High (a thief who paused to cover tracks — or the sponsor's protective pause — could be undone by the stolen key).

## A6 — Refund rules (T-06)

```solidity
function test_Attack_RefundBeforeExpiryWithoutPauseReverts() public {
    vm.prank(sponsor); vm.expectRevert(IDataDrop.NotRefundable.selector); drop.refund(ID);
}
function test_Attack_PauseToggleDoesNotShortenThe24h() public {
    vm.startPrank(sponsor);
    drop.pause(ID, true);  vm.warp(block.timestamp + 23 hours);
    drop.pause(ID, false); drop.pause(ID, true);                 // toggle: pausedSince must reset to now
    vm.warp(block.timestamp + 2 hours);                          // 25 h since first pause, 2 h since the last
    vm.expectRevert(IDataDrop.NotRefundable.selector);
    drop.refund(ID);
    vm.warp(block.timestamp + 22 hours + 1);                     // now ≥ 24 h since the last pause
    drop.refund(ID);
    vm.stopPrank();
    assertEq(usdc.balanceOf(sponsor), 10 * uint256(BUDGET));     // full budget back (no claims happened)
}
function test_Attack_DoubleRefundReverts() public {
    vm.warp(expiresAt + 1);
    vm.startPrank(sponsor); drop.refund(ID);
    vm.expectRevert(IDataDrop.NotRefundable.selector); drop.refund(ID); vm.stopPrank();
}
function test_Attack_ClaimAfterRefundReverts() public {
    vm.warp(expiresAt + 1); vm.prank(sponsor); drop.refund(ID);
    vm.prank(attestor);
    vm.expectRevert();                                           // CampaignExpired or BudgetExhausted — never a transfer
    drop.claim(ID, key(ID, 1));
    assertEq(usdc.balanceOf(payout), 0);
}
```

Refund amount after `n` claims must be `BUDGET − n × PRICE` exactly. Refund of an **expired but never paused** campaign must work (the normal path).

## A7 — Budget accounting: fuzz + invariants (T-07)

Unit guards (each `vm.expectRevert`): `createCampaign(id, budget=0, …)`, `pricePerClaim=0`, `pricePerClaim > budget`, `claimsPerHour=0`, `expiresAt ≤ block.timestamp`. Then:

```solidity
function testFuzz_SpentNeverExceedsBudget(uint96 price, uint8 n) public {
    price = uint96(bound(price, 1, BUDGET));
    bytes32 id = keccak256(abi.encode(price, n));
    vm.prank(sponsor); drop.createCampaign(id, BUDGET, price, type(uint32).max, expiresAt);
    vm.startPrank(attestor);
    for (uint256 i = 0; i < n; i++) {
        if (uint256(drop.campaigns(id).spent) + price > BUDGET) {
            vm.expectRevert(IDataDrop.BudgetExhausted.selector);
            drop.claim(id, key(id, i)); break;
        }
        drop.claim(id, key(id, i));
    }
    vm.stopPrank();
    assertLe(drop.campaigns(id).spent, BUDGET);
    assertEq(usdc.balanceOf(payout) + usdc.balanceOf(address(drop)), 10 * uint256(BUDGET) - usdc.balanceOf(sponsor));
}
```

`test/invariant/DataDropInvariants.t.sol` — handler with actors {attestor, sponsor, stranger}, actions `claim(randKey)`, `pause(bool)`, `refund`, `warp(0..2h)`, `createCampaign(randId)`; invariants: `invariant_SpentLeBudget`, `invariant_TokenConservation` (`balance(drop) == Σ_active (budget − spent)`), `invariant_HourlyCap` (handler counts claims per `(id, bucket)` and asserts `≤ claimsPerHour`), `invariant_ClaimedIsMonotone` (a key once `claimed` never flips). Run with `FOUNDRY_INVARIANT_RUNS=256 FOUNDRY_INVARIANT_DEPTH=64`.

## A8 — Decimals (T-08)

```solidity
function test_Decimals_UsdcIsSixAndPriceIsBaseUnits() public view {
    assertEq(usdc.decimals(), 6);
    assertEq(PRICE, 0.5e6);                                      // $0.50
    assertEq(uint256(PRICE) * 1e12, 0.5e18);                     // the wrong number, for the record
}
function test_Attack_EighteenDecimalPriceIsRejectedByBudget() public {
    uint96 wrong = uint96(0.5e18);                               // what a parseEther() bug would produce
    vm.prank(sponsor);
    vm.expectRevert();                                           // pricePerClaim > budget
    drop.createCampaign(keccak256("18dec"), BUDGET, wrong, CAP, expiresAt);
}
```

Then grep: `grep -rn -E '1e18|parseEther|10 \*\* 18' packages/contracts/src services packages/octroi packages/eip3009 2>/dev/null` — any hit on a USDC path is a High finding (semgrep `recharge-usdc-18-decimals` covers TS; this grep covers Solidity). Check `Deploy.s.sol` converts the `pricePerClaim` env/JSON value with `vm.parseUint` of a **base-unit** string, not a dollar float.

## A9 — HTS association and `LEDGER_ONLY` (T-09)

```solidity
address constant HTS = 0x0000000000000000000000000000000000000167;
contract MockHts { bytes public last; fallback(bytes calldata d) external returns (bytes memory) { last = d; return abi.encode(int64(22)); } }

function test_Attack_AssociateHtsOffHederaReverts() public {
    vm.prank(owner); vm.expectRevert(); drop.associateHts(address(usdc));          // chainid 31337
}
function test_AssociateHtsOnHederaCallsPrecompile() public {
    vm.chainId(296); vm.etch(HTS, type(MockHts).runtimeCode);
    vm.prank(owner); drop.associateHts(address(usdc));
    assertEq(bytes4(MockHts(HTS).last()), bytes4(keccak256("associateToken(address,address)")));   // 0x49146bde
    vm.prank(stranger); vm.expectRevert(); drop.associateHts(address(usdc));
}
function test_LedgerOnlyMovesNoTokens() public {
    DataDrop lo = new DataDrop(IERC20(address(0)), payout, attestor, owner);
    vm.prank(sponsor); lo.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);        // no transferFrom
    vm.prank(attestor); lo.claim(ID, key(ID, 1));
    assertEq(usdc.balanceOf(payout), 0);
    assertEq(lo.campaigns(ID).spent, PRICE);                                          // state still tracked
}
function test_Attack_TokenModeWithFailingTransferFromReverts() public {
    RevertingToken bad = new RevertingToken();                                        // transferFrom returns false / reverts
    DataDrop d = new DataDrop(IERC20(address(bad)), payout, attestor, owner);
    vm.prank(sponsor); vm.expectRevert(); d.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);
}
```

Expected: a `ModeSet(bool ledgerOnly)` (or equivalent) event in the constructor; `Deploy.s.sol` refuses token mode on 296 without an `associateHts` step and refuses `LEDGER_ONLY` on a chain whose `deploy/chains.json` entry has a `usdc` address unless `LEDGER_ONLY=true` is explicit. A token-mode `createCampaign` whose `transferFrom` silently returns `false` and still records the budget is **Critical** (claims pay from a balance that was never received, or — on Hedera — the sponsor's money never moves while the demo claims it did).

## A10 — Payout and owner powers (T-10)

Parse `out/DataDrop.sol/DataDrop.json` (or `forge inspect DataDrop abi`): the only functions that move tokens are `createCampaign`, `claim`, `refund`. There is no `setPayout`, `withdraw`, `sweep`, `rescue`. `payout` and `usdc` are `immutable` (`forge inspect DataDrop storage-layout` shows neither in storage). Owner functions are exactly `setAttestor`, `associateHts`, `transferOwnership`/`renounceOwnership`. Any extra token-moving function → High finding unless it is sponsor-scoped and tested.

## A11 — Reentrancy / CEI / slither (T-11)

Reentrant token: `MockUSDC3009` has no hooks, so deploy a `ReentrantToken` whose `transfer` calls back `drop.claim(ID, key)` as the attestor (pranked) — the callback must revert (`AlreadyClaimed`, or the reentrancy guard) and the outer `spent` must equal one `PRICE`. Then:

```sh
cd packages/contracts && slither . --foundry-compile-all --config-file ../../security/redteam/tools/slither.config.json
```

Expected: zero high/medium. Each `// slither-disable-next-line` carries a reason. Also `forge snapshot` and commit `.gas-snapshot`; a claim should be well under 100k gas in token mode.

## A12 — ABI drift (T-12)

Export the ABI the API will use (`pnpm abi:export` or whatever the builder named it) and diff against `forge inspect DataDrop abi`. The `Claimed(bytes32 indexed id, bytes32 indexed claimKey, uint96 paid, uint64 hourBucket)` signature must match the API's decoder and the sponsor dashboard's query. No script → Med finding (the dashboard will silently show zero claims when a field is renamed).

## A13 — `MockUSDC3009` authorization matrix (T-13)

Use `vm.sign` with Anvil account #0's key (`0xac09…ff80` — test-only, allowed in `test/`) and the token's `DOMAIN_SEPARATOR()`:

```solidity
bytes32 constant TRANSFER_TYPEHASH = keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");
function digest(address from, address to, uint256 v, uint256 va, uint256 vb, bytes32 n) view returns (bytes32) {
    return keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), keccak256(abi.encode(TRANSFER_TYPEHASH, from, to, v, va, vb, n))));
}
```

| Case | Call | Expected |
|---|---|---|
| valid | `transferWithAuthorization(from,to,v,va,vb,n, sig)` by anyone | transfer; `authorizationState(from,n) == true`; `AuthorizationUsed` |
| replay | same again | revert (`"EIP3009: authorization is used"` or custom) |
| expired | `vb = block.timestamp` | revert |
| not yet valid | `va = block.timestamp + 1` | revert |
| wrong signer | signed by key #1, `from` = account #0 | revert |
| wrong `value` in call vs signed | revert |
| `receiveWithAuthorization` by `msg.sender != to` | revert `"caller must be the payee"` |
| `receiveWithAuthorization` by `to` | ok |
| `cancelAuthorization` then transfer | revert |
| nonce shared between transfer/receive variants | second reverts (same `authorizationState`) |
| domain | `DOMAIN_SEPARATOR()` equals `keccak256(abi.encode(EIP712DOMAIN_TYPEHASH, keccak256("USD Coin"), keccak256("2"), block.chainid, address(usdc)))` |

## A14 — Cross-chain / cross-contract replay (T-14)

Sign a valid authorization under `chainId = 31337`; `vm.chainId(84532)`; call `transferWithAuthorization` → must revert (domain separator must **not** be cached at construction — if the token caches it, this test passes on Anvil but a fork would accept replays; record which). Deploy a second `MockUSDC3009`; the same signature must fail there (`verifyingContract`).

## A15 — Settlement front-run → paid-but-denied (T-15)

On Anvil (`scripts/dev-chain.sh`), with `MockUSDC3009` and the wave-1 `SelfRunFacilitator`:

1. User signs `transferWithAuthorization(from=user, to=payTo, value=400000, nonce=N)`.
2. **Thief** (any funded account) submits that calldata first (`cast send $USDC "transferWithAuthorization(...)"`); it succeeds — funds went to `payTo`.
3. The API calls `settle()` → the relayer's tx reverts "authorization used".
4. **Expected:** `SettleResult.success == true` with the thief's tx hash (the facilitator checks `authorizationState(from, N)` and the `Transfer(from, payTo, 400000)` log). If `success == false` the user paid and got nothing → **Med finding** with the remediation in THREAT-MODEL T-15 (or `receiveWithAuthorization` where the token supports it; `MockUSDC3009` does).

In Foundry alone: call `transferWithAuthorization` from `stranger`, then assert `authorizationState(from, N) == true` and `balanceOf(payTo) == 400000` — the on-chain facts the facilitator must read.

## A16 / A17 — Relayer griefing and signature malleability

TypeScript-level (`packages/eip3009`); see `wave1-octroi.md` E4–E6. In Foundry: a flipped-`s` signature (`s' = n − s`, `v' = v ^ 1`) **must be rejected** by `MockUSDC3009` if it uses OpenZeppelin `ECDSA` (it rejects high-`s`); if the token hand-rolls `ecrecover`, both signatures are valid for the same nonce — the nonce still prevents double-spend, so Low, but record it.

## A18 — Rotation drill, local rehearsal (T-01, THREAT-MODEL §6.7)

```solidity
function test_Drill_PauseRotateUnpause() public {
    address newAttestor = makeAddr("attestor-2");
    // 1. anomaly: the thief (holding the attestor key) has claimed CAP−1 times
    vm.startPrank(attestor); for (uint256 i = 0; i < CAP - 1; i++) drop.claim(ID, key(ID, i)); vm.stopPrank();
    // 2. pause with the (compromised) attestor key — allowed, and useful
    vm.prank(attestor); drop.pause(ID, true);
    vm.prank(attestor); vm.expectRevert(IDataDrop.CampaignPaused.selector); drop.claim(ID, key(ID, 50));
    // 3. rotate
    vm.prank(owner); drop.setAttestor(newAttestor);
    vm.prank(attestor); vm.expectRevert(IDataDrop.NotAttestor.selector); drop.claim(ID, key(ID, 51));   // old key dead
    vm.prank(attestor); vm.expectRevert(IDataDrop.NotSponsor.selector); drop.pause(ID, false);           // old key cannot unpause
    // 4. sponsor unpauses; new attestor serves
    vm.prank(sponsor); drop.pause(ID, false);
    vm.prank(newAttestor); drop.claim(ID, key(ID, 52));
}
```

Also with `cast` against Anvil after `pnpm dev:chain` (addresses from `deploy/addresses.anvil.json`):

```sh
cast send $DROP "pause(bytes32,bool)" $ID true  --private-key $ATTESTOR_KEY
cast send $DROP "setAttestor(address)" $NEW     --private-key $OWNER_KEY
cast call $DROP "campaigns(bytes32)" $ID         # paused == true
cast send $DROP "claim(bytes32,bytes32)" $ID $KEY --private-key $ATTESTOR_KEY   # expect NotAttestor()
```

Time the four `cast` steps; the Friday live drill must come in under 5 minutes including the API restart.

## Deploy script checks (`script/Deploy.s.sol`)

- `CHAIN` mismatch still aborts (scaffold test exists).
- Anvil: deploys `MockUSDC3009` **and** `DataDrop` in token mode; writes `deploy/addresses.anvil.json` with `usdc`, `dataDrop`, `payout`, `attestor`, `owner`, `mode`.
- Live chains: reads `usdc` from `deploy/chains.json`; 296 → `associateHts` after deploy; never deploys `MockUSDC3009`.
- Keys: the script takes `--private-key`; it must not read `DEPLOYER_PRIVATE_KEY` defaults other than Anvil's in `dev-chain.sh`. A hard-coded key anywhere in `script/` is a High finding.
- `broadcast/**/31337/` is git-ignored (scaffold) — live broadcasts **are** committed (they are the disclosure evidence) and must contain no key material (they do not by construction; verify).

## Reporting

For each A-item: attack test path, result (`failed as expected` / `FINDING RT-W1-0xx`), gas and fuzz seeds where relevant. Open the wave report with the measured drain bound (`CAP × PRICE` per hour, `2×` at the edge) in dollars for the demo campaign parameters the builder shipped in `scripts/demo-seed.ts`.
