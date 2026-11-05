// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DataDrop} from "../../src/DataDrop.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {HtsPrecompileMock} from "../mocks/HtsPrecompileMock.sol";
import {DeployRegressionBase} from "./DeployRegressionBase.sol";

/// @notice T-10 / RT-C-05: deploy/addresses.<slug>.json records the ACTUAL on-chain owner and the pending cold owner
///         (until `acceptOwnership()`), so nobody is told the cold key controls `setAttestor` before it does.
contract T10_DeployOwnerRecordTest is DeployRegressionBase {
    /// RT-C-05 (was test_RT_HederaAddressesFileOwnerMatchesChain_RTFINDING).
    function test_Regression_RTC05_HederaAddressesFileOwnerMatchesChain() public {
        vm.chainId(296);
        vm.etch(HTS_SYSTEM, type(HtsPrecompileMock).runtimeCode);
        address cold = makeAddr("cold-owner");
        Deploy.Config memory cfg = _config(false, cold, "hedera-owner");
        Deploy.Result memory r = script.deploy(script.loadChain(296), cfg);
        string memory json = vm.readFile(cfg.addressesPath);
        vm.removeFile(cfg.addressesPath);
        DataDrop dd = DataDrop(r.dataDrop);
        assertEq(vm.parseJsonAddress(json, ".owner"), dd.owner(), "file owner != chain owner");
        assertEq(vm.parseJsonAddress(json, ".pendingOwner"), dd.pendingOwner());
        assertEq(dd.owner(), r.deployer); // hot key until the cold owner accepts …
        assertEq(dd.pendingOwner(), cold); // … and the file says who must accept
    }

    function test_NoPendingOwnerWhenOwnedDirectly() public {
        vm.chainId(84_532);
        Deploy.Config memory cfg = _config(true, makeAddr("cold-direct"), "direct");
        Deploy.Result memory r = script.deploy(script.loadChain(84_532), cfg);
        string memory json = vm.readFile(cfg.addressesPath);
        vm.removeFile(cfg.addressesPath);
        assertEq(vm.parseJsonAddress(json, ".owner"), cfg.owner);
        assertEq(vm.parseJsonAddress(json, ".pendingOwner"), address(0));
        assertEq(r.pendingOwner, address(0));
    }
}
