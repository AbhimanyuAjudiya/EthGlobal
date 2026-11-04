// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Deploy} from "../../script/Deploy.s.sol";
import {DeployRegressionBase} from "./DeployRegressionBase.sol";

/// A contract that has code but no decimals() (e.g. a proxy admin / multisig pasted by mistake).
contract VerifyNoDecimals {
    fallback() external {
        revert();
    }
}

/// A token whose decimals() returns a 256-bit word that is not a valid uint8 (6 in the low byte, junk above).
contract VerifyDirtyDecimals {
    fallback() external {
        assembly {
            mstore(0, or(shl(8, 1), 6))
            return(0, 32)
        }
    }
}

/// @notice Red-team verification variant for RT-C-04: a code-bearing `usdc` that has no `decimals()` or answers a dirty
///         word whose low byte is 6 must not be baked into the immutable.
contract Verify_RTC04Test is DeployRegressionBase {
    function test_Verify_RTC04_ContractWithoutDecimalsRejected() public {
        vm.chainId(84_532);
        Deploy.ChainRecord memory chain = script.loadChain(84_532);
        chain.usdc = vm.toString(address(new VerifyNoDecimals()));
        (bool reverted,) = _deployReverts(chain, _config(false, makeAddr("cold"), "verify-nodec"));
        assertTrue(reverted, "deployed against a contract without decimals()");
    }

    function test_Verify_RTC04_DirtyDecimalsWordRejected() public {
        vm.chainId(84_532);
        Deploy.ChainRecord memory chain = script.loadChain(84_532);
        chain.usdc = vm.toString(address(new VerifyDirtyDecimals()));
        (bool reverted,) = _deployReverts(chain, _config(false, makeAddr("cold"), "verify-dirtydec"));
        assertTrue(reverted, "deployed against a token whose decimals() word is 0x106");
    }
}
