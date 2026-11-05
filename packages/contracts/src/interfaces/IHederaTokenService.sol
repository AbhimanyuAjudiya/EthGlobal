// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title IHederaTokenService — the single HTS system-contract function DataDrop needs.
/// @notice The HTS system contract lives at 0x0000000000000000000000000000000000000167 on Hedera (chain ids 295/296).
///         Response code 22 is SUCCESS. Under Hedera's v2 security model `msg.sender` must be `account`
///         (DataDrop associates itself). [verify Wed] against the live relay.
interface IHederaTokenService {
    /// @notice Associates `token` with `account` so `account` can hold it.
    /// @param account The account (here: the DataDrop contract itself).
    /// @param token The HTS token's EVM (long-zero) address.
    /// @return responseCode Hedera response code; 22 == SUCCESS.
    function associateToken(address account, address token) external returns (int64 responseCode);
}
