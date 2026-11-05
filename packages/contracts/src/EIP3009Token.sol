// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {IEIP3009} from "./interfaces/IEIP3009.sol";

/// @title EIP3009Token — a 6-decimal ERC-20 with Circle FiatTokenV2_2's EIP-3009 surface and digest layout.
/// @notice The EIP-712 domain is `(name, version, block.chainid, address(this))` with `name == name()`, exactly like
///         FiatTokenV2_2 (`"USD Coin"` on most mainnets, `"USDC"` on Base Sepolia; version `"2"`). The constructor makes
///         name/version configurable so a test can reproduce either deployment; `MockUSDC3009` fixes `("USD Coin","2")`.
///
///         Semantics mirrored from FiatTokenV2_2: `validAfter < block.timestamp < validBefore` (both strict); a nonce is
///         single-use per authorizer across transfer, receive and cancel; `receiveWithAuthorization` requires
///         `msg.sender == to`; `AuthorizationUsed` is emitted before the balance moves.
///
///         Differences from FiatTokenV2_2 (it is a test token): no pause, no blacklist, no EIP-1271 contract-wallet
///         signatures, and only 65-byte `r ‖ s ‖ v` signatures — EIP-2098 64-byte compact signatures revert with
///         `ECDSAInvalidSignatureLength` (the TS `recoverSigner` must expand them first). OZ `ECDSA` rejects high-`s`
///         (`ECDSAInvalidSignatureS`, T-17) and invalid `v`.
abstract contract EIP3009Token is ERC20, EIP712, IEIP3009 {
    /// @notice keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;
    /// @notice keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;
    /// @notice keccak256("CancelAuthorization(address authorizer,bytes32 nonce)")
    bytes32 public constant CANCEL_AUTHORIZATION_TYPEHASH =
        0x158b0a9edf7a828aad02f63cd515c68ef2f50ba807396f6d12842833a1597429;

    /// @notice `block.timestamp <= validAfter`.
    error AuthorizationNotYetValid();
    /// @notice `block.timestamp >= validBefore`.
    error AuthorizationExpired();
    /// @notice The nonce was already used or cancelled by this authorizer.
    error AuthorizationUsedOrCanceled();
    /// @notice The recovered signer is not the authorizer.
    error InvalidSignature();
    /// @notice `receiveWithAuthorization` was not submitted by the payee.
    error CallerMustBePayee();

    string private _version;
    mapping(address authorizer => mapping(bytes32 nonce => bool used)) private _authorizationStates;

    /// @param name_ ERC-20 name and EIP-712 domain name (Circle: they are the same value).
    /// @param symbol_ ERC-20 symbol.
    /// @param version_ EIP-712 domain version (Circle: "2").
    constructor(string memory name_, string memory symbol_, string memory version_)
        ERC20(name_, symbol_)
        EIP712(name_, version_)
    {
        _version = version_;
    }

    /// @notice USDC has 6 decimals: `$1 == 1_000_000` base units.
    /// @return Always 6.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice EIP-712 domain version (FiatToken exposes `version()`; also available via ERC-5267 `eip712Domain()`).
    /// @return The version string.
    function version() external view returns (string memory) {
        return _version;
    }

    /// @notice The EIP-712 domain separator for the current chain id and this address (recomputed after a fork).
    /// @return The separator.
    // forge-lint: disable-next-line(mixed-case-function)
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @inheritdoc IEIP3009
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

    /// @inheritdoc IEIP3009
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        _executeAuthorization(
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce,
            abi.encodePacked(r, s, v)
        );
    }

    /// @inheritdoc IEIP3009
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        _executeAuthorization(
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, signature
        );
    }

    /// @inheritdoc IEIP3009
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (msg.sender != to) revert CallerMustBePayee();
        _executeAuthorization(
            RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce,
            abi.encodePacked(r, s, v)
        );
    }

    /// @inheritdoc IEIP3009
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        if (msg.sender != to) revert CallerMustBePayee();
        _executeAuthorization(
            RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, signature
        );
    }

    /// @inheritdoc IEIP3009
    function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external {
        _cancelAuthorization(authorizer, nonce, abi.encodePacked(r, s, v));
    }

    /// @notice FiatTokenV2_2 overload: cancels with a packed 65-byte `r ‖ s ‖ v` signature.
    /// @param authorizer Payer that signed the cancellation.
    /// @param nonce Nonce to burn.
    /// @param signature Packed signature.
    function cancelAuthorization(address authorizer, bytes32 nonce, bytes calldata signature) external {
        _cancelAuthorization(authorizer, nonce, signature);
    }

    /// @dev Shared body of the four transfer/receive entry points: window, nonce, signature, mark used, transfer.
    function _executeAuthorization(
        bytes32 typehash,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) internal {
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
        _requireUnused(from, nonce);
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(typehash, from, to, value, validAfter, validBefore, nonce)));
        _requireSigner(digest, signature, from);

        _authorizationStates[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }

    /// @dev Burns `nonce` for `authorizer` after verifying their CancelAuthorization signature.
    function _cancelAuthorization(address authorizer, bytes32 nonce, bytes memory signature) internal {
        _requireUnused(authorizer, nonce);
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_AUTHORIZATION_TYPEHASH, authorizer, nonce)));
        _requireSigner(digest, signature, authorizer);

        _authorizationStates[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    /// @dev Reverts when `nonce` is used or cancelled.
    function _requireUnused(address authorizer, bytes32 nonce) internal view {
        if (_authorizationStates[authorizer][nonce]) revert AuthorizationUsedOrCanceled();
    }

    /// @dev Reverts unless `signature` (65 bytes, low-s) over `digest` recovers to `signer`.
    function _requireSigner(bytes32 digest, bytes memory signature, address signer) internal pure {
        if (ECDSA.recover(digest, signature) != signer) revert InvalidSignature();
    }
}
