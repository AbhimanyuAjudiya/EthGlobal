// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {DataDrop} from "../../src/DataDrop.sol";
import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";
import {RT_Base} from "./RT_Base.sol";
import {
    RT_FeeOnTransferToken,
    RT_TransferReturnsFalseToken,
    RT_NoReturnToken,
    RT_RevertingToken,
    RT_InflatingToken,
    RT_BlacklistToken,
    RT_ReenterAnyToken,
    RT_RawHts
} from "./mocks/RT_Tokens.sol";

/// @notice Red-team adversarial unit attacks on DataDrop beyond the builder's test_Attack_* set.
///         Green = the attack failed (property holds). Tests tagged `// RT-FINDING` are expected RED until fixed.
contract RT_DataDropTest is RT_Base {
    address internal constant HTS = 0x0000000000000000000000000000000000000167;

    // ───────────────────────────── boundary arithmetic ─────────────────────────────

    /// Property: claimsPerHour == type(uint32).max never overflows the bucket counter; the cap still bites at max.
    function test_RT_CapUint32MaxCounterSaturatesWithoutOverflow() public {
        bytes32 id = keccak256("max-cap");
        vm.prank(sponsor);
        drop.createCampaign(id, BUDGET, PRICE, type(uint32).max, expiresAt);
        uint64 b = drop.currentHourBucket();
        // _claimsInHour is slot 5: mapping(bytes32 => mapping(uint64 => uint32))
        bytes32 slot = keccak256(abi.encode(uint256(b), keccak256(abi.encode(id, uint256(5)))));
        vm.store(address(drop), slot, bytes32(uint256(type(uint32).max - 1)));
        assertEq(drop.claimsInHour(id, b), type(uint32).max - 1);
        vm.startPrank(attestor);
        drop.claim(id, key(id, 1));
        assertEq(drop.claimsInHour(id, b), type(uint32).max);
        vm.expectRevert(IDataDrop.HourlyCap.selector);
        drop.claim(id, key(id, 2));
        vm.stopPrank();
    }

    // test_RT_MaxBudgetAndPriceNoOverflow_RTFINDING moved to test/regression/T07_BudgetAccounting.t.sol after the fix (fixed finding, now a passing regression).

    /// Property: expiresAt in the past, == now, price 0, cap 0, budget < price are all InvalidCampaign; expiresAt = now+1
    ///           is accepted but the campaign is claimable for exactly one second and refundable from expiresAt.
    function test_RT_DegenerateCampaignParams() public {
        uint64 nowTs = uint64(block.timestamp);
        vm.startPrank(sponsor);
        vm.expectRevert(IDataDrop.InvalidCampaign.selector);
        drop.createCampaign(keccak256("a"), BUDGET, PRICE, CAP, nowTs - 1);
        vm.expectRevert(IDataDrop.InvalidCampaign.selector);
        drop.createCampaign(keccak256("b"), BUDGET, PRICE, CAP, nowTs);
        vm.expectRevert(IDataDrop.InvalidCampaign.selector);
        drop.createCampaign(keccak256("c"), BUDGET, 0, CAP, expiresAt);
        vm.expectRevert(IDataDrop.InvalidCampaign.selector);
        drop.createCampaign(keccak256("d"), BUDGET, PRICE, 0, expiresAt);
        vm.expectRevert(IDataDrop.InvalidCampaign.selector);
        drop.createCampaign(keccak256("e"), PRICE - 1, PRICE, CAP, expiresAt);
        drop.createCampaign(keccak256("f"), PRICE, PRICE, CAP, nowTs + 1);
        vm.stopPrank();
        vm.prank(attestor);
        drop.claim(keccak256("f"), key(ID, 1));
        assertEq(drop.campaigns(keccak256("f")).spent, PRICE);
    }

    /// Property: a budget of k·price + r refunds exactly r after k claims; 1-unit price with 1-unit budget works.
    function testFuzz_RT_NonMultipleBudgetRefundsDust(uint96 price, uint8 k, uint96 r) public {
        price = uint96(bound(price, 1, 5_000_000));
        k = uint8(bound(k, 1, 20));
        r = uint96(bound(r, 0, price - 1));
        uint128 budget = uint128(k) * price + r;
        bytes32 id = keccak256(abi.encode("dust", price, k, r));
        vm.prank(sponsor);
        drop.createCampaign(id, budget, price, type(uint32).max, expiresAt);
        vm.startPrank(attestor);
        for (uint256 i = 0; i < k; i++) {
            drop.claim(id, key(id, i));
        }
        vm.expectRevert(IDataDrop.BudgetExhausted.selector);
        drop.claim(id, key(id, 999));
        vm.stopPrank();
        uint256 before = usdc.balanceOf(sponsor);
        vm.warp(expiresAt);
        vm.prank(sponsor);
        if (r == 0) {
            vm.expectRevert(IDataDrop.NotRefundable.selector);
            drop.refund(id);
        } else {
            drop.refund(id);
            assertEq(usdc.balanceOf(sponsor) - before, r);
        }
        assertEq(usdc.balanceOf(address(drop)), BUDGET); // only setUp's campaign remains
    }

    /// Property: the hour bucket boundary is exactly `t % 3600 == 0`; t=edge-1 and t=edge are different buckets and the
    ///           Claimed.hourBucket equals block.timestamp/3600 on both sides.
    function test_RT_BucketOffByOne() public {
        uint256 edge = (block.timestamp / 3600 + 1) * 3600;
        vm.warp(edge - 1);
        vm.expectEmit(true, true, false, true, address(drop));
        emit IDataDrop.Claimed(ID, key(ID, 1), PRICE, uint64((edge - 1) / 3600));
        vm.prank(attestor);
        drop.claim(ID, key(ID, 1));
        vm.warp(edge);
        vm.expectEmit(true, true, false, true, address(drop));
        emit IDataDrop.Claimed(ID, key(ID, 2), PRICE, uint64(edge / 3600));
        vm.prank(attestor);
        drop.claim(ID, key(ID, 2));
        assertEq(drop.claimsInHour(ID, uint64((edge - 1) / 3600)), 1);
        assertEq(drop.claimsInHour(ID, uint64(edge / 3600)), 1);
    }

    // ───────────────────────────── refund adversarial sequences ─────────────────────────────

    /// Property: refund while paused for 24h-1s reverts; at exactly 24h it pays budget−spent once; a second refund and
    ///           any later claim (even after the sponsor unpauses) never move tokens.
    function test_RT_RefundPausedBoundaryThenUnpauseThenClaim() public {
        vm.prank(attestor);
        drop.claim(ID, key(ID, 1));
        vm.prank(sponsor);
        drop.pause(ID, true);
        uint64 t0 = uint64(block.timestamp);
        vm.warp(t0 + 24 hours - 1);
        vm.prank(sponsor);
        vm.expectRevert(IDataDrop.NotRefundable.selector);
        drop.refund(ID);
        vm.warp(t0 + 24 hours);
        uint256 before = usdc.balanceOf(sponsor);
        vm.prank(sponsor);
        drop.refund(ID);
        assertEq(usdc.balanceOf(sponsor) - before, BUDGET - PRICE);
        vm.prank(sponsor);
        vm.expectRevert(IDataDrop.NotRefundable.selector);
        drop.refund(ID);
        vm.prank(sponsor);
        drop.pause(ID, false);
        vm.prank(attestor);
        vm.expectRevert(IDataDrop.BudgetExhausted.selector);
        drop.claim(ID, key(ID, 2));
        // re-pause, wait, refund again: nothing left
        vm.prank(sponsor);
        drop.pause(ID, true);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(sponsor);
        vm.expectRevert(IDataDrop.NotRefundable.selector);
        drop.refund(ID);
        assertEq(usdc.balanceOf(address(drop)), 0);
        assertEq(usdc.balanceOf(payout), PRICE);
    }

    /// Property: an attestor pause starts the sponsor's 24 h clock, but a stolen attestor key can never refund, and
    ///           a stranger can never refund on the sponsor's behalf.
    function test_RT_AttestorPauseNeverLetsAnyoneButSponsorRefund() public {
        vm.prank(attestor);
        drop.pause(ID, true);
        vm.warp(block.timestamp + 30 hours);
        vm.prank(attestor);
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.refund(ID);
        vm.prank(stranger);
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.refund(ID);
        vm.prank(owner);
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.refund(ID);
        vm.prank(sponsor);
        drop.refund(ID);
    }

    /// Property: refund after expiry while still paused pays once; pausedSince is irrelevant once expired.
    function test_RT_RefundExpiredWhilePausedRecently() public {
        vm.warp(expiresAt - 1);
        vm.prank(sponsor);
        drop.pause(ID, true);
        vm.warp(expiresAt);
        vm.prank(sponsor);
        drop.refund(ID);
        assertEq(usdc.balanceOf(address(drop)), 0);
    }

    // ───────────────────────────── access control / reentrancy ─────────────────────────────

    /// Property: a token that IS the attestor and re-enters during claim's payout transfer can pause (allowed) but can
    ///           never unpause, refund, create or claim again (guard / NotSponsor).
    function test_RT_ReentrantAttestorTokenCannotUnpauseOrNest() public {
        RT_ReenterAnyToken t = new RT_ReenterAnyToken();
        DataDrop d = new DataDrop(IERC20(address(t)), payout, address(t), owner);
        t.mint(sponsor, 10 * uint256(BUDGET));
        vm.startPrank(sponsor);
        t.approve(address(d), type(uint256).max);
        d.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);
        bytes32 id2 = keccak256("paused-one");
        d.createCampaign(id2, BUDGET, PRICE, CAP, expiresAt);
        d.pause(id2, true);
        vm.stopPrank();

        bytes[] memory p = new bytes[](5);
        p[0] = abi.encodeCall(IDataDrop.pause, (id2, false));
        p[1] = abi.encodeCall(IDataDrop.claim, (ID, key(ID, 2)));
        p[2] = abi.encodeCall(IDataDrop.refund, (ID));
        p[3] = abi.encodeCall(IDataDrop.createCampaign, (keccak256("nested"), 1, 1, 1, expiresAt));
        p[4] = abi.encodeCall(IDataDrop.pause, (ID, true));
        t.arm(address(d), p);
        t.exec(address(d), abi.encodeCall(IDataDrop.claim, (ID, key(ID, 1))));

        assertEq(t.resultCount(), 5);
        assertFalse(t.oks(0));
        assertEq(_sel(t.results(0)), IDataDrop.NotSponsor.selector);
        assertFalse(t.oks(1));
        assertEq(_sel(t.results(1)), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        assertFalse(t.oks(2));
        assertEq(_sel(t.results(2)), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        assertFalse(t.oks(3));
        assertEq(_sel(t.results(3)), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        assertTrue(t.oks(4)); // pause(true) by the attestor is allowed even mid-claim (pause is not nonReentrant)
        assertTrue(d.campaigns(id2).paused);
        assertTrue(d.campaigns(ID).paused);
        assertEq(d.campaigns(ID).spent, PRICE);
        assertFalse(d.claimed(ID, key(ID, 2)));
        assertEq(t.balanceOf(address(d)), 2 * uint256(BUDGET) - PRICE);
    }

    /// Property: a token that IS the sponsor and re-enters during refund cannot refund twice or claim.
    function test_RT_ReentrantSponsorTokenCannotDoubleRefund() public {
        RT_ReenterAnyToken t = new RT_ReenterAnyToken();
        DataDrop d = new DataDrop(IERC20(address(t)), payout, attestor, owner);
        t.mint(address(t), BUDGET);
        t.exec(address(t), abi.encodeCall(IERC20.approve, (address(d), BUDGET)));
        t.exec(address(d), abi.encodeCall(IDataDrop.createCampaign, (ID, BUDGET, PRICE, CAP, expiresAt)));
        vm.warp(expiresAt);
        bytes[] memory p = new bytes[](2);
        p[0] = abi.encodeCall(IDataDrop.refund, (ID));
        p[1] = abi.encodeCall(IDataDrop.pause, (ID, false));
        t.arm(address(d), p);
        t.exec(address(d), abi.encodeCall(IDataDrop.refund, (ID)));
        assertEq(_sel(t.results(0)), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        assertTrue(t.oks(1)); // no-op unpause by the sponsor itself: harmless
        assertEq(t.balanceOf(address(d)), 0);
        assertEq(t.balanceOf(address(t)), BUDGET);
        assertEq(d.campaigns(ID).budget, 0);
    }

    /// Property: the same id cannot be taken over by a second sponsor (T-04) — the first sponsor keeps every power.
    function test_RT_SameIdTwoSponsorsFirstKeepsControl() public {
        usdc.mint(stranger, BUDGET);
        vm.startPrank(stranger);
        usdc.approve(address(drop), type(uint256).max);
        vm.expectRevert(IDataDrop.CampaignExists.selector);
        drop.createCampaign(ID, 1, 1, type(uint32).max, uint64(block.timestamp + 1));
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.pause(ID, false);
        vm.stopPrank();
        assertEq(drop.campaigns(ID).sponsor, sponsor);
        assertEq(drop.campaigns(ID).budget, BUDGET);
    }

    // test_RT_IdSquatBlocksIntendedSponsor_RTFINDING moved to test/regression/T04_CampaignIdHijack.t.sol after the fix (fixed finding, now a passing regression).

    /// Property: rotation race — after setAttestor, the old key's in-flight claim and pause revert; the new key claims
    ///           the same claimKey exactly once; rotating back to an old key re-enables it (owner's choice, by design).
    function test_RT_RotationRaceOldKeyFrontRun() public {
        address a2 = makeAddr("attestor-2");
        vm.prank(owner);
        drop.setAttestor(a2);
        bytes32 k = key(ID, 7);
        vm.prank(attestor);
        vm.expectRevert(IDataDrop.NotAttestor.selector);
        drop.claim(ID, k);
        vm.prank(attestor);
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.pause(ID, true);
        vm.prank(a2);
        drop.claim(ID, k);
        vm.prank(a2);
        vm.expectRevert(IDataDrop.AlreadyClaimed.selector);
        drop.claim(ID, k);
        vm.prank(owner);
        drop.setAttestor(attestor);
        vm.prank(a2);
        vm.expectRevert(IDataDrop.NotAttestor.selector);
        drop.claim(ID, key(ID, 8));
    }

    /// Property: two-step ownership — the pending owner has no power; the owner can cancel by nominating address(0);
    ///           a cancelled nominee cannot accept; the old owner loses setAttestor after accept.
    function test_RT_TwoStepOwnershipMisuse() public {
        vm.prank(owner);
        drop.transferOwnership(stranger);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        drop.setAttestor(stranger);
        vm.prank(owner);
        drop.transferOwnership(address(0)); // cancel
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        drop.acceptOwnership();
        address cold = makeAddr("cold");
        vm.prank(owner);
        drop.transferOwnership(cold);
        vm.prank(cold);
        drop.acceptOwnership();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        drop.setAttestor(owner);
        assertEq(drop.owner(), cold);
    }

    // test_RT_RenounceOwnershipDisabled_RTFINDING moved to test/regression/T01_AttestorDrainBound.t.sol after the fix (fixed finding, now a passing regression).

    // ───────────────────────────── token edge cases ─────────────────────────────

    /// Property: a fee-on-transfer token cannot create an under-funded campaign (BudgetNotReceived).
    function test_RT_FeeOnTransferInboundRejected() public {
        RT_FeeOnTransferToken t = new RT_FeeOnTransferToken();
        DataDrop d = new DataDrop(IERC20(address(t)), payout, attestor, owner);
        t.mint(sponsor, BUDGET);
        vm.startPrank(sponsor);
        t.approve(address(d), BUDGET);
        vm.expectRevert(DataDrop.BudgetNotReceived.selector);
        d.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);
        vm.stopPrank();
    }

    /// Property (documented limit): with an OUTBOUND-only fee the contract cannot detect short payment; Claimed.paid
    ///           overstates what payout received. Holds only because `usdc` is immutable Circle USDC (no fee switch).
    function test_RT_FeeOnTransferOutboundIsUndetected_Documented() public {
        RT_FeeOnTransferToken t = new RT_FeeOnTransferToken();
        t.setFee(false, true);
        DataDrop d = new DataDrop(IERC20(address(t)), payout, attestor, owner);
        t.mint(sponsor, BUDGET);
        vm.startPrank(sponsor);
        t.approve(address(d), BUDGET);
        d.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);
        vm.stopPrank();
        vm.prank(attestor);
        d.claim(ID, key(ID, 1));
        assertEq(t.balanceOf(payout), PRICE - PRICE / 100); // event said PRICE
        assertEq(d.campaigns(ID).spent, PRICE);
    }

    /// Property: an outbound transfer returning false reverts the whole claim/refund — no state change, no event.
    function test_RT_TransferReturnsFalseRevertsAtomically() public {
        RT_TransferReturnsFalseToken t = new RT_TransferReturnsFalseToken();
        DataDrop d = new DataDrop(IERC20(address(t)), payout, attestor, owner);
        t.mint(sponsor, BUDGET);
        vm.startPrank(sponsor);
        t.approve(address(d), BUDGET);
        d.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);
        vm.stopPrank();
        vm.prank(attestor);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(t)));
        d.claim(ID, key(ID, 1));
        assertFalse(d.claimed(ID, key(ID, 1)));
        assertEq(d.campaigns(ID).spent, 0);
        assertEq(d.claimsInHour(ID, d.currentHourBucket()), 0);
    }

    /// Property: USDT-style no-return tokens work end to end (SafeERC20).
    function test_RT_NoReturnTokenWorks() public {
        RT_NoReturnToken t = new RT_NoReturnToken();
        DataDrop d = new DataDrop(IERC20(address(t)), payout, attestor, owner);
        t.mint(sponsor, BUDGET);
        vm.startPrank(sponsor);
        t.approve(address(d), BUDGET);
        d.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);
        vm.stopPrank();
        vm.prank(attestor);
        d.claim(ID, key(ID, 1));
        assertEq(t.balanceOf(payout), PRICE);
        vm.warp(expiresAt);
        vm.prank(sponsor);
        d.refund(ID);
        assertEq(t.balanceOf(sponsor), BUDGET - PRICE);
    }

    /// Property: a token that credits more than `budget` is rejected too (exact delta, not ≥).
    function test_RT_InflatingTokenRejected() public {
        RT_InflatingToken t = new RT_InflatingToken();
        DataDrop d = new DataDrop(IERC20(address(t)), payout, attestor, owner);
        t.mint(sponsor, BUDGET);
        vm.startPrank(sponsor);
        t.approve(address(d), BUDGET);
        vm.expectRevert(DataDrop.BudgetNotReceived.selector);
        d.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);
        vm.stopPrank();
    }

    /// Property: a token that starts reverting (issuer pause) blocks claims atomically; nothing is half-applied.
    function test_RT_RevertingTokenAtomic() public {
        RT_RevertingToken t = new RT_RevertingToken();
        DataDrop d = new DataDrop(IERC20(address(t)), payout, attestor, owner);
        t.mint(sponsor, BUDGET);
        vm.startPrank(sponsor);
        t.approve(address(d), BUDGET);
        d.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);
        vm.stopPrank();
        t.breakIt();
        vm.prank(attestor);
        vm.expectRevert(bytes("token paused"));
        d.claim(ID, key(ID, 1));
        assertEq(d.campaigns(ID).spent, 0);
    }

    // test_RT_BlacklistedSponsorCanStillRecoverFunds_RTFINDING moved to test/regression/T10_RefundRecipient.t.sol after the fix (fixed finding, now a passing regression).

    /// Property (documented): a blacklisted/unassociated payout bricks every claim; the campaign stays refundable.
    function test_RT_BlacklistedPayoutBricksClaimsButRefundWorks() public {
        RT_BlacklistToken t = new RT_BlacklistToken();
        DataDrop d = new DataDrop(IERC20(address(t)), payout, attestor, owner);
        t.mint(sponsor, BUDGET);
        vm.startPrank(sponsor);
        t.approve(address(d), BUDGET);
        d.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);
        vm.stopPrank();
        t.setBlacklisted(payout, true);
        vm.prank(attestor);
        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        d.claim(ID, key(ID, 1));
        vm.warp(expiresAt);
        vm.prank(sponsor);
        d.refund(ID);
        assertEq(t.balanceOf(sponsor), BUDGET);
    }

    // ───────────────────────────── HTS failure paths ─────────────────────────────

    function _rawHts(bytes memory ret, bool rv) internal {
        vm.chainId(296);
        vm.etch(HTS, type(RT_RawHts).runtimeCode);
        RT_RawHts(HTS).set(ret, rv);
    }

    /// Property: a reverting precompile yields HtsAssociationFailed(21), not an opaque revert.
    function test_RT_HtsRevertingPrecompile() public {
        _rawHts(abi.encode(int64(22)), true);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataDrop.HtsAssociationFailed.selector, int64(21)));
        drop.associateHts(address(usdc));
    }

    /// Property: a short (<32 B) return yields HtsAssociationFailed(21).
    function test_RT_HtsShortReturn() public {
        _rawHts(hex"16", false);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataDrop.HtsAssociationFailed.selector, int64(21)));
        drop.associateHts(address(usdc));
    }

    /// Property: a 32-byte return whose value is outside int64 never counts as SUCCESS (it reverts; the error is
    ///           opaque — abi.decode validation — rather than HtsAssociationFailed; diagnostic-only, noted in report).
    function test_RT_HtsDirtyReturnNeverSucceeds() public {
        _rawHts(abi.encodePacked(bytes32(uint256(22) | (uint256(1) << 200))), false);
        vm.prank(owner);
        vm.expectRevert();
        drop.associateHts(address(usdc));
    }

    /// Property: SUCCESS encoded as int256 22 with trailing bytes still succeeds (Hedera returns exactly 32 bytes).
    function test_RT_HtsLongReturnSuccess() public {
        _rawHts(abi.encodePacked(abi.encode(int64(22)), bytes32(uint256(7))), false);
        vm.prank(owner);
        drop.associateHts(address(usdc));
    }

    /// Property: mainnet 295 is also accepted; any other chain id (incl. 297) is NotHedera.
    function test_RT_HtsChainGate() public {
        vm.etch(HTS, hex"00");
        vm.chainId(297);
        vm.prank(owner);
        vm.expectRevert(IDataDrop.NotHedera.selector);
        drop.associateHts(address(usdc));
        _rawHts(abi.encode(int64(22)), false);
        vm.chainId(295);
        vm.prank(owner);
        drop.associateHts(address(usdc));
    }

    // ───────────────────────────── LEDGER_ONLY ─────────────────────────────

    // test_RT_LedgerOnlyStrangerCannotDeclareUnbackedBudget_RTFINDING moved to test/regression/T09_HtsAssociation.t.sol after the fix (fixed finding, now a passing regression).

    // ───────────────────────────── gas griefing ─────────────────────────────

    /// Property: no unbounded loops — claim/pause/refund gas does not grow with #campaigns, #claims or #buckets.
    function test_RT_ClaimGasIsConstant() public {
        bytes32 id = keccak256("gas");
        vm.prank(sponsor);
        drop.createCampaign(id, BUDGET, 1, type(uint32).max, expiresAt);
        vm.prank(attestor);
        drop.claim(id, key(id, 0)); // warm payout balance slot like a steady state
        vm.prank(attestor);
        uint256 g0 = gasleft();
        drop.claim(id, key(id, 1));
        uint256 first = g0 - gasleft();
        for (uint256 i = 0; i < 300; i++) {
            vm.prank(sponsor);
            drop.createCampaign(keccak256(abi.encode("filler", i)), 1, 1, 1, expiresAt);
            vm.prank(attestor);
            drop.claim(id, key(id, 1000 + i));
            if (i % 50 == 0) vm.warp(block.timestamp + 3600);
        }
        vm.prank(attestor);
        g0 = gasleft();
        drop.claim(id, key(id, 99_999));
        uint256 later = g0 - gasleft();
        assertApproxEqAbs(later, first, 25_000); // only cold/warm & zero/non-zero SSTORE differences
    }
}
