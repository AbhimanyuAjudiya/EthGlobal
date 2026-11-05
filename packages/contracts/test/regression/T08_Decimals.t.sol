// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Deploy} from "../../script/Deploy.s.sol";
import {DataDrop} from "../../src/DataDrop.sol";
import {MockUSDC3009} from "../../src/MockUSDC3009.sol";
import {RT_EighteenDecToken} from "../redteam/mocks/RT_Tokens.sol";
import {HtsPrecompileMock} from "../mocks/HtsPrecompileMock.sol";
import {InstallAt} from "../utils/InstallAt.sol";
import {DeployRegressionBase} from "./DeployRegressionBase.sol";

/// @notice T-08 (decimals) / RT-C-04: the deploy script refuses to bake a live `usdc` without code or with
///         decimals() != 6 into DataDrop's immutable. Hedera tolerates a codeless HTS alias (extcodesize of HTS tokens is
///         [verify Wed]) but still rejects a contract that answers the wrong decimals.
contract T08_DecimalsTest is DeployRegressionBase {
    /// RT-C-04 (was test_RT_DeployRejectsUsdcWithoutCode_RTFINDING).
    function test_Regression_RTC04_DeployRejectsUsdcWithoutCode() public {
        vm.chainId(84_532);
        Deploy.ChainRecord memory chain = script.loadChain(84_532);
        address typo = makeAddr("typo-eoa");
        chain.usdc = vm.toString(typo);
        (bool reverted, bytes memory reason) = _deployReverts(chain, _config(false, makeAddr("cold"), "nocode"));
        assertTrue(reverted, "DataDrop deployed with an immutable usdc that has no code");
        assertEq(
            reason,
            abi.encodeWithSignature(
                "Error(string)", string.concat("usdc ", vm.toString(typo), " has no code on this chain")
            )
        );
    }

    /// RT-C-04 (was test_RT_DeployRejectsEighteenDecimalUsdc_RTFINDING).
    function test_Regression_RTC04_DeployRejectsEighteenDecimalUsdc() public {
        vm.chainId(84_532);
        RT_EighteenDecToken dai = new RT_EighteenDecToken();
        Deploy.ChainRecord memory chain = script.loadChain(84_532);
        chain.usdc = vm.toString(address(dai));
        (bool reverted,) = _deployReverts(chain, _config(false, makeAddr("cold"), "18dec"));
        assertTrue(reverted, "DataDrop deployed with an 18-decimal immutable usdc");
    }

    function test_HederaRejectsEighteenDecimalContractAtTheUsdcAlias() public {
        vm.chainId(296);
        vm.etch(HTS_SYSTEM, type(HtsPrecompileMock).runtimeCode);
        InstallAt.install(HEDERA_USDC_ALIAS, type(RT_EighteenDecToken).creationCode);
        (bool reverted,) = _deployReverts(script.loadChain(296), _config(false, address(0), "hedera-18"));
        assertTrue(reverted);
    }

    function test_SixDecimalUsdcIsAccepted() public {
        vm.chainId(84_532);
        MockUSDC3009 six = new MockUSDC3009();
        Deploy.ChainRecord memory chain = script.loadChain(84_532);
        chain.usdc = vm.toString(address(six));
        Deploy.Config memory cfg = _config(false, makeAddr("cold"), "six");
        Deploy.Result memory r = script.deploy(chain, cfg);
        assertEq(DataDrop(r.dataDrop).usdc(), address(six));
        assertEq(six.decimals(), 6);
        vm.removeFile(cfg.addressesPath);
    }
}
