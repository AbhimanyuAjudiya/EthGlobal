// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title FalseReturnToken — `transferFrom` returns false without moving funds (an HTS-facade-style failure, T-09).
contract FalseReturnToken is ERC20 {
    constructor() ERC20("False USD", "FUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}

/// @title LyingToken — `transferFrom` returns true but moves nothing (silent no-op facade, T-09).
contract LyingToken is ERC20 {
    constructor() ERC20("Lying USD", "LUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return true;
    }
}
