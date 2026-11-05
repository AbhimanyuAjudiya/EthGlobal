// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";

/// @notice `deployCodeTo` without an artefact lookup: runs `creation` (creation code ‖ abi-encoded args) as the
///         constructor AT `at` — so storage, immutables and `address(this)` are those of `at` — then installs the
///         returned runtime code there. Used to put a token at a recorded live address (Base Sepolia USDC, HTS USDC).
library InstallAt {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function install(address at, bytes memory creation) internal {
        VM.etch(at, creation);
        (bool ok, bytes memory runtime) = at.call("");
        require(ok, "InstallAt: constructor reverted");
        VM.etch(at, runtime);
    }
}
