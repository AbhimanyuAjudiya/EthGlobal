// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DataDrop} from "../../src/DataDrop.sol";
import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";
import {RegressionBase} from "./RegressionBase.sol";

/// @notice T-01 (compromised attestor): the drain is bounded by the hourly cap, and the owner can always rotate the
///         attestor — `renounceOwnership` is disabled so that recovery can never be thrown away (RT-C-06).
contract T01_AttestorDrainBoundTest is RegressionBase {
    bytes32 internal constant CID = keccak256("drain-bound");

    function setUp() public override {
        super.setUp();
        _fund(tokenDrop, ROLE_SPONSOR, CID, FIVE_HUNDRED_USD, FIFTY_CENTS, PER_HOUR);
    }

    /// RT-C-06 (was test_RT_RenounceOwnershipDisabled_RTFINDING).
    function test_Regression_RTC06_RenounceOwnershipRevertsAndRotationStillWorks() public {
        vm.prank(ROLE_OWNER);
        vm.expectRevert(DataDrop.RenounceDisabled.selector);
        tokenDrop.renounceOwnership();
        vm.prank(ROLE_STRANGER);
        vm.expectRevert(DataDrop.RenounceDisabled.selector);
        tokenDrop.renounceOwnership();
        assertEq(tokenDrop.owner(), ROLE_OWNER);

        address fresh = makeAddr("rotated-attestor");
        vm.prank(ROLE_OWNER);
        tokenDrop.setAttestor(fresh); // the T-01 recovery is still available
        vm.prank(ROLE_ATTESTOR);
        vm.expectRevert(IDataDrop.NotAttestor.selector);
        tokenDrop.claim(CID, _humanKey(CID, 1));
        vm.prank(fresh);
        tokenDrop.claim(CID, _humanKey(CID, 1));
    }

    /// The stolen-key bound as a number: one hour of looping claim() pays exactly cap × price ($2.50 here).
    function test_StolenKeyDrainsAtMostCapTimesPricePerHour() public {
        uint256 paid;
        vm.startPrank(ROLE_ATTESTOR);
        for (uint256 i = 0; i < 50; i++) {
            try tokenDrop.claim(CID, _humanKey(CID, i)) {
                paid += FIFTY_CENTS;
            } catch (bytes memory r) {
                assertEq(bytes4(r), IDataDrop.HourlyCap.selector);
            }
        }
        vm.stopPrank();
        assertEq(paid, uint256(PER_HOUR) * FIFTY_CENTS);
        assertEq(token.balanceOf(ROLE_PAYOUT), 2_500_000);
    }
}
