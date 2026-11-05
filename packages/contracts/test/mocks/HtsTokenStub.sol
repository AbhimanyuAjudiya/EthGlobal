// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title HtsTokenStub — stands in for the HIP-719 facade of HTS USDC at its long-zero address in deploy tests.
/// @notice Answers `decimals() == 6` and `isAssociated()` with a configurable value (the real facade answers for
///         `msg.sender`). Verified 2026-11-05 on 296 (RT-C-08): the relay reports the facade's code as an EIP-7702
///         delegation designator to the HTS system contract (`0xef0100…0167`), whose code is `0xfe` (INVALID), so
///         Foundry cannot execute the real facade; the relay itself answers `decimals()` = 6 and `symbol()` = "USDC".
contract HtsTokenStub {
    bool internal immutable _associated;

    constructor(bool associated_) {
        _associated = associated_;
    }

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function isAssociated() external view returns (bool) {
        return _associated;
    }
}
