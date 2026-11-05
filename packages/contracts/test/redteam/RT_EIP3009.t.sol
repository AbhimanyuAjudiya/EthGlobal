// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {EIP3009Token} from "../../src/EIP3009Token.sol";
import {MockUSDC3009} from "../../src/MockUSDC3009.sol";
import {MockUSDC3009Named} from "../mocks/MockUSDC3009Named.sol";

/// @notice Red-team attacks on the EIP-3009 mock vs Circle FiatTokenV2_2 semantics (T-13, T-14, T-17).
contract RT_EIP3009Test is Test {
    MockUSDC3009 internal usdc;
    address internal payer;
    uint256 internal payerKey;
    address internal payee = makeAddr("rt-payee");
    address internal relayer = makeAddr("rt-relayer");
    uint256 internal constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    function setUp() public {
        vm.warp(1_762_200_000);
        usdc = new MockUSDC3009();
        (payer, payerKey) = makeAddrAndKey("rt-payer");
        usdc.mint(payer, 100e6);
    }

    function _digest(EIP3009Token t, bytes32 typehash, address to, uint256 value, uint256 va, uint256 vb, bytes32 nonce)
        internal
        view
        returns (bytes32)
    {
        bytes32 sh = keccak256(abi.encode(typehash, payer, to, value, va, vb, nonce));
        return keccak256(abi.encodePacked("\x19\x01", t.DOMAIN_SEPARATOR(), sh));
    }

    function _cancelDigest(EIP3009Token t, bytes32 nonce) internal view returns (bytes32) {
        bytes32 sh = keccak256(abi.encode(t.CANCEL_AUTHORIZATION_TYPEHASH(), payer, nonce));
        return keccak256(abi.encodePacked("\x19\x01", t.DOMAIN_SEPARATOR(), sh));
    }

    function _sig(bytes32 d) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, d);
        return abi.encodePacked(r, s, v);
    }

    function _tw(bytes32 nonce) internal view returns (bytes memory) {
        return _sig(
            _digest(usdc, usdc.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), payee, 1e6, 0, block.timestamp + 1 hours, nonce)
        );
    }

    function _rw(bytes32 nonce) internal view returns (bytes memory) {
        return _sig(
            _digest(usdc, usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), payee, 1e6, 0, block.timestamp + 1 hours, nonce)
        );
    }

    function _doTransfer(bytes32 nonce, bytes memory sig) internal {
        usdc.transferWithAuthorization(payer, payee, 1e6, 0, block.timestamp + 1 hours, nonce, sig);
    }

    function _doReceive(bytes32 nonce, bytes memory sig) internal {
        vm.prank(payee);
        usdc.receiveWithAuthorization(payer, payee, 1e6, 0, block.timestamp + 1 hours, nonce, sig);
    }

    /// Property: one nonce is single-use across transfer → receive (both signed validly for their own typehash).
    function test_RT_NonceSharedTransferThenReceive() public {
        bytes32 n = keccak256("n1");
        _doTransfer(n, _tw(n));
        bytes memory rs = _rw(n);
        vm.expectRevert(EIP3009Token.AuthorizationUsedOrCanceled.selector);
        this.doReceiveExt(n, rs);
        assertEq(usdc.balanceOf(payee), 1e6);
    }

    function doReceiveExt(bytes32 n, bytes memory s) external {
        _doReceive(n, s);
    }

    /// Property: receive → transfer with the same nonce is rejected too.
    function test_RT_NonceSharedReceiveThenTransfer() public {
        bytes32 n = keccak256("n2");
        _doReceive(n, _rw(n));
        bytes memory ts = _tw(n);
        vm.expectRevert(EIP3009Token.AuthorizationUsedOrCanceled.selector);
        _doTransfer(n, ts);
    }

    /// Property: a ReceiveWithAuthorization signature can NOT be replayed through transferWithAuthorization by a
    ///           front-runner (typehash binding) — the payee-only guarantee T-15 relies on.
    function test_RT_ReceiveSigNotUsableAsTransfer() public {
        bytes32 n = keccak256("n3");
        bytes memory rs = _rw(n);
        vm.prank(relayer);
        vm.expectRevert(EIP3009Token.InvalidSignature.selector);
        _doTransfer(n, rs);
        assertFalse(usdc.authorizationState(payer, n));
        _doReceive(n, rs); // still usable by the payee
    }

    /// Property: a TransferWithAuthorization signature is not a receive signature either.
    function test_RT_TransferSigNotUsableAsReceive() public {
        bytes32 n = keccak256("n4");
        bytes memory ts = _tw(n);
        vm.expectRevert(EIP3009Token.InvalidSignature.selector);
        this.doReceiveExt(n, ts);
    }

    /// Property: cancel race — if the transfer lands first, cancel reverts; if cancel lands first, transfer and receive
    ///           revert. Either way exactly one effect, matching FiatTokenV2_2.
    function test_RT_CancelRaceBothOrders() public {
        bytes32 n1 = keccak256("race1");
        bytes memory c1 = _sig(_cancelDigest(usdc, n1));
        _doTransfer(n1, _tw(n1)); // front-runner wins
        vm.expectRevert(EIP3009Token.AuthorizationUsedOrCanceled.selector);
        usdc.cancelAuthorization(payer, n1, c1);

        bytes32 n2 = keccak256("race2");
        usdc.cancelAuthorization(payer, n2, _sig(_cancelDigest(usdc, n2)));
        bytes memory t2 = _tw(n2);
        vm.expectRevert(EIP3009Token.AuthorizationUsedOrCanceled.selector);
        _doTransfer(n2, t2);
        bytes memory r2 = _rw(n2);
        vm.expectRevert(EIP3009Token.AuthorizationUsedOrCanceled.selector);
        this.doReceiveExt(n2, r2);
        assertEq(usdc.balanceOf(payee), 1e6);
    }

    /// Property: a cancel signature cannot be replayed (second cancel reverts) and a cancel signed by someone else fails.
    function test_RT_CancelReplayAndForeignSigner() public {
        bytes32 n = keccak256("c");
        bytes memory c = _sig(_cancelDigest(usdc, n));
        usdc.cancelAuthorization(payer, n, c);
        vm.expectRevert(EIP3009Token.AuthorizationUsedOrCanceled.selector);
        usdc.cancelAuthorization(payer, n, c);
        (, uint256 k2) = makeAddrAndKey("rt-other");
        bytes32 n2 = keccak256("c2");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(k2, _cancelDigest(usdc, n2));
        vm.expectRevert(EIP3009Token.InvalidSignature.selector);
        usdc.cancelAuthorization(payer, n2, v, r, s);
    }

    /// Property: EIP-2098 64-byte compact signatures are rejected on every bytes overload (transfer, receive, cancel).
    function test_RT_CompactSigRejectedEverywhere() public {
        bytes32 n = keccak256("compact");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            payerKey,
            _digest(usdc, usdc.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), payee, 1e6, 0, block.timestamp + 1 hours, n)
        );
        bytes32 vs = bytes32(uint256(s) | (uint256(v - 27) << 255));
        bytes memory compact = abi.encodePacked(r, vs);
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, 64));
        _doTransfer(n, compact);
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, 64));
        this.doReceiveExt(n, compact);
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, 64));
        usdc.cancelAuthorization(payer, n, compact);
        assertFalse(usdc.authorizationState(payer, n));
    }

    /// Property: high-s malleated twins are rejected on the v,r,s overloads of receive and cancel (T-17).
    function test_RT_HighSRejectedOnReceiveAndCancel() public {
        bytes32 n = keccak256("highs");
        uint256 vb = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(payerKey, _digest(usdc, usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), payee, 1e6, 0, vb, n));
        bytes32 s2 = bytes32(N - uint256(s));
        uint8 v2 = v == 27 ? 28 : 27;
        vm.prank(payee);
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureS.selector, s2));
        usdc.receiveWithAuthorization(payer, payee, 1e6, 0, vb, n, v2, r, s2);
        (v, r, s) = vm.sign(payerKey, _cancelDigest(usdc, n));
        s2 = bytes32(N - uint256(s));
        v2 = v == 27 ? 28 : 27;
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureS.selector, s2));
        usdc.cancelAuthorization(payer, n, v2, r, s2);
    }

    /// Property: v ∈ {0,1} (un-normalised) is rejected — the TS side must normalise to 27/28 like Circle requires.
    function test_RT_RawVZeroOneRejected() public {
        bytes32 n = keccak256("v01");
        uint256 vb = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(payerKey, _digest(usdc, usdc.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), payee, 1e6, 0, vb, n));
        vm.expectRevert(ECDSA.ECDSAInvalidSignature.selector);
        usdc.transferWithAuthorization(payer, payee, 1e6, 0, vb, n, v - 27, r, s);
    }

    /// Property: after a chain fork (chainid change) the domain separator is recomputed: old-chain signatures fail,
    ///           new-chain signatures work, and the separator equals the canonical formula for the new id.
    function test_RT_ForkRecomputesDomain() public {
        bytes32 n = keccak256("fork");
        bytes memory oldSig = _tw(n);
        bytes32 sepOld = usdc.DOMAIN_SEPARATOR();
        vm.chainId(84_532);
        bytes32 sepNew = usdc.DOMAIN_SEPARATOR();
        assertTrue(sepOld != sepNew);
        assertEq(
            sepNew,
            keccak256(
                abi.encode(
                    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                    keccak256("USD Coin"),
                    keccak256("2"),
                    uint256(84_532),
                    address(usdc)
                )
            )
        );
        vm.expectRevert(EIP3009Token.InvalidSignature.selector);
        _doTransfer(n, oldSig);
        _doTransfer(n, _tw(n));
        (,,, uint256 cid,,,) = usdc.eip712Domain();
        assertEq(cid, 84_532);
    }

    /// Property: a Base-Sepolia-named ("USDC") token rejects a "USD Coin"-domain signature for the same address/chain.
    function test_RT_DomainNameBinding() public {
        MockUSDC3009Named named = new MockUSDC3009Named("USDC", "2");
        bytes32 n = keccak256("named");
        uint256 vb = block.timestamp + 1 hours;
        // sign with the *other* name over the named token's address/chain
        bytes32 wrongSep = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("USD Coin"),
                keccak256("2"),
                block.chainid,
                address(named)
            )
        );
        bytes32 sh = keccak256(abi.encode(named.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), payer, payee, 1, 0, vb, n));
        bytes memory sig = _sig(keccak256(abi.encodePacked("\x19\x01", wrongSep, sh)));
        vm.expectRevert(EIP3009Token.InvalidSignature.selector);
        named.transferWithAuthorization(payer, payee, 1, 0, vb, n, sig);
    }

    /// Property: a reverted authorization (insufficient balance) does not burn the nonce; it is usable once funded.
    function test_RT_FailedTransferDoesNotBurnNonce() public {
        bytes32 n = keccak256("nobal");
        uint256 vb = block.timestamp + 1 hours;
        bytes memory sig = _sig(_digest(usdc, usdc.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), payee, 500e6, 0, vb, n));
        vm.expectRevert();
        usdc.transferWithAuthorization(payer, payee, 500e6, 0, vb, n, sig);
        assertFalse(usdc.authorizationState(payer, n));
        usdc.mint(payer, 500e6);
        usdc.transferWithAuthorization(payer, payee, 500e6, 0, vb, n, sig);
        assertTrue(usdc.authorizationState(payer, n));
    }

    /// Property: nonces are namespaced per authorizer — another payer's use of the same nonce does not block this one.
    function test_RT_NonceNamespacedPerAuthorizer() public {
        bytes32 n = keccak256("shared");
        (address p2, uint256 k2) = makeAddrAndKey("rt-payer2");
        usdc.mint(p2, 1e6);
        uint256 vb = block.timestamp + 1 hours;
        bytes32 sh = keccak256(abi.encode(usdc.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), p2, payee, 1e6, 0, vb, n));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(k2, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), sh)));
        usdc.transferWithAuthorization(p2, payee, 1e6, 0, vb, n, v, r, s);
        _doTransfer(n, _tw(n));
        assertEq(usdc.balanceOf(payee), 2e6);
    }

    /// Property: arbitrary 65-byte garbage never moves funds or burns a nonce.
    function testFuzz_RT_GarbageSigNeverTransfers(bytes32 r, bytes32 s, uint8 v, bytes32 n) public {
        bytes memory sig = abi.encodePacked(r, s, v);
        try usdc.transferWithAuthorization(payer, payee, 1e6, 0, block.timestamp + 1, n, sig) {
            fail();
        } catch {}
        assertEq(usdc.balanceOf(payee), 0);
        assertFalse(usdc.authorizationState(payer, n));
    }
}
