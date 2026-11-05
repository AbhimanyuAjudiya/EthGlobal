// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DataDrop} from "../../src/DataDrop.sol";
import {Deploy, DeployHedera} from "../../script/Deploy.s.sol";
import {DeployRegressionBase} from "./DeployRegressionBase.sol";

/// @notice RT-C-08 (T-09, T-08): on Hedera testnet the relay reports the HTS USDC facade `0x…068cDa` as an EIP-7702
///         delegation designator to the HTS system contract `0x…0167`, whose code is `0xfe` (INVALID). Foundry follows
///         the designator, so the audited `Deploy` cannot run its 296 token-mode branch locally; `DeployHedera` etches
///         stand-ins for the local run only. Explicit `Deploy.Config` throughout (never `vm.setEnv`: process env is
///         shared by every test running in parallel).
contract T09_HederaForgeSimulationTest is DeployRegressionBase {
    /// What `cast code` reports on 296 (2026-11-05): the 23-byte designator `0xef01 00 ‖ 0x…0167`, and INVALID at
    /// 0x…0167. `vm.etch` parses the `ef01` prefix as EIP-7702 bytecode, so calls to the facade run 0x…0167's code.
    bytes internal constant FACADE_CODE = hex"ef01000000000000000000000000000000000000000167";
    bytes internal constant HTS_CODE = hex"fe";

    function _liveHederaCode() internal {
        vm.chainId(296);
        vm.etch(HEDERA_USDC_ALIAS, FACADE_CODE);
        vm.etch(HTS_SYSTEM, HTS_CODE);
    }

    /// Documents the limitation: the audited script's local run dies on the facade's `decimals()` before any broadcast
    /// (and would die again on `associateToken` and `isAssociated()`), with no revert data.
    function test_Regression_RTC08_PlainDeployRevertsOnLiveHederaCode() public {
        _liveHederaCode();
        Deploy.Config memory cfg = _config(false, makeAddr("cold"), "rtc08-plain");
        (bool reverted, bytes memory reason) = _deployReverts(script.loadChain(296), cfg);
        assertTrue(reverted, "plain Deploy ran against the 0xfe designator");
        assertEq(reason.length, 0, "InvalidFEOpcode carries no revert data");
        assertFalse(vm.exists(cfg.addressesPath), "addresses file written despite revert");
    }

    /// The wrapper's path (what `forge script script/Deploy.s.sol:DeployHedera` runs) completes under the stand-ins
    /// and deploys the same DataDrop the audited script would: facade usdc, association recorded, two-step owner.
    function test_Regression_RTC08_DeployHederaRunsUnderStandIns() public {
        _liveHederaCode();
        DeployHedera hedera = new DeployHedera();
        address cold = makeAddr("cold");
        Deploy.Config memory cfg = _config(false, cold, "rtc08-hedera");
        Deploy.Result memory r = hedera.deploy(hedera.loadChain(296), cfg);
        DataDrop dd = DataDrop(r.dataDrop);
        assertEq(dd.usdc(), HEDERA_USDC_ALIAS);
        assertFalse(dd.ledgerOnly());
        assertTrue(dd.isHtsAssociated(HEDERA_USDC_ALIAS), "stand-in facade should not deny the association");
        assertEq(dd.owner(), r.deployer);
        assertEq(dd.pendingOwner(), cold);
        assertEq(r.pendingOwner, cold);
        vm.removeFile(cfg.addressesPath);
    }

    /// The stand-ins must never reach a non-Hedera chain: the wrapper refuses before any etch, broadcast or file write.
    function test_Regression_RTC08_DeployHederaRefusesOtherChains() public {
        vm.chainId(84_532);
        DeployHedera hedera = new DeployHedera();
        Deploy.Config memory cfg = _config(false, makeAddr("cold"), "rtc08-base");
        (bool ok, bytes memory reason) =
            address(hedera).call(abi.encodeCall(Deploy.deploy, (hedera.loadChain(84_532), cfg)));
        assertFalse(ok);
        assertEq(
            reason,
            abi.encodeWithSignature(
                "Error(string)", "DeployHedera is for Hedera (295/296) only; the RPC reports chain 84532"
            )
        );
        assertEq(HTS_SYSTEM.code.length, 0, "stand-in etched on a non-Hedera chain");
        assertFalse(vm.exists(cfg.addressesPath));
    }
}
