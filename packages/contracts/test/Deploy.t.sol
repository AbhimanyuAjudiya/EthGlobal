// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {Deploy} from "../script/Deploy.s.sol";

/// @notice Guards the deploy skeleton and deploy/chains.json; product contracts get their own test files.
contract DeployTest is Test {
    Deploy internal deploy;

    function setUp() public {
        deploy = new Deploy();
    }

    function test_RunsAgainstTheDefaultChain() public {
        // forge's default block.chainid is 31337, matching the CHAIN default.
        deploy.run();
    }

    function test_LoadsTheAnvilRecord() public view {
        Deploy.ChainRecord memory chain = deploy.loadChain(31_337);
        assertEq(chain.name, "Anvil");
        assertEq(chain.slug, "anvil");
        assertEq(chain.rpcEnv, "ANVIL_RPC_URL");
        assertEq(chain.gasToken, "ETH");
    }

    function test_EveryConfiguredChainDecodes() public view {
        uint256[8] memory ids = [uint256(31_337), 1301, 5_042_002, 16_602, 296, 4801, 1874, 84_532];
        for (uint256 i = 0; i < ids.length; i++) {
            Deploy.ChainRecord memory chain = deploy.loadChain(ids[i]);
            assertGt(bytes(chain.name).length, 0);
            assertGt(bytes(chain.rpcEnv).length, 0);
            assertGt(bytes(chain.slug).length, 0);
        }
    }

    function test_RevertsWhenRpcChainDiffersFromCHAIN() public {
        vm.chainId(1301);
        vm.expectRevert(bytes("CHAIN=31337 but the RPC reports chain 1301"));
        deploy.run();
    }

    function test_RevertsForUnknownChain() public {
        vm.expectRevert(bytes("deploy/chains.json has no entry for chain 999"));
        deploy.loadChain(999);
    }
}
