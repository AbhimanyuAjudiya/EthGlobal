// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {DataDrop} from "../../src/DataDrop.sol";
import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";
import {RT_BlacklistToken} from "../redteam/mocks/RT_Tokens.sol";
import {RegressionBase} from "./RegressionBase.sol";

/// @notice T-10 / RT-C-03: a sponsor whose address the issuer blacklisted can still recover the unspent budget by
///         choosing another recipient with `refund(id, to)`. The recipient is the sponsor's choice — never an owner power.
contract T10_RefundRecipientTest is RegressionBase {
    RT_BlacklistToken internal bl;
    DataDrop internal blDrop;
    bytes32 internal constant CID = keccak256("blacklist-campaign");
    address internal constant ALT = address(0xA17);

    function setUp() public override {
        super.setUp();
        bl = new RT_BlacklistToken();
        blDrop = new DataDrop(IERC20(address(bl)), ROLE_PAYOUT, ROLE_ATTESTOR, ROLE_OWNER);
        bl.mint(ROLE_SPONSOR, FIVE_HUNDRED_USD);
        vm.startPrank(ROLE_SPONSOR);
        bl.approve(address(blDrop), FIVE_HUNDRED_USD);
        blDrop.createCampaign(CID, FIVE_HUNDRED_USD, FIFTY_CENTS, PER_HOUR, deadline);
        vm.stopPrank();
    }

    /// RT-C-03 (was test_RT_BlacklistedSponsorCanStillRecoverFunds_RTFINDING).
    function test_Regression_RTC03_BlacklistedSponsorRefundsToAlternateAddress() public {
        vm.prank(ROLE_ATTESTOR);
        blDrop.claim(CID, _humanKey(CID, 1));
        bl.setBlacklisted(ROLE_SPONSOR, true);
        vm.warp(deadline);
        vm.prank(ROLE_SPONSOR);
        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        blDrop.refund(CID); // the old path still fails for this sponsor …
        vm.expectEmit(true, true, true, true, address(blDrop));
        emit IDataDrop.Refunded(CID, FIVE_HUNDRED_USD - FIFTY_CENTS);
        vm.prank(ROLE_SPONSOR);
        blDrop.refund(CID, ALT); // … the new one recovers everything unspent
        assertEq(bl.balanceOf(ALT), FIVE_HUNDRED_USD - FIFTY_CENTS);
        assertEq(bl.balanceOf(address(blDrop)), 0);
        vm.prank(ROLE_SPONSOR);
        vm.expectRevert(IDataDrop.NotRefundable.selector);
        blDrop.refund(CID, ALT);
    }

    function test_RefundToKeepsEveryRefundRule() public {
        vm.prank(ROLE_SPONSOR);
        vm.expectRevert(IDataDrop.NotRefundable.selector); // not expired, not paused 24 h
        blDrop.refund(CID, ALT);
        vm.warp(deadline);
        vm.prank(ROLE_SPONSOR);
        vm.expectRevert(DataDrop.ZeroAddress.selector);
        blDrop.refund(CID, address(0));
        address[3] memory others = [ROLE_OWNER, ROLE_ATTESTOR, ROLE_STRANGER];
        for (uint256 i = 0; i < others.length; i++) {
            vm.prank(others[i]);
            vm.expectRevert(IDataDrop.NotSponsor.selector);
            blDrop.refund(CID, others[i]);
        }
        assertEq(bl.balanceOf(address(blDrop)), FIVE_HUNDRED_USD);
    }

    function test_RefundToInLedgerOnlyMovesNothing() public {
        vm.prank(ROLE_OWNER);
        ledgerDrop.setLedgerSponsor(ROLE_SPONSOR, true);
        vm.prank(ROLE_SPONSOR);
        ledgerDrop.createCampaign(CID, FIVE_HUNDRED_USD, FIFTY_CENTS, PER_HOUR, deadline);
        vm.warp(deadline);
        vm.prank(ROLE_SPONSOR);
        ledgerDrop.refund(CID, ALT);
        IDataDrop.Campaign memory c = ledgerDrop.campaigns(CID);
        assertEq(c.budget, c.spent);
        assertEq(token.balanceOf(ALT), 0);
    }
}
