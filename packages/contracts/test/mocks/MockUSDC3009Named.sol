// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EIP3009Token} from "../../src/EIP3009Token.sol";

/// @title MockUSDC3009Named — EIP-3009 test token with a configurable EIP-712 name/version.
/// @notice e.g. `("USDC", "2")` reproduces Base Sepolia's Circle USDC domain (docs/vendor/API-FACTS.md §7).
contract MockUSDC3009Named is EIP3009Token {
    constructor(string memory name_, string memory version_) EIP3009Token(name_, "USDC", version_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
