// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";

import {DataDrop} from "../../src/DataDrop.sol";
import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {HtsPrecompileMock} from "../mocks/HtsPrecompileMock.sol";
import {RegressionBase} from "./RegressionBase.sol";

/// @notice T-09 (HTS association, LEDGER_ONLY misuse) and RT-C-01 (unbacked LEDGER_ONLY budgets).
contract T09_HtsAssociationTest is RegressionBase {
    address internal constant HTS = 0x0000000000000000000000000000000000000167;

    /// RT-C-01 (was test_RT_LedgerOnlyStrangerCannotDeclareUnbackedBudget_RTFINDING).
    function test_Regression_RTC01_LedgerOnlyStrangerCannotDeclareUnbackedBudget() public {
        assertEq(token.balanceOf(ROLE_STRANGER), 0);
        (bool ok, bytes4 why) = _try(
            address(ledgerDrop),
            ROLE_STRANGER,
            _create(keccak256("unbacked"), type(uint128).max, FIFTY_CENTS, type(uint32).max)
        );
        assertFalse(ok, "unfunded stranger declared a LEDGER_ONLY budget");
        assertEq(why, IDataDrop.NotSponsor.selector);
    }

    function test_LedgerOnlyAllowListLifecycle() public {
        bytes32 id = keccak256("hts-funded");
        vm.expectEmit(true, true, true, true, address(ledgerDrop));
        emit DataDrop.LedgerSponsorSet(ROLE_SPONSOR, true);
        vm.prank(ROLE_OWNER);
        ledgerDrop.setLedgerSponsor(ROLE_SPONSOR, true);
        assertTrue(ledgerDrop.ledgerSponsor(ROLE_SPONSOR));

        vm.expectEmit(true, true, true, true, address(ledgerDrop));
        emit DataDrop.CampaignFunded(id, ROLE_SPONSOR, FIVE_HUNDRED_USD); // who backed it, on the record
        (bool ok,) = _try(address(ledgerDrop), ROLE_SPONSOR, _create(id, FIVE_HUNDRED_USD, FIFTY_CENTS, PER_HOUR));
        assertTrue(ok);

        vm.prank(ROLE_OWNER);
        ledgerDrop.setLedgerSponsor(ROLE_SPONSOR, false);
        (bool again, bytes4 why) = _try(address(ledgerDrop), ROLE_SPONSOR, _create(keccak256("after-revoke"), 1, 1, 1));
        assertFalse(again);
        assertEq(why, IDataDrop.NotSponsor.selector);
        // revocation does not touch existing campaigns: claims still settle on the ledger
        vm.prank(ROLE_ATTESTOR);
        ledgerDrop.claim(id, _humanKey(id, 1));
        assertEq(ledgerDrop.campaigns(id).spent, FIFTY_CENTS);
    }

    function test_SetLedgerSponsorIsOwnerOnlyAndNonZero() public {
        vm.prank(ROLE_STRANGER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ROLE_STRANGER));
        ledgerDrop.setLedgerSponsor(ROLE_STRANGER, true);
        vm.prank(ROLE_OWNER);
        vm.expectRevert(DataDrop.ZeroAddress.selector);
        ledgerDrop.setLedgerSponsor(address(0), true);
    }

    function test_TokenModeIsPermissionlessAndRecordsFunder() public {
        bytes32 id = keccak256("token-funded");
        token.mint(ROLE_STRANGER, FIFTY_CENTS);
        vm.prank(ROLE_STRANGER);
        token.approve(address(tokenDrop), FIFTY_CENTS);
        vm.recordLogs();
        (bool ok,) = _try(address(tokenDrop), ROLE_STRANGER, _create(id, FIFTY_CENTS, FIFTY_CENTS, 1));
        assertTrue(ok);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool funded;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == DataDrop.CampaignFunded.selector) {
                funded = logs[i].topics[1] == id && address(uint160(uint256(logs[i].topics[2]))) == ROLE_STRANGER;
            }
        }
        assertTrue(funded, "CampaignFunded(id, funder) missing");
        assertFalse(tokenDrop.ledgerSponsor(ROLE_STRANGER)); // allow-list irrelevant in token mode
        assertEq(token.balanceOf(address(tokenDrop)), FIFTY_CENTS);
    }

    function test_AssociateHtsRecordsSelfAndUsdcOnHedera() public {
        vm.chainId(296);
        vm.etch(HTS, type(HtsPrecompileMock).runtimeCode);
        vm.prank(ROLE_OWNER);
        tokenDrop.associateHts(address(token));
        (address account, address tok) = HtsPrecompileMock(HTS).last();
        assertEq(account, address(tokenDrop));
        assertEq(tok, address(token));
    }
}
