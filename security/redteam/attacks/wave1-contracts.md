# Wave 1 attack script — `packages/contracts` (`DataDrop.sol`, `MockUSDC3009.sol`, `Deploy.s.sol`)

**Run the moment wave 1 lands.** Interface: `docs/INTERFACES.md` §6.1–6.3 (copied verbatim into `docs/build-briefs/contracts.md` §3). Threats: `docs/THREAT-MODEL.md` T-01…T-17. The builder's own acceptance tests are named in the brief §6 (`test_RevertWhen_*`, `testFuzz_*`, `invariant_*`); **this script attacks what those tests do not**: adversarial sequences, boundary arithmetic, the drain bound as a number, the drill, and the deploy script. Red-team tests land in `packages/contracts/test/attack/DataDropAttack.t.sol` and `test/attack/MockUSDC3009Attack.t.sol`; extra handler actions and invariants go into the builder's `test/invariant/DataDropInvariant.t.sol` (+ `handlers/DataDropHandler.sol`). Reuse `test/mocks/ReentrantToken.sol` and `test/mocks/HtsPrecompileMock.sol`. Every test **asserts the attack fails**. Red-team run: `FOUNDRY_FUZZ_RUNS=4096 FOUNDRY_INVARIANT_RUNS=256 FOUNDRY_INVARIANT_DEPTH=64` (CI keeps `foundry.toml`).

**If code and INTERFACES §6 disagree** (a missing error, a different `Campaign` field order, a `pause` that lets the attestor unpause), the code is wrong (INTERFACES §0) — that is a finding, not a rename.

```sh
cd packages/contracts && pnpm deps && forge build && forge test --match-path 'test/attack/*' -vvv
```

## 0. Shared fixture (`test/attack/DataDropAttack.t.sol` — `setUp`)

Roles follow `@ethglobal/adapters/testing` `anvilRoles` so the TypeScript side and the contracts agree: deployer/owner #0, payout #1, attestor #2, sponsor #3, agent #4, human #5, relayer #6, stranger #7 (mnemonic `test test … junk`).

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DataDrop} from "../../src/DataDrop.sol";
import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";
import {MockUSDC3009} from "../../src/MockUSDC3009.sol";
import {HtsPrecompileMock} from "../mocks/HtsPrecompileMock.sol";
import {ReentrantToken} from "../mocks/ReentrantToken.sol";

