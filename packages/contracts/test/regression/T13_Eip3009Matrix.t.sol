// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {EIP3009Token} from "../../src/EIP3009Token.sol";
import {MockUSDC3009} from "../../src/MockUSDC3009.sol";

/// @notice T-13: one nonce, one use — across transferWithAuthorization, receiveWithAuthorization and
///         cancelAuthorization, in every order — plus the strict validity window and payee-only receive.
contract T13_Eip3009MatrixTest is Test {
    MockUSDC3009 internal usd;
    uint256 internal signerKey;
    address internal signer;
    address internal constant PAYEE = address(0xBEEF);
    uint256 internal constant AMOUNT = 250_000; // $0.25

    function setUp() public {
        vm.warp(1_800_000_000);
        usd = new MockUSDC3009();
        signerKey = vm.deriveKey("test test test test test test test test test test test junk", 5);
        signer = vm.addr(signerKey);
        usd.mint(signer, 10e6);
    }

    function _packed(bytes32 typehash, bytes32 nonce, uint256 lo, uint256 hi) internal view returns (bytes memory) {
        bytes32 h = keccak256(abi.encode(typehash, signer, PAYEE, AMOUNT, lo, hi, nonce));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(signerKey, keccak256(abi.encodePacked("\x19\x01", usd.DOMAIN_SEPARATOR(), h)));
        return abi.encodePacked(r, s, v);
    }

    /// op 0 = transfer, 1 = receive (as payee), 2 = cancel. Returns whether it succeeded.
    function _op(uint8 op, bytes32 nonce) internal returns (bool ok) {
        uint256 lo = block.timestamp - 1;
        uint256 hi = block.timestamp + 60;
        if (op == 0) {
            bytes memory sig = _packed(usd.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), nonce, lo, hi);
            try usd.transferWithAuthorization(signer, PAYEE, AMOUNT, lo, hi, nonce, sig) {
                return true;
            } catch {}
        } else if (op == 1) {
            bytes memory sig = _packed(usd.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), nonce, lo, hi);
            vm.prank(PAYEE);
            try usd.receiveWithAuthorization(signer, PAYEE, AMOUNT, lo, hi, nonce, sig) {
                return true;
            } catch {}
        } else {
            bytes32 h = keccak256(abi.encode(usd.CANCEL_AUTHORIZATION_TYPEHASH(), signer, nonce));
            (uint8 v, bytes32 r, bytes32 s) =
                vm.sign(signerKey, keccak256(abi.encodePacked("\x19\x01", usd.DOMAIN_SEPARATOR(), h)));
            try usd.cancelAuthorization(signer, nonce, v, r, s) {
                return true;
            } catch {}
        }
    }

    /// Every ordered pair of operations on one nonce: the first succeeds, the second always fails.
    function test_NonceIsSingleUseAcrossAllNineOrderings() public {
        for (uint8 a = 0; a < 3; a++) {
            for (uint8 b = 0; b < 3; b++) {
                bytes32 nonce = keccak256(abi.encode("matrix", a, b));
                assertTrue(_op(a, nonce), "first use");
                assertFalse(_op(b, nonce), "second use");
                assertTrue(usd.authorizationState(signer, nonce));
            }
        }
        // transfers/receives that ran: a∈{0,1} three times each ⇒ 6 payments
        assertEq(usd.balanceOf(PAYEE), 6 * AMOUNT);
    }

    function test_WindowIsStrictAndReceiveIsPayeeOnly() public {
        bytes32 nonce = keccak256("window");
        uint256 t = block.timestamp;
        bytes memory atStart = _packed(usd.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), nonce, t, t + 60);
        vm.expectRevert(EIP3009Token.AuthorizationNotYetValid.selector);
        usd.transferWithAuthorization(signer, PAYEE, AMOUNT, t, t + 60, nonce, atStart);
        bytes memory atEnd = _packed(usd.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), nonce, t - 60, t);
        vm.expectRevert(EIP3009Token.AuthorizationExpired.selector);
        usd.transferWithAuthorization(signer, PAYEE, AMOUNT, t - 60, t, nonce, atEnd);
        bytes memory rcv = _packed(usd.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), nonce, t - 1, t + 60);
        vm.expectRevert(EIP3009Token.CallerMustBePayee.selector);
        usd.receiveWithAuthorization(signer, PAYEE, AMOUNT, t - 1, t + 60, nonce, rcv);
        assertFalse(usd.authorizationState(signer, nonce));
    }
}
