// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {EIP3009Token} from "../src/EIP3009Token.sol";
import {MockUSDC3009} from "../src/MockUSDC3009.sol";
import {IEIP3009} from "../src/interfaces/IEIP3009.sol";
import {MockUSDC3009Named} from "./mocks/MockUSDC3009Named.sol";

/// @notice MockUSDC3009 acceptance tests (brief §6, T-13/T-14/T-17) and the A13–A15 matrix of wave1-contracts.md.
/// @dev Payer = Anvil #5 (the vectors signer), other signer = #6, relayer/stranger = #7. Amounts are 6-decimal.
contract MockUSDC3009Test is Test {
    string internal constant MNEMONIC = "test test test test test test test test test test test junk";
    bytes32 internal constant SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;

    MockUSDC3009 internal usdc;
    uint256 internal payerKey;
    address internal payer;
    uint256 internal otherKey;
    address internal relayer;
    address internal payee = makeAddr("payee");

    uint256 internal constant VALUE = 1_500_000; // $1.50

    struct Auth {
        address from;
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
    }

    function setUp() public {
        vm.warp(1_762_200_000);
        usdc = new MockUSDC3009();
        payerKey = vm.deriveKey(MNEMONIC, 5);
        payer = vm.addr(payerKey);
        otherKey = vm.deriveKey(MNEMONIC, 6);
        relayer = vm.addr(vm.deriveKey(MNEMONIC, 7));
        usdc.mint(payer, 100e6);
    }

    // ───────────────────────────── helpers ─────────────────────────────

    function _auth(bytes32 nonce) internal view returns (Auth memory) {
        return Auth(payer, payee, VALUE, block.timestamp - 1, block.timestamp + 300, nonce);
    }

    function _digest(EIP3009Token t, bytes32 typehash, Auth memory a) internal view returns (bytes32) {
        bytes32 structHash =
            keccak256(abi.encode(typehash, a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce));
        return keccak256(abi.encodePacked("\x19\x01", t.DOMAIN_SEPARATOR(), structHash));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (uint8 v, bytes32 r, bytes32 s) {
        return vm.sign(pk, digest);
    }

    function _signTransfer(uint256 pk, Auth memory a) internal view returns (uint8, bytes32, bytes32) {
        return _sign(pk, _digest(usdc, usdc.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), a));
    }

    function _signReceive(uint256 pk, Auth memory a) internal view returns (uint8, bytes32, bytes32) {
        return _sign(pk, _digest(usdc, usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), a));
    }

    function _transfer(Auth memory a, uint8 v, bytes32 r, bytes32 s) internal {
        usdc.transferWithAuthorization(a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, v, r, s);
    }

    function _transferBytes(Auth memory a, bytes memory sig) internal {
        usdc.transferWithAuthorization(a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, sig);
    }

    function _receive(Auth memory a, uint8 v, bytes32 r, bytes32 s) internal {
        usdc.receiveWithAuthorization(a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, v, r, s);
    }

    function _receiveBytes(Auth memory a, bytes memory sig) internal {
        usdc.receiveWithAuthorization(a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, sig);
    }

    function _cancelDigest(EIP3009Token t, address authorizer, bytes32 nonce) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(t.CANCEL_AUTHORIZATION_TYPEHASH(), authorizer, nonce));
        return keccak256(abi.encodePacked("\x19\x01", t.DOMAIN_SEPARATOR(), structHash));
    }

    // ───────────────────────────── metadata ─────────────────────────────

    function test_Decimals6() public view {
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.name(), "USD Coin");
        assertEq(usdc.symbol(), "USDC");
        assertEq(usdc.version(), "2");
        assertEq(usdc.balanceOf(payer), 100_000_000); // 100 USDC
    }

    function test_TypehashesMatchCircle() public view {
        assertEq(
            usdc.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(),
            keccak256(
                "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
            )
        );
        assertEq(
            usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
            keccak256(
                "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
            )
        );
        assertEq(
            usdc.CANCEL_AUTHORIZATION_TYPEHASH(), keccak256("CancelAuthorization(address authorizer,bytes32 nonce)")
        );
    }

    function test_DomainSeparatorLayout() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("USD Coin"),
                keccak256("2"),
                block.chainid,
                address(usdc)
            )
        );
        assertEq(usdc.DOMAIN_SEPARATOR(), expected);
        (, string memory name, string memory ver, uint256 chainId, address vc,,) = usdc.eip712Domain();
        assertEq(name, "USD Coin");
        assertEq(ver, "2");
        assertEq(chainId, 31_337);
        assertEq(vc, address(usdc));
    }

    function test_ConfigurableDomainBaseSepoliaName() public {
        MockUSDC3009Named bs = new MockUSDC3009Named("USDC", "2");
        assertEq(bs.name(), "USDC");
        (, string memory name, string memory ver,,,,) = bs.eip712Domain();
        assertEq(name, "USDC");
        assertEq(ver, "2");
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("USDC"),
                keccak256("2"),
                block.chainid,
                address(bs)
            )
        );
        assertEq(bs.DOMAIN_SEPARATOR(), expected);

        // a signature made for the "USD Coin" domain does not verify on a "USDC" token at the same address
        bs.mint(payer, 10e6);
        Auth memory a = _auth(keccak256("bs"));
        bytes32 wrongDomain = keccak256(
            abi.encodePacked(
                "\x19\x01",
                keccak256(
                    abi.encode(
                        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                        keccak256("USD Coin"),
                        keccak256("2"),
                        block.chainid,
                        address(bs)
                    )
                ),
                keccak256(
                    abi.encode(
                        bs.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(),
                        a.from,
                        a.to,
                        a.value,
                        a.validAfter,
                        a.validBefore,
                        a.nonce
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = _sign(payerKey, wrongDomain);
        vm.expectRevert(EIP3009Token.InvalidSignature.selector);
        bs.transferWithAuthorization(a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, v, r, s);
        (v, r, s) = _sign(payerKey, _digest(bs, bs.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), a));
        bs.transferWithAuthorization(a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, v, r, s);
        assertEq(bs.balanceOf(payee), VALUE);
    }

    function test_MintIsOpen() public {
        vm.prank(relayer);
        usdc.mint(relayer, 1e6);
        assertEq(usdc.balanceOf(relayer), 1e6);
    }

    // ───────────────────────────── transferWithAuthorization ─────────────────────────────

    function test_TransferWithAuthorizationValid() public {
        // (v, r, s) overload, submitted by a relayer
        Auth memory a = _auth(keccak256("n1"));
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(payerKey, a);
        assertFalse(usdc.authorizationState(payer, a.nonce));
        vm.expectEmit(true, true, true, true, address(usdc));
        emit IEIP3009.AuthorizationUsed(payer, a.nonce);
        vm.expectEmit(true, true, true, true, address(usdc));
        emit IERC20.Transfer(payer, payee, VALUE);
        vm.prank(relayer);
        _transfer(a, v, r, s);
        assertTrue(usdc.authorizationState(payer, a.nonce));
        assertEq(usdc.balanceOf(payee), VALUE);
        assertEq(usdc.balanceOf(payer), 100e6 - VALUE);

        // bytes overload (packed r ‖ s ‖ v), submitted by anyone
        Auth memory b = _auth(keccak256("n2"));
        (v, r, s) = _signTransfer(payerKey, b);
        vm.expectEmit(true, true, true, true, address(usdc));
        emit IEIP3009.AuthorizationUsed(payer, b.nonce);
        vm.prank(makeAddr("anyone"));
        _transferBytes(b, abi.encodePacked(r, s, v));
        assertTrue(usdc.authorizationState(payer, b.nonce));
        assertEq(usdc.balanceOf(payee), 2 * VALUE);
    }

    function test_ReceiveWithAuthorizationRequiresRecipient() public {
        Auth memory a = _auth(keccak256("r1"));
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(payerKey, a);
        vm.prank(relayer);
        vm.expectRevert(EIP3009Token.CallerMustBePayee.selector);
        _receive(a, v, r, s);
        vm.prank(payer);
        vm.expectRevert(EIP3009Token.CallerMustBePayee.selector);
        _receiveBytes(a, abi.encodePacked(r, s, v));
        assertFalse(usdc.authorizationState(payer, a.nonce));

        vm.prank(payee);
        _receive(a, v, r, s);
        assertEq(usdc.balanceOf(payee), VALUE);

        Auth memory b = _auth(keccak256("r2"));
        (v, r, s) = _signReceive(payerKey, b);
        vm.prank(payee);
        _receiveBytes(b, abi.encodePacked(r, s, v));
        assertEq(usdc.balanceOf(payee), 2 * VALUE);

        // a TransferWithAuthorization signature is not a ReceiveWithAuthorization signature
        Auth memory c = _auth(keccak256("r3"));
        (v, r, s) = _signTransfer(payerKey, c);
        vm.prank(payee);
        vm.expectRevert(EIP3009Token.InvalidSignature.selector);
        _receive(c, v, r, s);
    }

    function test_RevertWhen_NonceReused() public {
        Auth memory a = _auth(keccak256("dup"));
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(payerKey, a);
        _transfer(a, v, r, s);
        vm.expectRevert(EIP3009Token.AuthorizationUsedOrCanceled.selector);
        _transfer(a, v, r, s);
        vm.expectRevert(EIP3009Token.AuthorizationUsedOrCanceled.selector);
        _transferBytes(a, abi.encodePacked(r, s, v));
        // same nonce on the receive variant
        (v, r, s) = _signReceive(payerKey, a);
        vm.prank(payee);
        vm.expectRevert(EIP3009Token.AuthorizationUsedOrCanceled.selector);
        _receive(a, v, r, s);
        assertEq(usdc.balanceOf(payee), VALUE);

        // the nonce is per authorizer: another payer may reuse the same 32 bytes
        uint256 k6 = otherKey;
        address p6 = vm.addr(k6);
        usdc.mint(p6, 10e6);
        Auth memory b = Auth(p6, payee, VALUE, a.validAfter, a.validBefore, a.nonce);
        (v, r, s) = _signTransfer(k6, b);
        _transfer(b, v, r, s);
        assertEq(usdc.balanceOf(payee), 2 * VALUE);
    }

    function test_RevertWhen_Expired() public {
        Auth memory a = _auth(keccak256("exp"));
        a.validBefore = block.timestamp; // strict <
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(payerKey, a);
        vm.expectRevert(EIP3009Token.AuthorizationExpired.selector);
        _transfer(a, v, r, s);
        a.validBefore = block.timestamp - 1;
        (v, r, s) = _signTransfer(payerKey, a);
        vm.expectRevert(EIP3009Token.AuthorizationExpired.selector);
        _transferBytes(a, abi.encodePacked(r, s, v));
        // and a valid one expires by waiting
        Auth memory b = _auth(keccak256("exp2"));
        (v, r, s) = _signTransfer(payerKey, b);
        vm.warp(b.validBefore);
        vm.expectRevert(EIP3009Token.AuthorizationExpired.selector);
        _transfer(b, v, r, s);
        vm.warp(b.validBefore - 1);
        _transfer(b, v, r, s);
    }

    function test_RevertWhen_NotYetValid() public {
        Auth memory a = _auth(keccak256("nyv"));
        a.validAfter = block.timestamp; // strict >
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(payerKey, a);
        vm.expectRevert(EIP3009Token.AuthorizationNotYetValid.selector);
        _transfer(a, v, r, s);
        a.validAfter = block.timestamp + 10;
        (v, r, s) = _signTransfer(payerKey, a);
        vm.expectRevert(EIP3009Token.AuthorizationNotYetValid.selector);
        _transfer(a, v, r, s);
        vm.warp(a.validAfter + 1);
        _transfer(a, v, r, s);
        assertEq(usdc.balanceOf(payee), VALUE);
    }

    function test_RevertWhen_WrongSigner() public {
        Auth memory a = _auth(keccak256("ws"));
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(otherKey, a); // from = #5, signed by #6
        vm.expectRevert(EIP3009Token.InvalidSignature.selector);
        _transfer(a, v, r, s);

        // value / to / nonce tampered after signing
        (v, r, s) = _signTransfer(payerKey, a);
        Auth memory t = _auth(a.nonce); // fresh copy (memory structs alias)
        t.value = VALUE + 1;
        vm.expectRevert(EIP3009Token.InvalidSignature.selector);
        _transfer(t, v, r, s);
        t = _auth(a.nonce);
        t.to = relayer;
        vm.expectRevert(EIP3009Token.InvalidSignature.selector);
        _transfer(t, v, r, s);
        t = _auth(keccak256("other-nonce"));
        vm.expectRevert(EIP3009Token.InvalidSignature.selector);
        _transfer(t, v, r, s);
        assertFalse(usdc.authorizationState(payer, a.nonce));
        _transfer(a, v, r, s); // the untampered one still works
    }

    function test_CancelAuthorization() public {
        Auth memory a = _auth(keccak256("cancel"));
        (uint8 tv, bytes32 tr, bytes32 ts) = _signTransfer(payerKey, a);
        (uint8 v, bytes32 r, bytes32 s) = _sign(payerKey, _cancelDigest(usdc, payer, a.nonce));

        // wrong signer cannot cancel
        (uint8 ov, bytes32 or_, bytes32 os) = _sign(otherKey, _cancelDigest(usdc, payer, a.nonce));
        vm.expectRevert(EIP3009Token.InvalidSignature.selector);
        usdc.cancelAuthorization(payer, a.nonce, ov, or_, os);

        vm.expectEmit(true, true, true, true, address(usdc));
        emit IEIP3009.AuthorizationCanceled(payer, a.nonce);
        vm.prank(relayer); // anyone may submit
        usdc.cancelAuthorization(payer, a.nonce, v, r, s);
        assertTrue(usdc.authorizationState(payer, a.nonce));

        vm.expectRevert(EIP3009Token.AuthorizationUsedOrCanceled.selector);
        _transfer(a, tv, tr, ts);
        vm.expectRevert(EIP3009Token.AuthorizationUsedOrCanceled.selector);
        usdc.cancelAuthorization(payer, a.nonce, v, r, s);
        assertEq(usdc.balanceOf(payee), 0);

        // bytes overload; and a used nonce cannot be cancelled
        bytes32 n2 = keccak256("cancel2");
        (v, r, s) = _sign(payerKey, _cancelDigest(usdc, payer, n2));
        usdc.cancelAuthorization(payer, n2, abi.encodePacked(r, s, v));
        assertTrue(usdc.authorizationState(payer, n2));
        Auth memory b = _auth(keccak256("used"));
        (tv, tr, ts) = _signTransfer(payerKey, b);
        _transfer(b, tv, tr, ts);
        (v, r, s) = _sign(payerKey, _cancelDigest(usdc, payer, b.nonce));
        vm.expectRevert(EIP3009Token.AuthorizationUsedOrCanceled.selector);
        usdc.cancelAuthorization(payer, b.nonce, v, r, s);
    }

    function test_RevertWhen_HighS() public {
        Auth memory a = _auth(keccak256("highs"));
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(payerKey, a);
        bytes32 highS = bytes32(uint256(SECP256K1_N) - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;
        // the flipped signature is mathematically valid for the same signer, but rejected (T-17)
        assertEq(ecrecover(_digest(usdc, usdc.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), a), flippedV, r, highS), payer);
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureS.selector, highS));
        _transfer(a, flippedV, r, highS);
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureS.selector, highS));
        _transferBytes(a, abi.encodePacked(r, highS, flippedV));
        _transfer(a, v, r, s);
    }

    function test_RevertWhen_CompactOrBadSignature() public {
        Auth memory a = _auth(keccak256("2098"));
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(payerKey, a);
        bytes32 vs = bytes32(uint256(s) | (uint256(v - 27) << 255));
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, uint256(64)));
        _transferBytes(a, abi.encodePacked(r, vs)); // EIP-2098 compact form is not accepted by the mock
        vm.expectRevert(ECDSA.ECDSAInvalidSignature.selector);
        _transfer(a, 29, r, s); // bad v
        vm.expectRevert(ECDSA.ECDSAInvalidSignature.selector);
        _transfer(a, v, bytes32(0), s);
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, uint256(66)));
        _transferBytes(a, abi.encodePacked(r, s, v, uint8(0)));
    }

    function test_RevertWhen_TransferToZeroOrInsufficientBalance() public {
        Auth memory a = _auth(keccak256("zero"));
        a.to = address(0);
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(payerKey, a);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        _transfer(a, v, r, s);
        Auth memory b = _auth(keccak256("big"));
        b.value = 100e6 + 1;
        (v, r, s) = _signTransfer(payerKey, b);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, payer, 100e6, 100e6 + 1));
        _transfer(b, v, r, s);
        assertFalse(usdc.authorizationState(payer, b.nonce)); // the revert rolls back the nonce
    }

    // ───────────────────────────── replay across domains (T-14) ─────────────────────────────

    function test_DomainSeparatorMatchesChainId() public {
        Auth memory a = _auth(keccak256("xchain"));
        bytes32 sep31337 = usdc.DOMAIN_SEPARATOR();
        bytes32 d31337 = _digest(usdc, usdc.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), a);
        (uint8 v, bytes32 r, bytes32 s) = _sign(payerKey, d31337);

        vm.chainId(84_532);
        bytes32 sep84532 = usdc.DOMAIN_SEPARATOR(); // read afresh: OZ rebuilds when chainid differs from the cache
        bytes32 d84532 = _digest(usdc, usdc.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), a);
        assertTrue(sep31337 != sep84532);
        assertTrue(d31337 != d84532);
        (,,, uint256 chainId,,,) = usdc.eip712Domain();
        assertEq(chainId, 84_532);
        vm.expectRevert(EIP3009Token.InvalidSignature.selector); // the foreign-chain signature is rejected
        _transfer(a, v, r, s);

        vm.chainId(31_337);
        assertEq(usdc.DOMAIN_SEPARATOR(), sep31337);
        _transfer(a, v, r, s);
    }

    function test_Attack_OtherTokenRejectsSignature() public {
        MockUSDC3009 other = new MockUSDC3009();
        other.mint(payer, 10e6);
        Auth memory a = _auth(keccak256("xcontract"));
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(payerKey, a);
        assertTrue(other.DOMAIN_SEPARATOR() != usdc.DOMAIN_SEPARATOR());
        vm.expectRevert(EIP3009Token.InvalidSignature.selector);
        other.transferWithAuthorization(a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, v, r, s);
        _transfer(a, v, r, s);
    }

    // ───────────────────────────── A15: settlement front-run facts ─────────────────────────────

    function test_Attack_FrontRunStillPaysPayTo() public {
        Auth memory a = _auth(keccak256("frontrun"));
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(payerKey, a);
        vm.prank(relayer); // a stranger submits first
        _transfer(a, v, r, s);
        assertTrue(usdc.authorizationState(payer, a.nonce));
        assertEq(usdc.balanceOf(payee), VALUE); // funds still reached payTo
        vm.prank(makeAddr("facilitator"));
        vm.expectRevert(EIP3009Token.AuthorizationUsedOrCanceled.selector);
        _transfer(a, v, r, s);
        assertEq(usdc.balanceOf(payee), VALUE);
    }

    // ───────────────────────────── fuzz ─────────────────────────────

    function testFuzz_TransferWithAuthorization(uint256 value, bytes32 nonce, uint256 window, address submitter)
        public
    {
        value = bound(value, 0, 100e6);
        window = bound(window, 1, 365 days);
        vm.assume(submitter != address(0));
        Auth memory a = Auth(payer, payee, value, block.timestamp - 1, block.timestamp + window, nonce);
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(payerKey, a);
        vm.prank(submitter);
        _transferBytes(a, abi.encodePacked(r, s, v));
        assertEq(usdc.balanceOf(payee), value);
        assertEq(usdc.balanceOf(payer), 100e6 - value);
        assertTrue(usdc.authorizationState(payer, nonce));
        vm.expectRevert(EIP3009Token.AuthorizationUsedOrCanceled.selector);
        _transfer(a, v, r, s);
    }

    function testFuzz_WrongKeyNeverTransfers(uint256 pk, bytes32 nonce) public {
        pk = bound(pk, 1, uint256(SECP256K1_N) - 1);
        vm.assume(pk != payerKey);
        Auth memory a = _auth(nonce);
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(pk, a);
        vm.expectRevert(EIP3009Token.InvalidSignature.selector);
        _transfer(a, v, r, s);
    }
}
