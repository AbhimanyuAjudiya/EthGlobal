// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {RegressionBase} from "./RegressionBase.sol";

/// @notice Red-team verification variant for RT-C-06: the 2-step path cannot be used as a renounce. Nominating
///         address(0) or a black hole leaves the current owner in control and attestor rotation alive.
contract Verify_RTC06Test is RegressionBase {
    function test_Verify_RTC06_NominatingZeroOrBlackHoleIsNoRenounce() public {
        vm.startPrank(ROLE_OWNER);
        tokenDrop.transferOwnership(address(0));
        assertEq(tokenDrop.owner(), ROLE_OWNER);
        tokenDrop.transferOwnership(address(0xdEaD));
        assertEq(tokenDrop.owner(), ROLE_OWNER);
        tokenDrop.setAttestor(makeAddr("rotated")); // still possible while the nominee never accepts
        vm.stopPrank();
        vm.prank(ROLE_STRANGER);
        vm.expectRevert();
        tokenDrop.acceptOwnership(); // only the nominee may accept
        assertEq(tokenDrop.owner(), ROLE_OWNER);
    }

    function test_Verify_RTC06_RenounceSelectorRevertsViaRawCall() public {
        vm.prank(ROLE_OWNER);
        (bool ok,) = address(tokenDrop).call(abi.encodeWithSignature("renounceOwnership()"));
        assertFalse(ok);
        assertEq(tokenDrop.owner(), ROLE_OWNER);
    }
}
