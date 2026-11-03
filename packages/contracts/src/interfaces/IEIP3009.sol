// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title IEIP3009 — transfer with authorization (Circle FiatTokenV2_2 surface). Binding: docs/INTERFACES.md §6.2.
/// @notice Typehashes (verbatim):
///         "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)",
///         "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)",
///         "CancelAuthorization(address authorizer,bytes32 nonce)".
interface IEIP3009 {
    /// @notice An authorization was executed.
    /// @param authorizer The payer (`from`).
    /// @param nonce The authorization nonce, now permanently used.
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    /// @notice An authorization was cancelled before use.
    /// @param authorizer The payer that signed the cancellation.
    /// @param nonce The authorization nonce, now permanently used.
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    /// @notice Whether `nonce` has been used or cancelled by `authorizer`.
    /// @param authorizer Payer.
    /// @param nonce 32-byte nonce.
    /// @return True when used or cancelled.
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
    /// @notice Executes a signed transfer; any caller may submit it.
    /// @param from Payer (signer).
    /// @param to Payee.
    /// @param value Amount (6 decimals for USDC).
    /// @param validAfter Valid strictly after this unix time.
    /// @param validBefore Valid strictly before this unix time.
    /// @param nonce Unique 32-byte nonce.
    /// @param v Signature v.
    /// @param r Signature r.
    /// @param s Signature s.
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
    ) external;
    /// @notice Same as above with a packed `r ‖ s ‖ v` 65-byte signature.
    /// @param from Payer.
    /// @param to Payee.
    /// @param value Amount.
    /// @param validAfter Lower bound (exclusive).
    /// @param validBefore Upper bound (exclusive).
    /// @param nonce Nonce.
    /// @param signature Packed signature.
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;
    /// @notice Executes a signed transfer; only `to` may submit it (front-run safe).
    /// @param from Payer.
    /// @param to Payee and required caller.
    /// @param value Amount.
    /// @param validAfter Lower bound.
    /// @param validBefore Upper bound.
    /// @param nonce Nonce.
    /// @param v Signature v.
    /// @param r Signature r.
    /// @param s Signature s.
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
    ) external;
    /// @notice Same as above with a packed `r ‖ s ‖ v` 65-byte signature.
    /// @param from Payer.
    /// @param to Payee and required caller.
    /// @param value Amount.
    /// @param validAfter Lower bound.
    /// @param validBefore Upper bound.
    /// @param nonce Nonce.
    /// @param signature Packed signature.
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;
    /// @notice Cancels an unused authorization; any caller may submit the authorizer's signature.
    /// @param authorizer Payer.
    /// @param nonce Nonce to burn.
    /// @param v Signature v.
    /// @param r Signature r.
    /// @param s Signature s.
    function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;
}
