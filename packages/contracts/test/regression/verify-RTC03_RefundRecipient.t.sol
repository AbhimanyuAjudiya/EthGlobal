// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {DataDrop} from "../../src/DataDrop.sol";
import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";
import {RT_BlacklistToken} from "../redteam/mocks/RT_Tokens.sol";
import {RegressionBase} from "./RegressionBase.sol";

/// @notice Red-team verification variant for RT-C-03: mixing the two refund overloads never pays twice, a blacklisted
///         alternate recipient leaves the budget intact for a retry, and a 24 h-paused (not expired) campaign is refundable
///         to an alternate address exactly once.
contract Verify_RTC03Test is RegressionBase {
    RT_BlacklistToken internal bl;
    DataDrop internal blDrop;
    bytes32 internal constant CID = keccak256("verify-rtc03");

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

    function test_Verify_RTC03_BlacklistedAltRecipientRevertsAndBudgetSurvives() public {
        address badAlt = makeAddr("blacklisted-alt");
        address goodAlt = makeAddr("good-alt");
        bl.setBlacklisted(badAlt, true);
        vm.warp(deadline);
        vm.prank(ROLE_SPONSOR);
        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        blDrop.refund(CID, badAlt);
        assertEq(blDrop.campaigns(CID).budget, FIVE_HUNDRED_USD, "a reverted refund must not zero the budget");
        vm.prank(ROLE_SPONSOR);
        blDrop.refund(CID, goodAlt);
        assertEq(bl.balanceOf(goodAlt), FIVE_HUNDRED_USD);
    }

    function test_Verify_RTC03_OverloadsNeverPayTwice() public {
        vm.prank(ROLE_SPONSOR);
        blDrop.pause(CID, true);
        vm.warp(block.timestamp + 24 hours); // long-paused, not expired
        address alt = makeAddr("alt");
        vm.prank(ROLE_SPONSOR);
        blDrop.refund(CID, alt);
        vm.prank(ROLE_SPONSOR);
        vm.expectRevert(IDataDrop.NotRefundable.selector);
        blDrop.refund(CID);
        vm.prank(ROLE_SPONSOR);
        vm.expectRevert(IDataDrop.NotRefundable.selector);
        blDrop.refund(CID, ROLE_SPONSOR);
        assertEq(bl.balanceOf(alt), FIVE_HUNDRED_USD);
        assertEq(bl.balanceOf(ROLE_SPONSOR), 0);
        assertEq(bl.balanceOf(address(blDrop)), 0);
    }

    function testFuzz_Verify_RTC03_OnlySponsorChoosesRecipient(address caller, address to) public {
        vm.assume(caller != ROLE_SPONSOR && to != address(0));
        vm.warp(deadline);
        (bool ok, bytes4 why) =
            _try(address(blDrop), caller, abi.encodeWithSignature("refund(bytes32,address)", CID, to));
        assertFalse(ok);
        assertEq(why, IDataDrop.NotSponsor.selector);
    }
}
