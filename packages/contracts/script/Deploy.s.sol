// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

/// @title Deploy
/// @notice Chain-agnostic deploy entrypoint. `CHAIN` (a chain id, default 31337) selects the target; the run
///         aborts if the connected RPC reports a different id, then resolves the chain's record from
///         deploy/chains.json. Contract deployments belong between startBroadcast and stopBroadcast.
///
///         CHAIN=31337 forge script script/Deploy.s.sol:Deploy --rpc-url anvil --broadcast \
///             --private-key $DEPLOYER_PRIVATE_KEY
contract Deploy is Script {
    /// @dev Field order must stay alphabetical: stdJson decodes object keys in sorted order.
    struct ChainRecord {
        string explorer;
        string gasToken;
        string name;
        string rpcEnv;
        string slug;
    }

    uint256 internal constant DEFAULT_CHAIN = 31_337;

    function run() public {
        uint256 chainId = vm.envOr("CHAIN", DEFAULT_CHAIN);
        require(
            block.chainid == chainId,
            string.concat("CHAIN=", vm.toString(chainId), " but the RPC reports chain ", vm.toString(block.chainid))
        );
        ChainRecord memory chain = loadChain(chainId);
        console.log("Deploying to %s (chain %s, gas in %s)", chain.name, chainId, chain.gasToken);

        vm.startBroadcast();
        // Deployments go here.
        vm.stopBroadcast();
    }

    /// @notice Reads one chain's record from deploy/chains.json; reverts when the id is unknown.
    function loadChain(uint256 chainId) public view returns (ChainRecord memory) {
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/deploy/chains.json"));
        string memory key = string.concat(".", vm.toString(chainId));
        require(
            vm.keyExistsJson(json, key),
            string.concat("deploy/chains.json has no entry for chain ", vm.toString(chainId))
        );
        return abi.decode(vm.parseJson(json, key), (ChainRecord));
    }
}
