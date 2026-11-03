// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {Deploy} from "../../script/Deploy.s.sol";

/// @notice Fixture for deploy-script regressions: explicit `Deploy.Config` (never process env, tests run in parallel)
///         and scratch addresses files `deploy/addresses.test-reg-<tag>.json` (git-ignored, removed by each test).
abstract contract DeployRegressionBase is Test {
    Deploy internal script;
    address internal constant HTS_SYSTEM = 0x0000000000000000000000000000000000000167;
    address internal constant HEDERA_USDC_ALIAS = 0x0000000000000000000000000000000000068cDa;

    function setUp() public virtual {
        script = new Deploy();
    }

    function _config(bool ledgerOnly, address coldOwner, string memory tag)
        internal
        view
        returns (Deploy.Config memory)
    {
        return Deploy.Config({
            payout: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8,
            attestor: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,
            owner: coldOwner,
            ledgerOnly: ledgerOnly,
            addressesPath: string.concat(vm.projectRoot(), "/deploy/addresses.test-reg-", tag, ".json")
        });
    }

    /// Runs `deploy(chain, cfg)` through a call so a revert is observable; cleans up the file on success.
    function _deployReverts(Deploy.ChainRecord memory chain, Deploy.Config memory cfg)
        internal
        returns (bool reverted, bytes memory reason)
    {
        bool ok;
        (ok, reason) = address(script).call(abi.encodeCall(Deploy.deploy, (chain, cfg)));
        if (ok) vm.removeFile(cfg.addressesPath);
        reverted = !ok;
    }
}
