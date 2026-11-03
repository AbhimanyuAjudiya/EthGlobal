// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EIP3009Token} from "./EIP3009Token.sol";

/// @title MockUSDC3009 — local stand-in for Circle USDC: ERC20("USD Coin","USDC"), 6 decimals, EIP712("USD Coin","2").
/// @notice TEST TOKEN ONLY: `mint` is open to anyone. `script/Deploy.s.sol` deploys it on Anvil (31337) only; never
///         deploy it to a live chain. Digests match FiatTokenV2_2 on chains whose USDC `name()` is "USD Coin"; for Base
///         Sepolia ("USDC") use an `EIP3009Token` with that name (see test/mocks/MockUSDC3009Named.sol).
contract MockUSDC3009 is EIP3009Token {
    /// @notice Deploys with Circle's mainnet domain ("USD Coin", "2").
    constructor() EIP3009Token("USD Coin", "USDC", "2") {}

    /// @notice Open mint (test token). `amount` is in 6-decimal base units (`1_000_000e6` = one million USDC).
    /// @param to Recipient.
    /// @param amount Base units to mint.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
