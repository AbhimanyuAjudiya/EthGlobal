// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DataDrop} from "../../src/DataDrop.sol";
import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";
import {RegressionBase} from "./RegressionBase.sol";

/// @notice Red-team verification variant for RT-C-02: crafted salts cannot make two sponsors' scoped ids collide, dirty
///         high bits in the salt calldata are rejected (not silently truncated into someone else's id), and a squatter's
///         look-alike id (victim prefix, non-zero marker) is a different id that never blocks the victim's scoped one.
contract Verify_RTC02Test is RegressionBase {
    function testFuzz_Verify_RTC02_NoCrossSponsorCollision(address a, address b, uint64 sa, uint64 sb) public view {
        vm.assume(a != b);
        assertTrue(tokenDrop.scopedCampaignId(a, sa) != tokenDrop.scopedCampaignId(b, sb));
    }

    function test_Verify_RTC02_DirtySaltCalldataReverts() public {
        // salt word with bits above 64 set: a truncating decoder would map it onto ROLE_SPONSOR's salt 2
        bytes memory data = abi.encodePacked(
            DataDrop.scopedCampaignId.selector, abi.encode(ROLE_SPONSOR), bytes32((uint256(1) << 200) | uint256(2))
        );
        (bool ok,) = address(tokenDrop).staticcall(data);
        assertFalse(ok, "dirty uint64 salt accepted");
    }

    function testFuzz_Verify_RTC02_LookAlikeIdNeverBlocksScopedId(uint32 marker, uint64 salt) public {
        vm.assume(marker != 0);
        bytes32 victim = tokenDrop.scopedCampaignId(ROLE_SPONSOR, salt);
        bytes32 lookAlike = bytes32(uint256(victim) | (uint256(marker) << 64)); // same prefix + salt, marker set
        _fund(tokenDrop, ROLE_STRANGER, lookAlike, 1, 1, type(uint32).max); // unscoped: allowed, first come
        _fund(tokenDrop, ROLE_SPONSOR, victim, FIFTY_CENTS, FIFTY_CENTS, 1);
        assertEq(tokenDrop.campaigns(victim).sponsor, ROLE_SPONSOR);
        assertEq(tokenDrop.campaigns(victim).pricePerClaim, FIFTY_CENTS);
    }

    /// ids whose top 24 bytes are zero are "scoped to address(0)": nobody can create them (no squat of small ids)
    function testFuzz_Verify_RTC02_ZeroSponsorScopeUnclaimable(uint64 salt) public {
        bytes32 id = bytes32(uint256(salt));
        token.mint(ROLE_STRANGER, 1);
        vm.prank(ROLE_STRANGER);
        token.approve(address(tokenDrop), 1);
        (bool ok, bytes4 why) = _try(address(tokenDrop), ROLE_STRANGER, _create(id, 1, 1, 1));
        assertFalse(ok);
        assertEq(why, IDataDrop.NotSponsor.selector);
    }
}
