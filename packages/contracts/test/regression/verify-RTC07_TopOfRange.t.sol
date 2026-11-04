// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";
import {RegressionBase} from "./RegressionBase.sol";

/// @notice Red-team verification variant for RT-C-07 (same overflow class, other counters): the hourly counter at
///         uint32 max reports HourlyCap, and a refund at spent == budget == 2^128−1 reports NotRefundable — never Panic.
contract Verify_RTC07Test is RegressionBase {
    bytes32 internal constant BIG = keccak256("verify-rtc07");

    function setUp() public override {
        super.setUp();
        vm.prank(ROLE_OWNER);
        ledgerDrop.setLedgerSponsor(ROLE_SPONSOR, true);
        vm.prank(ROLE_SPONSOR);
        ledgerDrop.createCampaign(BIG, type(uint128).max, 1, type(uint32).max, deadline);
    }

    function test_Verify_RTC07_HourlyCounterAtUint32MaxReportsHourlyCap() public {
        uint64 bucket = ledgerDrop.currentHourBucket();
        bytes32 slot = keccak256(abi.encode(uint256(bucket), keccak256(abi.encode(BIG, uint256(5)))));
        vm.store(address(ledgerDrop), slot, bytes32(uint256(type(uint32).max - 1)));
        assertEq(ledgerDrop.claimsInHour(BIG, bucket), type(uint32).max - 1);
        vm.startPrank(ROLE_ATTESTOR);
        ledgerDrop.claim(BIG, _humanKey(BIG, 1));
        assertEq(ledgerDrop.claimsInHour(BIG, bucket), type(uint32).max);
        vm.expectRevert(IDataDrop.HourlyCap.selector);
        ledgerDrop.claim(BIG, _humanKey(BIG, 2));
        vm.stopPrank();
    }

    function test_Verify_RTC07_RefundAtFullSpendOfMaxBudgetIsNotRefundable() public {
        bytes32 base = keccak256(abi.encode(BIG, uint256(3)));
        uint128 m = type(uint128).max;
        vm.store(address(ledgerDrop), bytes32(uint256(base) + 1), bytes32((uint256(m) << 128) | uint256(m)));
        vm.warp(deadline);
        vm.prank(ROLE_SPONSOR);
        vm.expectRevert(IDataDrop.NotRefundable.selector);
        ledgerDrop.refund(BIG);
    }
}
