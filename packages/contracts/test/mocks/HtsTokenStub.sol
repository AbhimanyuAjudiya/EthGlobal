// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title HtsTokenStub — stands in for the HIP-719 facade of HTS USDC at its long-zero address in deploy tests.
/// @notice Answers `decimals() == 6` and `isAssociated()` with a configurable value (the real facade answers for
///         `msg.sender`) [verify Wed].
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
