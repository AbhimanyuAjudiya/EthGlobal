// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";
import {RegressionBase} from "./RegressionBase.sol";

/// @notice T-03: a claimKey is paid at most once per campaign — across attestor rotation, pause/unpause and hour
///         buckets — while the same pseudonym on another campaign is independent (by design).
contract T03_ClaimKeyReplayTest is RegressionBase {
    bytes32 internal constant A = keccak256("replay-a");
    bytes32 internal constant B = keccak256("replay-b");

    function setUp() public override {
        super.setUp();
        _fund(tokenDrop, ROLE_SPONSOR, A, FIVE_HUNDRED_USD, FIFTY_CENTS, PER_HOUR);
        _fund(tokenDrop, ROLE_SPONSOR, B, FIVE_HUNDRED_USD, FIFTY_CENTS, PER_HOUR);
    }

    function test_ReplayRejectedAcrossRotationPauseAndBuckets() public {
        bytes32 k = _humanKey(A, 42);
        vm.prank(ROLE_ATTESTOR);
        tokenDrop.claim(A, k);

        address next = makeAddr("next-attestor");
        vm.prank(ROLE_OWNER);
        tokenDrop.setAttestor(next);
        vm.prank(ROLE_SPONSOR);
        tokenDrop.pause(A, true);
        vm.prank(ROLE_SPONSOR);
        tokenDrop.pause(A, false);
        vm.warp(block.timestamp + 3 hours);

        (bool ok, bytes4 why) = _try(address(tokenDrop), next, abi.encodeCall(IDataDrop.claim, (A, k)));
        assertFalse(ok);
        assertEq(why, IDataDrop.AlreadyClaimed.selector);
        assertEq(tokenDrop.campaigns(A).spent, FIFTY_CENTS);

        (ok,) = _try(address(tokenDrop), next, abi.encodeCall(IDataDrop.claim, (B, k))); // other campaign: allowed
        assertTrue(ok);
        assertTrue(tokenDrop.claimed(A, k) && tokenDrop.claimed(B, k));
    }

    function testFuzz_SecondClaimOfAnyKeyReverts(bytes32 k) public {
        vm.startPrank(ROLE_ATTESTOR);
        tokenDrop.claim(A, k);
        vm.expectRevert(IDataDrop.AlreadyClaimed.selector);
        tokenDrop.claim(A, k);
        vm.stopPrank();
    }
}
