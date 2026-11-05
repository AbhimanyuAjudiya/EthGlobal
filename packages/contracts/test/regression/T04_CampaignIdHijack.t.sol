// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DataDrop} from "../../src/DataDrop.sol";
import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";
import {RegressionBase} from "./RegressionBase.sol";

/// @notice T-04 (campaign id hijack) and RT-C-02 (id squatting). Sponsor-scoped ids cannot be taken by anyone else;
///         unscoped ids stay first-come and never overwritable — the API pins `(id, sponsor)` and uses scoped ids.
contract T04_CampaignIdHijackTest is RegressionBase {
    /// RT-C-02 (was test_RT_IdSquatBlocksIntendedSponsor_RTFINDING): the squat now reverts and the sponsor gets its id.
    function test_Regression_RTC02_SquatterCannotPreemptScopedId() public {
        bytes32 intended = tokenDrop.scopedCampaignId(ROLE_SPONSOR, 2);
        token.mint(ROLE_STRANGER, 1);
        vm.prank(ROLE_STRANGER);
        token.approve(address(tokenDrop), 1);
        (bool squatted, bytes4 why) = _try(address(tokenDrop), ROLE_STRANGER, _create(intended, 1, 1, type(uint32).max));
        assertFalse(squatted, "squat of a sponsor-scoped id must revert");
        assertEq(why, IDataDrop.NotSponsor.selector);

        _fund(tokenDrop, ROLE_SPONSOR, intended, FIVE_HUNDRED_USD, FIFTY_CENTS, PER_HOUR);
        IDataDrop.Campaign memory c = tokenDrop.campaigns(intended);
        assertEq(c.sponsor, ROLE_SPONSOR);
        assertEq(c.pricePerClaim, FIFTY_CENTS); // the sponsor's terms, not a squatter's
    }

    function test_ScopedIdLayout() public view {
        bytes32 id = tokenDrop.scopedCampaignId(ROLE_SPONSOR, 0xabcdef);
        assertEq(address(bytes20(id)), ROLE_SPONSOR);
        assertEq(uint32(uint256(id) >> 64), 0); // the scope marker
        assertEq(uint64(uint256(id)), 0xabcdef);
    }

    /// Unscoped (e.g. keccak) ids: first creator wins, a second creator gets CampaignExists, nothing is overwritten.
    function test_UnscopedIdFirstComeNeverOverwritten() public {
        bytes32 legacy = keccak256("legacy-unscoped");
        _fund(tokenDrop, ROLE_STRANGER, legacy, 1, 1, 1);
        token.mint(ROLE_SPONSOR, FIVE_HUNDRED_USD);
        vm.prank(ROLE_SPONSOR);
        token.approve(address(tokenDrop), FIVE_HUNDRED_USD);
        (bool ok, bytes4 why) =
            _try(address(tokenDrop), ROLE_SPONSOR, _create(legacy, FIVE_HUNDRED_USD, FIFTY_CENTS, 5));
        assertFalse(ok);
        assertEq(why, IDataDrop.CampaignExists.selector);
        assertEq(tokenDrop.campaigns(legacy).sponsor, ROLE_STRANGER); // ⇒ the API must check `sponsor` (pinning)
    }

    function testFuzz_ScopedIdOnlyByItsSponsor(address owner_, address other, uint64 salt) public {
        vm.assume(owner_ != address(0) && other != owner_ && other != address(0));
        vm.assume(owner_.code.length == 0 && other.code.length == 0);
        bytes32 id = tokenDrop.scopedCampaignId(owner_, salt);
        token.mint(other, FIFTY_CENTS);
        vm.prank(other);
        token.approve(address(tokenDrop), FIFTY_CENTS);
        (bool ok, bytes4 why) = _try(address(tokenDrop), other, _create(id, FIFTY_CENTS, FIFTY_CENTS, 1));
        assertFalse(ok);
        assertEq(why, IDataDrop.NotSponsor.selector);
        _fund(tokenDrop, owner_, id, FIFTY_CENTS, FIFTY_CENTS, 1);
        assertEq(tokenDrop.campaigns(id).sponsor, owner_);
    }

    function test_ScopedIdsWorkInLedgerOnlyToo() public {
        bytes32 id = ledgerDrop.scopedCampaignId(ROLE_SPONSOR, 9);
        vm.startPrank(ROLE_OWNER);
        ledgerDrop.setLedgerSponsor(ROLE_SPONSOR, true);
        ledgerDrop.setLedgerSponsor(ROLE_STRANGER, true);
        vm.stopPrank();
        (bool ok, bytes4 why) = _try(address(ledgerDrop), ROLE_STRANGER, _create(id, FIFTY_CENTS, FIFTY_CENTS, 1));
        assertFalse(ok);
        assertEq(why, IDataDrop.NotSponsor.selector);
        (ok,) = _try(address(ledgerDrop), ROLE_SPONSOR, _create(id, FIFTY_CENTS, FIFTY_CENTS, 1));
        assertTrue(ok);
        assertTrue(DataDrop(ledgerDrop).ledgerOnly());
    }
}
