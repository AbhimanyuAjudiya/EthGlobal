// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DataDrop} from "../../src/DataDrop.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {HtsPrecompileMock} from "../mocks/HtsPrecompileMock.sol";
import {DeployRegressionBase} from "./DeployRegressionBase.sol";

/// @notice Red-team verification variant for RT-C-05: Hedera with OWNER_ADDRESS == the deployer (no hand-over) records
///         no phantom pending owner; and a Hedera LEDGER_ONLY deploy with a cold owner records the cold owner as owner.
contract Verify_RTC05Test is DeployRegressionBase {
    function test_Verify_RTC05_HederaSelfOwnedHasNoPendingOwner() public {
        vm.chainId(296);
        vm.etch(HTS_SYSTEM, type(HtsPrecompileMock).runtimeCode);
        Deploy.Config memory cfg = _config(false, address(0), "verify-hedera-self");
        Deploy.Result memory r = script.deploy(script.loadChain(296), cfg);
        string memory json = vm.readFile(cfg.addressesPath);
        vm.removeFile(cfg.addressesPath);
        DataDrop dd = DataDrop(r.dataDrop);
        assertEq(vm.parseJsonAddress(json, ".owner"), dd.owner());
        assertEq(vm.parseJsonAddress(json, ".pendingOwner"), address(0));
        assertEq(dd.pendingOwner(), address(0));
    }

    function test_Verify_RTC05_HederaLedgerOnlyColdOwnerIsOwner() public {
        vm.chainId(296);
        address cold = makeAddr("verify-cold");
        Deploy.Config memory cfg = _config(true, cold, "verify-hedera-ledger");
        Deploy.Result memory r = script.deploy(script.loadChain(296), cfg);
        string memory json = vm.readFile(cfg.addressesPath);
        vm.removeFile(cfg.addressesPath);
        DataDrop dd = DataDrop(r.dataDrop);
        assertTrue(dd.ledgerOnly());
        assertEq(dd.owner(), cold);
        assertEq(vm.parseJsonAddress(json, ".owner"), dd.owner());
        assertEq(vm.parseJsonAddress(json, ".pendingOwner"), dd.pendingOwner());
    }
}
