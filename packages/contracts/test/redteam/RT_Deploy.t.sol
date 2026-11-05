// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {DataDrop} from "../../src/DataDrop.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {HtsPrecompileMock} from "../mocks/HtsPrecompileMock.sol";
import {RT_EighteenDecToken} from "./mocks/RT_Tokens.sol";

/// @notice Red-team attacks on script/Deploy.s.sol (A19 and beyond). Writes only deploy/addresses.test-rt-*.json
///         (git-ignored) and removes them. Never touches process env (tests run in parallel with the builder's).
contract RT_DeployTest is Test {
    Deploy internal deploy;
    address internal constant HTS = 0x0000000000000000000000000000000000000167;
    address internal constant PAYOUT = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant ATTESTOR = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    function setUp() public {
        deploy = new Deploy();
    }

    function _path(string memory tag) internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deploy/addresses.test-rt-", tag, ".json");
    }

    function _cfg(bool lo, address owner_, string memory tag) internal view returns (Deploy.Config memory) {
        return
            Deploy.Config({
                payout: PAYOUT, attestor: ATTESTOR, owner: owner_, ledgerOnly: lo, addressesPath: _path(tag)
            });
    }

    function _indexOf(string memory hay, string memory needle) internal pure returns (uint256) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        for (uint256 i = 0; i + n.length <= h.length; i++) {
            bool m = true;
            for (uint256 j = 0; j < n.length && m; j++) {
                if (h[i + j] != n[j]) m = false;
            }
            if (m) return i;
        }
        return type(uint256).max;
    }

    // test_RT_HederaAddressesFileOwnerMatchesChain_RTFINDING moved to test/regression/T10_DeployOwnerRecord.t.sol after the fix (fixed finding, now a passing regression).

    // test_RT_DeployRejectsUsdcWithoutCode_RTFINDING moved to test/regression/T08_Decimals.t.sol after the fix (fixed finding, now a passing regression).

    // test_RT_DeployRejectsEighteenDecimalUsdc_RTFINDING moved to test/regression/T08_Decimals.t.sol after the fix (fixed finding, now a passing regression).

    /// Property: the Hedera addresses file keeps the INTERFACES §6.3 key order (not only the Anvil one).
    function test_RT_HederaAddressesKeyOrder() public {
        vm.chainId(296);
        vm.etch(HTS, type(HtsPrecompileMock).runtimeCode);
        Deploy.Config memory cfg = _cfg(true, makeAddr("rt-cold"), "hedera-order");
        deploy.deploy(deploy.loadChain(296), cfg);
        string memory json = vm.readFile(cfg.addressesPath);
        string[12] memory order = [
            '"chainId"',
            '"network"',
            '"ledgerOnly"',
            '"dataDrop"',
            '"usdc"',
            '"usdcHts"',
            '"payout"',
            '"attestor"',
            '"owner"',
            '"deployer"',
            '"deployedAt"',
            '"txs"'
        ];
        for (uint256 i = 1; i < order.length; i++) {
            assertLt(_indexOf(json, order[i - 1]), _indexOf(json, order[i]), order[i]);
        }
        assertTrue(vm.parseJsonBool(json, ".ledgerOnly"));
        vm.removeFile(cfg.addressesPath);
    }

    /// Property: LEDGER_ONLY is ignored on Anvil — a dev cannot accidentally produce an unfunded local deployment, and
    ///           the addresses file says ledgerOnly=false with the mock's address.
    function test_RT_LedgerOnlyIgnoredOnAnvil() public {
        Deploy.Config memory cfg = _cfg(true, address(0), "anvil-lo");
        Deploy.Result memory r = deploy.deploy(deploy.loadChain(31_337), cfg);
        assertFalse(DataDrop(r.dataDrop).ledgerOnly());
        string memory json = vm.readFile(cfg.addressesPath);
        assertFalse(vm.parseJsonBool(json, ".ledgerOnly"));
        assertEq(vm.parseJsonAddress(json, ".usdc"), r.usdc);
        vm.removeFile(cfg.addressesPath);
    }

    /// Property: LEDGER_ONLY on a chain that HAS a usdc (Base Sepolia) yields a DataDrop that says so on-chain and in
    ///           the file — the mode is never silently different from what readers see.
    function test_RT_LedgerOnlyOnUsdcChainIsVisible() public {
        vm.chainId(84_532);
        Deploy.Config memory cfg = _cfg(true, makeAddr("rt-cold"), "base-lo");
        Deploy.Result memory r = deploy.deploy(deploy.loadChain(84_532), cfg);
        assertTrue(DataDrop(r.dataDrop).ledgerOnly());
        assertEq(DataDrop(r.dataDrop).usdc(), address(0));
        string memory json = vm.readFile(cfg.addressesPath);
        assertTrue(vm.parseJsonBool(json, ".ledgerOnly"));
        assertEq(vm.parseJsonAddress(json, ".usdc"), address(0));
        vm.removeFile(cfg.addressesPath);
    }

    /// Property: Hedera with OWNER_ADDRESS == deployer leaves no dangling pending owner.
    function test_RT_HederaOwnerIsDeployerNoPending() public {
        vm.chainId(296);
        vm.etch(HTS, type(HtsPrecompileMock).runtimeCode);
        Deploy.Config memory cfg = _cfg(false, address(0), "hedera-self");
        Deploy.Result memory r = deploy.deploy(deploy.loadChain(296), cfg);
        assertEq(DataDrop(r.dataDrop).owner(), r.deployer);
        assertEq(DataDrop(r.dataDrop).pendingOwner(), address(0));
        vm.removeFile(cfg.addressesPath);
    }

    /// Property: a LEDGER_ONLY env value is parsed fail-closed — anything other than a recognised boolean reverts
    ///           (forge's bool parser), so a typo can never silently flip the mode.
    function test_RT_LedgerOnlyEnvParsingFailsClosed() public {
        string[4] memory bad = ["yes", "on", "enabled", "tru"];
        for (uint256 i = 0; i < bad.length; i++) {
            try vm.parseBool(bad[i]) returns (bool) {
                fail();
            } catch {}
        }
        assertTrue(vm.parseBool("true"));
        assertFalse(vm.parseBool("false"));
    }

    /// Property (closes the untested branch Deploy.s.sol:134-137): a live chain refuses to load a config without
    ///           explicit role env vars (no Anvil defaults leak to live chains).
    function test_RT_LiveChainRequiresRoleEnv() public {
        if (vm.envOr("PAYOUT_ADDRESS", address(0)) != address(0)) return; // a dev shell exported it; nothing to prove
        vm.expectRevert();
        deploy.loadConfig(84_532);
    }
}