contract DataDropAttackTest is Test {
    MockUSDC3009 internal usdc;
    DataDrop internal drop;

    address internal owner    = vm.addr(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80); // Anvil #0 (test-only key)
    address internal payout   = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;   // #1
    address internal attestor = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;   // #2 — the hot key we assume stolen in A1/A18
    address internal sponsor  = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;   // #3
    address internal human    = 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc;   // #5
    address internal stranger = 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955;   // #7

    bytes32 internal constant ID = keccak256("demo-welcome");
    uint128 internal constant BUDGET = 500_000_000;     // $500.00, 6 decimals (T-08)
    uint96  internal constant PRICE  = 500_000;         // $0.50
    uint32  internal constant CAP    = 5;               // claimsPerHour — small on purpose
    uint64  internal expiresAt;

    function setUp() public {
        vm.warp(1_762_200_000);                                   // keeps hour buckets readable
        usdc = new MockUSDC3009();
        drop = new DataDrop(IERC20(address(usdc)), payout, attestor, owner);   // token mode; expect ModeSet(false)
        expiresAt = uint64(block.timestamp + 7 days);
        usdc.mint(sponsor, 10 * uint256(BUDGET));
        vm.startPrank(sponsor);
        usdc.approve(address(drop), type(uint256).max);
        drop.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);
        vm.stopPrank();
    }

    /// onchainClaimKey as octroi computes it: keccak256(abi.encodePacked(id, campaignClaimKey)); the HMAC is opaque here.
    function key(bytes32 id, uint256 humanIx) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(id, keccak256(abi.encodePacked("cck", humanIx))));
    }
}
```

After `setUp`: `usdc.balanceOf(address(drop)) == BUDGET`, `drop.campaigns(ID).spent == 0`, `drop.ledgerOnly() == false`, `drop.attestor() == attestor`. Budget not pulled in token mode ⇒ **Critical**.

## A1 — Compromised attestor drains the campaign (T-01); the bound as a number

```solidity
function test_Attack_AttestorDrainStopsAtHourlyCap() public {
    vm.startPrank(attestor);
    for (uint256 i = 0; i < CAP; i++) drop.claim(ID, key(ID, i));
    assertEq(usdc.balanceOf(payout), uint256(CAP) * PRICE);            // $2.50 — THREAT-MODEL §6.4
    assertEq(drop.claimsInHour(ID, drop.currentHourBucket()), CAP);
    vm.expectRevert(IDataDrop.HourlyCap.selector);
    drop.claim(ID, key(ID, 999));
    vm.stopPrank();
}
function test_Attack_RotationDoesNotResetTheHourCap() public {         // the cap is per campaign-hour, not per attestor
    vm.startPrank(attestor); for (uint256 i = 0; i < CAP; i++) drop.claim(ID, key(ID, i)); vm.stopPrank();
    address a2 = makeAddr("attestor-2");
    vm.prank(owner); drop.setAttestor(a2);
    vm.prank(a2); vm.expectRevert(IDataDrop.HourlyCap.selector); drop.claim(ID, key(ID, 50));
}
function test_Attack_ThreeCampaignsDrainBound() public {               // Σ over campaigns
    bytes32 id2 = keccak256("c2"); bytes32 id3 = keccak256("c3");
    vm.startPrank(sponsor); drop.createCampaign(id2, BUDGET, PRICE, 2, expiresAt); drop.createCampaign(id3, 3 * uint128(PRICE), PRICE, 100, expiresAt); vm.stopPrank();
    vm.startPrank(attestor);
    for (uint256 i = 0; i < 50; i++) { try drop.claim(ID, key(ID, i)) {} catch {} try drop.claim(id2, key(id2, i)) {} catch {} try drop.claim(id3, key(id3, i)) {} catch {} }
    vm.stopPrank();
    // bound = min(remaining, cap × price) per campaign: 5×0.5 + 2×0.5 + min(3×0.5, 100×0.5) = $5.00
    assertEq(usdc.balanceOf(payout), (5 + 2 + 3) * uint256(PRICE));
}
```

Also: `claim` on an id with no campaign ⇒ `InvalidCampaign` (a transfer would be Critical); attestor `pause(ID, false)` ⇒ `NotSponsor`; attestor `pause(unknownId, true)` ⇒ `NotSponsor`/`InvalidCampaign`, never a silent success. Write the measured bound into the wave report in dollars for the campaign `scripts/demo-seed.ts` ships.

## A2 — Hour-bucket edge (T-02) and the expiry boundary

```solidity
function test_Attack_BucketEdgeAllowsExactlyTwoCaps() public {
    uint256 edge = (block.timestamp / 3600 + 1) * 3600;
    vm.warp(edge - 1);
    vm.startPrank(attestor);
    for (uint256 i = 0; i < CAP; i++) drop.claim(ID, key(ID, i));
    vm.warp(edge);
    assertEq(drop.currentHourBucket(), uint64(edge / 3600));
    for (uint256 i = 0; i < CAP; i++) drop.claim(ID, key(ID, 100 + i));
    vm.expectRevert(IDataDrop.HourlyCap.selector);
    drop.claim(ID, key(ID, 200));
    vm.stopPrank();
    assertEq(usdc.balanceOf(payout), 2 * uint256(CAP) * PRICE);        // the documented 2× bound; more is a finding
}
function test_Attack_ClaimAtExpiresAtReverts() public {
    vm.warp(expiresAt - 1); vm.prank(attestor); drop.claim(ID, key(ID, 1));          // last valid second
    vm.warp(expiresAt);     vm.prank(attestor); vm.expectRevert(IDataDrop.CampaignExpired.selector); drop.claim(ID, key(ID, 2));
}
```

`vm.expectEmit` the `Claimed(id, claimKey, PRICE, hourBucket)` event on both sides of the edge; `hourBucket` must equal `block.timestamp / 3600` (anything else breaks the API's limiter and the dashboard — Med).

## A3 — `claimKey` replay and check order (T-03)

```solidity
function test_Attack_ReplaySameClaimKeyReverts() public {
    bytes32 k = key(ID, 1);
    vm.startPrank(attestor);
    drop.claim(ID, k); assertTrue(drop.claimed(ID, k));
    vm.expectRevert(IDataDrop.AlreadyClaimed.selector); drop.claim(ID, k);
    vm.stopPrank();
}
function test_Attack_ReplayIsReportedBeforeCapOrBudget() public {       // brief §4: claimed check precedes the cap check
    vm.startPrank(attestor);
    for (uint256 i = 0; i < CAP; i++) drop.claim(ID, key(ID, i));
    vm.expectRevert(IDataDrop.AlreadyClaimed.selector); drop.claim(ID, key(ID, 0));   // not HourlyCap
    vm.stopPrank();
}
function test_SameHumanDifferentCampaignIsAllowed() public {             // by design
    bytes32 id2 = keccak256("second-sponsor");
    vm.prank(sponsor); drop.createCampaign(id2, BUDGET, PRICE, CAP, expiresAt);
    vm.startPrank(attestor); drop.claim(ID, key(ID, 1)); drop.claim(id2, key(id2, 1)); vm.stopPrank();
}
```

If a replay increments `spent` or a bucket counter before reverting (impossible with a revert, but check a non-reverting early `return`) ⇒ Critical.

## A4 — Campaign id hijack (T-04) and id reuse after refund

```solidity
function test_Attack_CreateCampaignWithExistingIdReverts() public {
    usdc.mint(stranger, BUDGET);
    vm.startPrank(stranger); usdc.approve(address(drop), type(uint256).max);
    vm.expectRevert(IDataDrop.CampaignExists.selector);
    drop.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);              // same budget so only the id check can revert
    vm.stopPrank();
    assertEq(drop.campaigns(ID).sponsor, sponsor);
}
function test_Attack_IdNotReusableAfterRefund() public {
    vm.warp(expiresAt + 1); vm.prank(sponsor); drop.refund(ID);
    vm.prank(sponsor); vm.expectRevert(IDataDrop.CampaignExists.selector);
    drop.createCampaign(ID, BUDGET, PRICE, CAP, uint64(block.timestamp + 1 days));   // would resurrect claimed[] semantics
}
```

## A5 — Authorisation matrix (T-05)

| caller → | `claim` | `pause(id,true)` | `pause(id,false)` | `refund` | `setAttestor` | `associateHts` |
|---|---|---|---|---|---|---|
| attestor | ok | ok | **`NotSponsor`** | `NotSponsor` | `OwnableUnauthorizedAccount` | `OwnableUnauthorizedAccount` |
| sponsor | `NotAttestor` | ok | ok | ok when refundable | `OwnableUnauthorizedAccount` | `OwnableUnauthorizedAccount` |
| stranger | `NotAttestor` | `NotSponsor` | `NotSponsor` | `NotSponsor` | `OwnableUnauthorizedAccount` | `OwnableUnauthorizedAccount` |
| owner | `NotAttestor` | `NotSponsor` | `NotSponsor` | `NotSponsor` | ok | ok (chainid gate, A9) |

`vm.prank` each cell (`test_Attack_<Caller>_<Function>`); the sponsor of `ID` gets `NotSponsor` on a campaign created by `stranger`. Extra: `setAttestor(address(0))` — if accepted, every claim reverts `NotAttestor` until the owner fixes it (owner-mistake DoS; Low; recommend a zero check). `Ownable2Step`: `transferOwnership(stranger)` does nothing until `acceptOwnership` — assert `owner()` unchanged after the first step.

## A6 — Refund rules (T-06)

```solidity
function test_Attack_RefundBeforeExpiryWithoutPauseReverts() public { vm.prank(sponsor); vm.expectRevert(IDataDrop.NotRefundable.selector); drop.refund(ID); }
function test_Attack_PauseToggleDoesNotShortenThe24h() public {
    vm.startPrank(sponsor);
    drop.pause(ID, true);  vm.warp(block.timestamp + 23 hours);
    drop.pause(ID, false); drop.pause(ID, true);                          // pausedSince resets
    assertEq(drop.campaigns(ID).pausedSince, uint64(block.timestamp));
    vm.warp(block.timestamp + 2 hours);                                   // 25 h since first pause, 2 h since last
    vm.expectRevert(IDataDrop.NotRefundable.selector); drop.refund(ID);
    vm.warp(block.timestamp + 22 hours);                                  // exactly 24 h since the last pause ⇒ eligible (≥)
    drop.refund(ID);
    vm.stopPrank();
    assertEq(usdc.balanceOf(sponsor), 10 * uint256(BUDGET));
}
function test_Attack_NoOpPauseDoesNotResetTheClock() public {            // pause(true) while already paused
    vm.startPrank(sponsor); drop.pause(ID, true); uint64 t0 = drop.campaigns(ID).pausedSince;
    vm.warp(block.timestamp + 1 hours); drop.pause(ID, true);
    assertEq(drop.campaigns(ID).pausedSince, t0); vm.stopPrank();
}
function test_Attack_RefundAmountAfterPartialClaims() public {
    vm.startPrank(attestor); for (uint256 i = 0; i < 3; i++) drop.claim(ID, key(ID, i)); vm.stopPrank();
    vm.warp(expiresAt + 1); vm.prank(sponsor); drop.refund(ID);
    assertEq(usdc.balanceOf(sponsor), 10 * uint256(BUDGET) - 3 * uint256(PRICE));
    IDataDrop.Campaign memory c = drop.campaigns(ID); assertEq(c.budget, c.spent);
    vm.prank(sponsor); vm.expectRevert(IDataDrop.NotRefundable.selector); drop.refund(ID);
    vm.prank(attestor); vm.expectRevert(); drop.claim(ID, key(ID, 9));   // CampaignExpired or BudgetExhausted — never a transfer
}
```

Non-divisible budgets: `budget = 3 × PRICE + 1` ⇒ 3 claims, 4th `BudgetExhausted`, refund returns 1 base unit (fuzz it in A7).

## A7 — Budget accounting: fuzz + invariants (T-07)

Unit guards (`InvalidCampaign`): `budget < price`, `price == 0`, `claimsPerHour == 0`, `expiresAt == block.timestamp`, `expiresAt < block.timestamp`. Then:

```solidity
function testFuzz_SpentNeverExceedsBudgetAndRemainderRefunds(uint96 price, uint128 budget, uint8 n) public {
    price = uint96(bound(price, 1, 1_000_000)); budget = uint128(bound(budget, price, 50 * uint128(price)));
    bytes32 id = keccak256(abi.encode(price, budget, n));
    usdc.mint(sponsor, budget);
    vm.prank(sponsor); drop.createCampaign(id, budget, price, type(uint32).max, expiresAt);
    uint256 ok;
    vm.startPrank(attestor);
    for (uint256 i = 0; i < n; i++) { try drop.claim(id, key(id, i)) { ok++; } catch (bytes memory r) { assertEq(bytes4(r), IDataDrop.BudgetExhausted.selector); break; } }
    vm.stopPrank();
    assertEq(drop.campaigns(id).spent, ok * price); assertLe(drop.campaigns(id).spent, budget);
    vm.warp(expiresAt + 1); vm.prank(sponsor); if (budget > ok * price) drop.refund(id);
    assertEq(usdc.balanceOf(address(drop)), BUDGET);                        // only the setUp campaign's money remains
}
```

Handler additions for `test/invariant/DataDropInvariant.t.sol`: actions `claimFresh`, `claimRepeat` (a key already used), `pauseAs(attestor|sponsor|stranger, bool)`, `refund`, `warp(0..2 h)`, `createCampaign(randId)`, `setAttestor` (owner), `claimAsOldAttestor`. Invariants beyond the builder's five: `invariant_PayoutEqualsSumSpent` (`balanceOf(payout) == Σ spent`), `invariant_RefundedPlusHeldPlusPaidEqualsFunded`, `invariant_OldAttestorNeverSucceedsAfterRotation`, `invariant_ClaimsInHourNeverExceedsCapForAnyBucket` (handler records every bucket touched).

## A8 — Decimals (T-08)

```solidity
function test_Decimals_SixAndPriceInBaseUnits() public view { assertEq(usdc.decimals(), 6); assertEq(PRICE, 0.5e6); }
function test_Attack_EighteenDecimalPriceCannotBeFunded() public {
    uint96 wrong = uint96(0.5e18);                                            // a parseEther() bug
    vm.prank(sponsor); vm.expectRevert();                                     // InvalidCampaign (price > budget) or the transfer — never success
    drop.createCampaign(keccak256("18dec"), BUDGET, wrong, CAP, expiresAt);
}
```

Then: `grep -rn -E '1e18|1 ether|parseEther|10 \*\* 18' packages/contracts/src packages/contracts/script` ⇒ zero hits (tests may mention `1e18` only to assert it is wrong). `Deploy.s.sol` must parse `pricePerClaim` as a **base-unit integer** (`vm.envUint`), never a dollar float; the TS side is covered by semgrep `recharge-usdc-18-decimals`.

## A9 — HTS association and `LEDGER_ONLY` (T-09)

```solidity
address constant HTS = 0x0000000000000000000000000000000000000167;
function test_Attack_AssociateHtsOffHederaReverts() public { vm.prank(owner); vm.expectRevert(IDataDrop.NotHedera.selector); drop.associateHts(address(usdc)); }
function test_AssociateHtsOnHederaCallsPrecompileWithThisAndToken() public {
    vm.chainId(296); vm.etch(HTS, type(HtsPrecompileMock).runtimeCode);
    vm.prank(owner); drop.associateHts(address(usdc));
    (address acct, address tok) = HtsPrecompileMock(HTS).last();            // whatever accessor the builder's mock exposes
    assertEq(acct, address(drop)); assertEq(tok, address(usdc));
    vm.prank(owner); vm.expectRevert(); drop.associateHts(address(0xBEEF));   // token mode: only usdc may be associated
    vm.prank(stranger); vm.expectRevert(); drop.associateHts(address(usdc));
}
function test_Attack_HtsFailureCodeReverts() public {                       // mock returns 167 (TOKEN_ALREADY_ASSOCIATED) or any rc != 22
    vm.chainId(296); vm.etch(HTS, type(HtsPrecompileMock).runtimeCode); HtsPrecompileMock(HTS).setResponse(int64(167));
    vm.prank(owner); vm.expectRevert(); drop.associateHts(address(usdc));
}
function test_LedgerOnlyMovesNoTokensAndSaysSo() public {
    vm.expectEmit(false, false, false, true); emit IDataDrop.ModeSet(true);
    DataDrop lo = new DataDrop(IERC20(address(0)), payout, attestor, owner);
    assertTrue(lo.ledgerOnly()); assertEq(lo.usdc(), address(0));
    vm.prank(sponsor); lo.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);   // no transferFrom
    vm.prank(attestor); lo.claim(ID, key(ID, 1));
    assertEq(usdc.balanceOf(payout), 0); assertEq(lo.campaigns(ID).spent, PRICE);
}
function test_Attack_TokenModeFailingTransferFromReverts() public {           // HTS facade returning false / no allowance
    vm.prank(stranger); vm.expectRevert(); drop.createCampaign(keccak256("x"), BUDGET, PRICE, CAP, expiresAt);   // no approval, no balance
    assertEq(drop.campaigns(keccak256("x")).sponsor, address(0));
}
```

A token-mode `createCampaign` that records a budget without receiving it is **Critical** ("sponsor money never moved" — the DA's attack, now true). `Deploy.s.sol` must `require(dataDrop.ledgerOnly() == (usdc == address(0)))` and call `associateHts` on 295/296 in the same broadcast (brief §4).

## A10 — Payout and owner powers (T-10)

`forge inspect DataDrop abi --json` → the only state-changing functions are `createCampaign, claim, pause, refund, setAttestor, associateHts, transferOwnership, acceptOwnership, renounceOwnership` (the builder's `test_NoTokenMovesOutsideThreeFunctions` does this — read it; if it hard-codes the list, make sure a `sweep` would fail it). `forge inspect DataDrop storage-layout`: `usdc` and `payout` absent (immutable). `renounceOwnership` leaves `setAttestor` dead forever — Low, but say so in the README's key table.

## A11 — Reentrancy / CEI / slither (T-11)

`ReentrantToken.transfer` re-enters `claim(ID, otherKey)` as the attestor (the token can `vm.prank`-less re-enter only if the attestor *is* the token — so give the reentrant campaign a `DataDrop` whose attestor is the token contract): expect `ReentrancyGuardReentrantCall`; `spent == PRICE`; the inner key not claimed. Re-enter `refund` from `transfer` during `refund` ⇒ revert, balance conserved. Then:

```sh
cd packages/contracts && slither . --config-file ../../security/redteam/tools/slither.config.json
forge snapshot --check --tolerance 5      # claim ≤ 100 000 gas (brief §6)
```

## A12 — ABI drift (T-12)

`pnpm abi:check` passes; `abi/DataDrop.json` has `Claimed(bytes32 indexed, bytes32 indexed, uint96, uint64)` and every error in INTERFACES `DATADROP_ERRORS`; the `@ethglobal/contracts/abi/*` export resolves from a TS package (`node -e "require.resolve('@ethglobal/contracts/abi/DataDrop.json')"`).

## A13 — `MockUSDC3009` authorization matrix (T-13)

Sign with `vm.sign(ANVIL_KEY_5, digest)` (the vectors script uses #5 too) and `usdc.DOMAIN_SEPARATOR()`:

| Case | Expected |
|---|---|
| valid `transferWithAuthorization` (both overloads), anyone as `msg.sender` | transfer; `authorizationState(from, nonce) == true`; `AuthorizationUsed` |
| replay | revert |
| `validBefore == block.timestamp` / `validAfter == block.timestamp` | revert (strict `<`/`>`) |
| wrong signer (`from` = #5, signed by #6) | revert |
| `value` in the call ≠ signed value | revert |
| `receiveWithAuthorization` by `msg.sender != to` | revert |
| `receiveWithAuthorization` by `to` | ok |
| `cancelAuthorization` (signed by authorizer, submitted by anyone) then transfer | revert; `AuthorizationCanceled` |
| same nonce across transfer/receive variants | second reverts |
| `to == address(0)` | ERC-20 revert |
| EIP-2098 64-byte signature | **revert** (`ECDSAInvalidSignatureLength`) — the mock accepts 65 bytes only; the TS side must expand compact forms before calling (E3) |
| high-`s` (`s' = n − s`, `v' = v ^ 1`) | revert `ECDSAInvalidSignatureS` (T-17) |
| `mint` by anyone | works (test token) — `Deploy.s.sol` must never deploy it off Anvil (A19) |

## A14 — Cross-chain / cross-contract replay (T-14)

Sign under chainId 31337; `vm.chainId(84532)`; `usdc.DOMAIN_SEPARATOR()` now differs (OZ `EIP712` recomputes when `block.chainid != _cachedChainId`) and the old signature reverts. A second `MockUSDC3009` rejects the first one's signatures (`verifyingContract`). Record the separator values for `fixtures/eip3009/domains.json`. `MockUSDC3009` is `EIP712("USD Coin","2")` by design; the real Base Sepolia USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`) is `name() == "USDC"` (API-FACTS §7, INTERFACES A-21) — so a Foundry test must never be the evidence for the Base Sepolia domain; the TS side reads it from `accepts[].extra` (`wave1-octroi.md` E1).

## A15 — Settlement front-run → paid-but-denied (T-15)

In Foundry: `stranger` submits the human's signed `transferWithAuthorization` first; assert `authorizationState(human, nonce) == true`, `balanceOf(payout) += value`, and that a second submission reverts — these are the on-chain facts `SelfRunFacilitator.settle` must read to answer `success: true` with the stranger's tx. The TS half is `wave1-adapters.md` L10; the HTTP half is wave 2 `frontrun.attack.test.ts`.

## A16 / A17 — Relayer griefing, malleability

TypeScript (`wave1-octroi.md` E4–E6). Foundry side done in A13.

## A18 — Rotation drill, local rehearsal (T-01, THREAT-MODEL §6.7)

```solidity
function test_Drill_PauseRotateUnpause() public {
    address newAttestor = makeAddr("attestor-2");
    vm.startPrank(attestor); for (uint256 i = 0; i < CAP - 1; i++) drop.claim(ID, key(ID, i)); vm.stopPrank();   // anomaly
    vm.prank(attestor); drop.pause(ID, true);                                                     // stolen key can pause — good
    vm.prank(attestor); vm.expectRevert(IDataDrop.CampaignPaused.selector); drop.claim(ID, key(ID, 50));
    vm.prank(owner); drop.setAttestor(newAttestor);                                               // rotate (cold key)
    vm.prank(attestor); vm.expectRevert(IDataDrop.NotAttestor.selector); drop.claim(ID, key(ID, 51));
    vm.prank(attestor); vm.expectRevert(IDataDrop.NotSponsor.selector);  drop.pause(ID, false);
    vm.prank(sponsor); drop.pause(ID, false);                                                     // only the sponsor unpauses
    vm.prank(newAttestor); drop.claim(ID, key(ID, 52));
}
```

Against Anvil after `pnpm dev:chain` (addresses in `deploy/addresses.anvil.json`; Anvil keys only):

```sh
cast send $DATADROP "pause(bytes32,bool)" $ID true   --private-key $ANVIL_KEY_2       # attestor
cast send $DATADROP "setAttestor(address)" $NEW      --private-key $ANVIL_KEY_0       # owner
cast call $DATADROP "attestor()(address)"
cast send $DATADROP "claim(bytes32,bytes32)" $ID $KEY --private-key $ANVIL_KEY_2      # expect NotAttestor()
cast send $DATADROP "pause(bytes32,bool)" $ID false  --private-key $ANVIL_KEY_3       # sponsor
```

Time it; Friday's live drill repeats it on Hedera testnet with `ATTESTOR_PRIVATE_KEY` rotated in the VPS env and `GET /healthz` showing the new attestor (THREAT-MODEL §7 item 1).

## A19 — Deploy script (`script/Deploy.s.sol`, `test/Deploy.t.sol`)

- `CHAIN` mismatch aborts (scaffold test).
- 31337: deploys `MockUSDC3009`, mints to #0–#7, deploys `DataDrop(mock, PAYOUT_ADDRESS=#1, ATTESTOR_ADDRESS=#2, OWNER_ADDRESS=#0)`; writes `deploy/addresses.anvil.json` in the INTERFACES §6.3 shape; the file is git-ignored.
- `vm.chainId(84532)` / `296` dry run: **no** `MockUSDC3009` deployment; `usdc` from `chains.json` (`usdc`/`usdcHts` present on **every** chain entry, alphabetical struct); `LEDGER_ONLY=true` ⇒ `address(0)` and `ledgerOnly()`; 296 ⇒ `associateHts` in the same broadcast; `require(ledgerOnly() == (usdc == 0))`.
- No private key literal in `script/` (`grep -rn 0xac0974 script/` ⇒ none; the only default lives in `scripts/dev-chain.sh`); live `broadcast/` files are committed as disclosure evidence and contain no key material.

## Reporting

Per A-item: test path, result (`failed as expected` / `FINDING RT-W1-0xx`), fuzz seed when a counter-example was found. Open the report with the drain bound in dollars for the shipped demo campaign and the A4/A5/A9 verdicts — those are the rows that become Criticals if wrong.
