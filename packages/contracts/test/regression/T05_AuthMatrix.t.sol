// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {DataDrop} from "../../src/DataDrop.sol";
import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";
import {RegressionBase} from "./RegressionBase.sol";

/// @notice T-05: the authorisation matrix, including the functions added by the wave-1 fixes
///         (`refund(id, to)`, `setLedgerSponsor`, the disabled `renounceOwnership`).
contract T05_AuthMatrixTest is RegressionBase {
    bytes32 internal constant CID = keccak256("auth-matrix");

    function setUp() public override {
        super.setUp();
        _fund(tokenDrop, ROLE_SPONSOR, CID, FIVE_HUNDRED_USD, FIFTY_CENTS, PER_HOUR);
        vm.warp(deadline); // refunds otherwise eligible
    }

    function _expectDenied(address who, bytes memory call, bytes memory err) internal {
        vm.prank(who);
        (bool ok, bytes memory ret) = address(tokenDrop).call(call);
        assertFalse(ok);
        assertEq(ret, err);
    }

    function test_MatrixForEveryNonSponsorRole() public {
        address[3] memory who = [ROLE_OWNER, ROLE_ATTESTOR, ROLE_STRANGER];
        bytes memory notSponsor = abi.encodeWithSelector(IDataDrop.NotSponsor.selector);
        for (uint256 i = 0; i < who.length; i++) {
            _expectDenied(who[i], abi.encodeCall(IDataDrop.refund, (CID)), notSponsor);
            _expectDenied(who[i], abi.encodeWithSignature("refund(bytes32,address)", CID, who[i]), notSponsor);
            _expectDenied(who[i], abi.encodeCall(IDataDrop.pause, (CID, false)), notSponsor);
            _expectDenied(
                who[i],
                abi.encodeCall(DataDrop.renounceOwnership, ()),
                abi.encodeWithSelector(DataDrop.RenounceDisabled.selector)
            );
        }
        address[3] memory notOwner = [ROLE_SPONSOR, ROLE_ATTESTOR, ROLE_STRANGER];
        for (uint256 i = 0; i < notOwner.length; i++) {
            bytes memory unauthorized = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, notOwner[i]);
            _expectDenied(notOwner[i], abi.encodeCall(DataDrop.setLedgerSponsor, (notOwner[i], true)), unauthorized);
            _expectDenied(notOwner[i], abi.encodeCall(IDataDrop.setAttestor, (notOwner[i])), unauthorized);
        }
        assertEq(token.balanceOf(address(tokenDrop)), FIVE_HUNDRED_USD);
    }

    function test_SponsorCanUseBothRefundForms() public {
        bytes32 second = keccak256("auth-matrix-2");
        deadline = uint64(block.timestamp + 1 days);
        _fund(tokenDrop, ROLE_SPONSOR, second, FIFTY_CENTS, FIFTY_CENTS, 1);
        vm.warp(deadline);
        vm.startPrank(ROLE_SPONSOR);
        tokenDrop.refund(CID);
        tokenDrop.refund(second, ROLE_STRANGER);
        vm.stopPrank();
        assertEq(token.balanceOf(ROLE_SPONSOR), FIVE_HUNDRED_USD);
        assertEq(token.balanceOf(ROLE_STRANGER), FIFTY_CENTS);
    }
}
