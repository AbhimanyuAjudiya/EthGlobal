// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";
import {RegressionBase} from "./RegressionBase.sol";

/// @notice Red-team verification variant for RT-C-01 (not covered by T09): a nominated-but-not-accepted owner (2-step) cannot
///         allow-list itself, and a stranger cannot reach the LEDGER_ONLY create path through a scoped id of its own.
contract Verify_RTC01Test is RegressionBase {
    function test_Verify_RTC01_PendingOwnerCannotAllowListItself() public {
        vm.prank(ROLE_OWNER);
        ledgerDrop.transferOwnership(ROLE_STRANGER); // nominated, not accepted
        assertEq(ledgerDrop.pendingOwner(), ROLE_STRANGER);
        vm.prank(ROLE_STRANGER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ROLE_STRANGER));
        ledgerDrop.setLedgerSponsor(ROLE_STRANGER, true);
        (bool ok, bytes4 why) = _try(
            address(ledgerDrop), ROLE_STRANGER, _create(keccak256("pending-owner"), type(uint128).max, FIFTY_CENTS, 1)
        );
        assertFalse(ok);
        assertEq(why, IDataDrop.NotSponsor.selector);
    }

    function test_Verify_RTC01_StrangerOwnScopedIdStillNeedsAllowList() public {
        bytes32 own = ledgerDrop.scopedCampaignId(ROLE_STRANGER, 1); // passes the scope check, must still fail the list
        (bool ok, bytes4 why) = _try(address(ledgerDrop), ROLE_STRANGER, _create(own, type(uint128).max, 1, 1));
        assertFalse(ok);
        assertEq(why, IDataDrop.NotSponsor.selector);
        assertEq(ledgerDrop.campaigns(own).sponsor, address(0));
    }

    /// allow-listing on a token-mode drop gives nothing: the create still has to move real tokens
    function test_Verify_RTC01_AllowListIsNoBypassInTokenMode() public {
        vm.prank(ROLE_OWNER);
        tokenDrop.setLedgerSponsor(ROLE_STRANGER, true);
        (bool ok,) = _try(address(tokenDrop), ROLE_STRANGER, _create(keccak256("unfunded"), FIVE_HUNDRED_USD, 1, 1));
        assertFalse(ok, "token-mode create without tokens succeeded");
    }
}
