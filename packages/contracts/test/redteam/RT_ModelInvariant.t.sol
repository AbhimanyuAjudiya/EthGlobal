// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {DataDrop} from "../../src/DataDrop.sol";
import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";
import {MockUSDC3009} from "../../src/MockUSDC3009.sol";
import {RT_ModelHandler} from "./handlers/RT_ModelHandler.sol";

/// @notice Red-team invariant campaign over adversarial create/claim/pause/refund/rotate/warp interleavings.
contract RT_ModelInvariantTest is StdInvariant, Test {
    RT_ModelHandler internal h;
    DataDrop internal tokenDrop;
    DataDrop internal ledgerDrop;
    MockUSDC3009 internal usdc;
    address internal owner = makeAddr("rt-owner");
    address internal payout = makeAddr("rt-payout");

    function setUp() public {
        vm.warp(1_762_200_000);
        usdc = new MockUSDC3009();
        tokenDrop = new DataDrop(IERC20(address(usdc)), payout, makeAddr("rt-attestor-0"), owner);
        ledgerDrop = new DataDrop(IERC20(address(0)), payout, makeAddr("rt-attestor-0"), owner);
        h = new RT_ModelHandler(tokenDrop, ledgerDrop, usdc, owner, payout);
        targetContract(address(h));
    }

    /// Property: every revert selector (and every success) equals what the INTERFACES §6.1 model predicts.
    function invariant_RT_ContractMatchesReferenceModel() public view {
        assertEq(h.mismatches(), 0, h.lastBreak());
    }

    /// Property: LEDGER_ONLY and token mode give identical outcomes and byte-identical DataDrop events for funded input.
    function invariant_RT_LedgerOnlyParity() public view {
        assertEq(h.parityBreaks(), 0, h.lastBreak());
        for (uint256 i = 0; i < h.idCount(); i++) {
            bytes32 id = h.ids(i);
            assertEq(keccak256(abi.encode(tokenDrop.campaigns(id))), keccak256(abi.encode(ledgerDrop.campaigns(id))));
        }
    }

    /// Property: on-chain state == model state for every campaign (sponsor, budget, spent, paused, pausedSince …).
    function invariant_RT_StateEqualsModel() public view {
        for (uint256 i = 0; i < h.idCount(); i++) {
            bytes32 id = h.ids(i);
            IDataDrop.Campaign memory c = tokenDrop.campaigns(id);
            RT_ModelHandler.M memory m = h.model(id);
            assertEq(c.sponsor, m.sponsor);
            assertEq(c.pricePerClaim, m.price);
            assertEq(c.budget, m.budget);
            assertEq(c.spent, m.spent);
            assertEq(c.claimsPerHour, m.cap);
            assertEq(c.expiresAt, m.expiresAt);
            assertEq(c.pausedSince, m.pausedSince);
            assertEq(c.paused, m.paused);
            uint64[] memory bs = h.bucketsOf(id);
            for (uint256 j = 0; j < bs.length; j++) {
                assertEq(tokenDrop.claimsInHour(id, bs[j]), h.modelInHour(id, bs[j]));
                assertLe(tokenDrop.claimsInHour(id, bs[j]), c.claimsPerHour);
            }
        }
    }

    /// Property: conservation — held == Σ(budget − spent) == funded − refunded − paid; payout == Σ spent;
    ///           each sponsor holds exactly minted − funded + refunded. No token is created or lost.
    function invariant_RT_TokenConservation() public view {
        uint256 held;
        uint256 spent;
        for (uint256 i = 0; i < h.idCount(); i++) {
            IDataDrop.Campaign memory c = tokenDrop.campaigns(h.ids(i));
            held += c.budget - c.spent;
            spent += c.spent;
        }
        assertEq(usdc.balanceOf(address(tokenDrop)), held);
        assertEq(held, h.ghostFunded() - h.ghostRefunded() - h.ghostPaid());
        assertEq(usdc.balanceOf(payout), h.ghostPaid());
        assertEq(usdc.balanceOf(payout), spent);
        for (uint256 i = 0; i < 3; i++) {
            address s = h.sponsorAt(i);
            assertEq(usdc.balanceOf(s), h.ghostBalance(s));
        }
    }

    /// Property: an off-chain reader that only sees DataDrop events reconstructs sponsor, claim count, Σpaid,
    ///           remaining budget and paused flag exactly — it cannot be fooled into miscounting claims.
    function invariant_RT_EventSourcedIndexerAgrees() public view {
        assertEq(h.indexerBreaks(), 0, h.lastBreak());
        for (uint256 i = 0; i < h.idCount(); i++) {
            bytes32 id = h.ids(i);
            IDataDrop.Campaign memory c = tokenDrop.campaigns(id);
            RT_ModelHandler.Ix memory x = h.indexer(id);
            assertTrue(x.exists);
            assertEq(x.sponsor, c.sponsor);
            assertEq(x.paidSum, c.spent);
            assertEq(uint256(x.claims) * c.pricePerClaim, c.spent);
            assertEq(x.budget - x.paidSum - x.refunded, c.budget - c.spent);
            assertEq(x.paused, c.paused);
        }
    }

    /// Sanity: the campaign actually exercised successful paths (not a vacuous pass).
    function invariant_RT_NotVacuous() public view {
        if (h.idCount() > 0) assertGt(h.successes(), 0);
    }
}
