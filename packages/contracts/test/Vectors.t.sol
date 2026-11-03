// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {EIP3009Token} from "../src/EIP3009Token.sol";
import {MockUSDC3009} from "../src/MockUSDC3009.sol";
import {MockUSDC3009Named} from "./mocks/MockUSDC3009Named.sol";
import {InstallAt} from "./utils/InstallAt.sol";

/// @notice fixtures/eip3009/vectors.json (written by script/EmitVectors.s.sol, consumed by @ethglobal/eip3009) agrees
///         with the token: each domain's separator equals the contract's `DOMAIN_SEPARATOR()` when deployed at the
///         recorded address/chain, every digest is reproduced from that separator and the contract's typehashes, every
///         signature recovers to Anvil #5, and every authorization actually executes on the contract.
contract VectorsTest is Test {
    string internal json;
    uint256 internal constant DOMAINS = 2;
    uint256 internal constant VECTORS = 16;

    struct V {
        uint256 domain;
        address from;
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        bytes32 transferDigest;
        bytes32 receiveDigest;
        bytes transferSignature;
        bytes receiveSignature;
    }

    function setUp() public {
        json = vm.readFile(string.concat(vm.projectRoot(), "/../../fixtures/eip3009/vectors.json"));
    }

    function _p(uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".vectors[", vm.toString(i), "].", field);
    }

    function _u(uint256 i, string memory field) internal view returns (uint256) {
        return vm.parseUint(vm.parseJsonString(json, _p(i, field)));
    }

    function _vector(uint256 i) internal view returns (V memory v) {
        v.domain = vm.parseJsonUint(json, _p(i, "domain"));
        v.from = vm.parseJsonAddress(json, _p(i, "from"));
        v.to = vm.parseJsonAddress(json, _p(i, "to"));
        v.value = _u(i, "value");
        v.validAfter = _u(i, "validAfter");
        v.validBefore = _u(i, "validBefore");
        v.nonce = vm.parseJsonBytes32(json, _p(i, "nonce"));
        v.transferDigest = vm.parseJsonBytes32(json, _p(i, "transferDigest"));
        v.receiveDigest = vm.parseJsonBytes32(json, _p(i, "receiveDigest"));
        v.transferSignature = vm.parseJsonBytes(json, _p(i, "transferSignature"));
        v.receiveSignature = vm.parseJsonBytes(json, _p(i, "receiveSignature"));
    }

    /// @dev Deploys the token for domain `d` at its recorded address under its recorded chain id.
    function _token(uint256 d) internal returns (EIP3009Token t) {
        string memory base = string.concat(".domains[", vm.toString(d), "]");
        string memory name = vm.parseJsonString(json, string.concat(base, ".name"));
        string memory version = vm.parseJsonString(json, string.concat(base, ".version"));
        vm.chainId(vm.parseJsonUint(json, string.concat(base, ".chainId")));
        address at = vm.parseJsonAddress(json, string.concat(base, ".verifyingContract"));
        bytes memory creation = keccak256(bytes(name)) == keccak256("USD Coin")
            && keccak256(bytes(version)) == keccak256("2")
            ? type(MockUSDC3009).creationCode
            : abi.encodePacked(type(MockUSDC3009Named).creationCode, abi.encode(name, version));
        InstallAt.install(at, creation);
        t = EIP3009Token(at);
        assertEq(t.name(), name);
        assertEq(t.DOMAIN_SEPARATOR(), vm.parseJsonBytes32(json, string.concat(base, ".separator")));
    }

    function test_FileShape() public view {
        assertEq(vm.parseJsonString(json, ".source"), "forge");
        assertTrue(vm.keyExistsJson(json, string.concat(".domains[", vm.toString(DOMAINS - 1), "]")));
        assertFalse(vm.keyExistsJson(json, string.concat(".domains[", vm.toString(DOMAINS), "]")));
        assertTrue(vm.keyExistsJson(json, string.concat(".vectors[", vm.toString(VECTORS - 1), "]")));
        assertFalse(vm.keyExistsJson(json, string.concat(".vectors[", vm.toString(VECTORS), "]")));
        assertEq(vm.parseJsonUint(json, ".domains[0].chainId"), 31_337);
        assertEq(vm.parseJsonString(json, ".domains[0].name"), "USD Coin");
        assertEq(vm.parseJsonUint(json, ".domains[1].chainId"), 84_532);
        assertEq(vm.parseJsonAddress(json, ".domains[1].verifyingContract"), 0x036CbD53842c5426634e7929541eC2318f3dCF7e);
        assertEq(
            vm.parseJsonAddress(json, ".signer"),
            vm.addr(vm.deriveKey("test test test test test test test test test test test junk", 5))
        );
    }

    function test_TypehashesMatchContract() public {
        EIP3009Token t = _token(0);
        assertEq(
            vm.parseJsonBytes32(json, ".typehashes.transferWithAuthorization"), t.TRANSFER_WITH_AUTHORIZATION_TYPEHASH()
        );
        assertEq(
            vm.parseJsonBytes32(json, ".typehashes.receiveWithAuthorization"), t.RECEIVE_WITH_AUTHORIZATION_TYPEHASH()
        );
        assertEq(vm.parseJsonBytes32(json, ".typehashes.cancelAuthorization"), t.CANCEL_AUTHORIZATION_TYPEHASH());
    }

    function test_EveryVectorReproducesAndExecutes() public {
        address signer = vm.parseJsonAddress(json, ".signer");
        for (uint256 d = 0; d < DOMAINS; d++) {
            uint256 snap = vm.snapshotState();
            EIP3009Token t = _token(d);
            uint256 seen;
            for (uint256 i = 0; i < VECTORS; i++) {
                V memory v = _vector(i);
                if (v.domain != d) continue;
                seen++;
                bytes32 sep = t.DOMAIN_SEPARATOR();
                bytes32 td = keccak256(
                    abi.encodePacked(
                        "\x19\x01",
                        sep,
                        keccak256(
                            abi.encode(
                                t.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(),
                                v.from,
                                v.to,
                                v.value,
                                v.validAfter,
                                v.validBefore,
                                v.nonce
                            )
                        )
                    )
                );
                bytes32 rd = keccak256(
                    abi.encodePacked(
                        "\x19\x01",
                        sep,
                        keccak256(
                            abi.encode(
                                t.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                                v.from,
                                v.to,
                                v.value,
                                v.validAfter,
                                v.validBefore,
                                v.nonce
                            )
                        )
                    )
                );
                assertEq(td, v.transferDigest, "transfer digest");
                assertEq(rd, v.receiveDigest, "receive digest");
                assertEq(_recover(td, v.transferSignature), signer, "transfer signer");
                assertEq(_recover(rd, v.receiveSignature), signer, "receive signer");
                assertEq(v.from, signer);

                // execute both on the token inside the validity window
                vm.warp(v.validAfter + 1);
                (bool ok,) = address(t).call(abi.encodeWithSignature("mint(address,uint256)", v.from, v.value));
                assertTrue(ok);
                uint256 before = t.balanceOf(v.to);
                t.transferWithAuthorization(
                    v.from, v.to, v.value, v.validAfter, v.validBefore, v.nonce, v.transferSignature
                );
                assertEq(t.balanceOf(v.to) - before, v.value);
                assertTrue(t.authorizationState(v.from, v.nonce));
            }
            assertEq(seen, VECTORS / DOMAINS);
            vm.revertToState(snap);
        }
    }

    function test_EveryReceiveVectorExecutesOnlyForPayee() public {
        for (uint256 d = 0; d < DOMAINS; d++) {
            uint256 snap = vm.snapshotState();
            EIP3009Token t = _token(d);
            for (uint256 i = 0; i < VECTORS; i++) {
                V memory v = _vector(i);
                if (v.domain != d) continue;
                vm.warp(v.validAfter + 1);
                (bool ok,) = address(t).call(abi.encodeWithSignature("mint(address,uint256)", v.from, v.value));
                assertTrue(ok);
                vm.expectRevert(EIP3009Token.CallerMustBePayee.selector);
                t.receiveWithAuthorization(
                    v.from, v.to, v.value, v.validAfter, v.validBefore, v.nonce, v.receiveSignature
                );
                vm.prank(v.to);
                t.receiveWithAuthorization(
                    v.from, v.to, v.value, v.validAfter, v.validBefore, v.nonce, v.receiveSignature
                );
                assertTrue(t.authorizationState(v.from, v.nonce));
            }
            vm.revertToState(snap);
        }
    }

    function _recover(bytes32 digest, bytes memory sig) internal pure returns (address) {
        assertEq(sig.length, 65);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        return ecrecover(digest, v, r, s);
    }
}
