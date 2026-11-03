// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {DataDrop} from "../src/DataDrop.sol";
import {MockUSDC3009} from "../src/MockUSDC3009.sol";

/// @title Deploy
/// @notice Chain-agnostic deploy entrypoint. `CHAIN` (a chain id, default 31337) selects the target; the run
///         aborts if the connected RPC reports a different id, then resolves the chain's record from
///         deploy/chains.json.
///
///         Anvil (31337): deploys `MockUSDC3009` and `DataDrop(mock, payout, attestor, owner)`, mints 1 000 000 USDC
///         to Anvil accounts #0–#8 (#8 = treasury, A-31). Live chains: deploys `DataDrop` only, with `usdc` from chains.json — or
///         `address(0)` (LEDGER_ONLY) when `LEDGER_ONLY=true`; a chain without a `usdc` entry refuses to deploy unless
///         LEDGER_ONLY is explicit. On Hedera (295/296) in token mode the script calls `associateHts(usdc)` in the
///         same broadcast. Writes deploy/addresses.<slug>.json (INTERFACES §6.3); `script/fill-deploy-txs.mjs` then
///         copies the transaction hashes from broadcast/ into its `txs` object.
///
///         Env: PAYOUT_ADDRESS, ATTESTOR_ADDRESS, OWNER_ADDRESS (defaults on 31337: Anvil #1, #2, deployer; required
///         elsewhere), LEDGER_ONLY (default false), ANVIL_MNEMONIC (default Anvil's). No private key lives here.
///
///         CHAIN=31337 forge script script/Deploy.s.sol:Deploy --rpc-url anvil --broadcast \
///             --private-key $DEPLOYER_PRIVATE_KEY
contract Deploy is Script {
    /// @dev Field order stays alphabetical (stdJson's sorted-key convention) although `loadChain` reads each key by
    ///      name; every chain entry must carry every key (empty string when unknown), or `loadChain` reverts.
    struct ChainRecord {
        string explorer;
        string gasToken;
        string name;
        string rpcEnv;
        string slug;
        string usdc;
        string usdcHts;
    }

    /// @notice Resolved deployment parameters (env → struct, so tests can call `deploy` without touching env).
    struct Config {
        address payout;
        address attestor;
        address owner; // address(0) ⇒ the broadcasting deployer
        bool ledgerOnly;
        string addressesPath; // "" ⇒ deploy/addresses.<slug>.json
    }

    /// @notice What was deployed.
    struct Result {
        address dataDrop;
        address usdc;
        address deployer;
        address owner;
        bool ledgerOnly;
        string addressesPath;
    }

    uint256 internal constant DEFAULT_CHAIN = 31_337;
    uint256 internal constant ANVIL = 31_337;
    /// @dev 1 000 000 USDC in 6-decimal base units.
    uint256 internal constant ANVIL_MINT = 1_000_000e6;
    /// @dev #0–#7 per the brief plus #8 = `anvilRoles.treasury` (INTERFACES A-31: the local gift-refund wallet needs USDC).
    uint32 internal constant ANVIL_FUNDED_ACCOUNTS = 9;
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
    address internal constant ANVIL_PAYOUT = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // Anvil #1 (public)
    address internal constant ANVIL_ATTESTOR = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; // Anvil #2 (public)

    /// @notice When set, `run()` writes the addresses file here instead of deploy/addresses.<slug>.json. Per script
    ///         instance (not env), so parallel tests never overwrite a dev chain's addresses.anvil.json.
    string public addressesPathOverride;

    /// @notice Test hook: redirect `run()`'s addresses file.
    /// @param path Absolute path under ./deploy.
    function setAddressesPathOverride(string calldata path) external {
        addressesPathOverride = path;
    }

    /// @notice deploy/addresses.<slug>.json under the project root.
    /// @param slug Chain slug from chains.json.
    /// @return Absolute path.
    function defaultAddressesPath(string memory slug) public view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deploy/addresses.", slug, ".json");
    }

    /// @notice Entry point for `forge script`.
    /// @return result The deployed addresses.
    function run() public returns (Result memory result) {
        uint256 chainId = vm.envOr("CHAIN", DEFAULT_CHAIN);
        require(
            block.chainid == chainId,
            string.concat("CHAIN=", vm.toString(chainId), " but the RPC reports chain ", vm.toString(block.chainid))
        );
        ChainRecord memory chain = loadChain(chainId);
        console.log("Deploying to %s (chain %s, gas in %s)", chain.name, chainId, chain.gasToken);
        Config memory cfg = loadConfig(chainId);
        cfg.addressesPath = addressesPathOverride;
        return deploy(chain, cfg);
    }

    /// @notice Reads one chain's record from deploy/chains.json; reverts when the id is unknown.
    /// @param chainId Chain id key.
    /// @return The record.
    function loadChain(uint256 chainId) public view returns (ChainRecord memory) {
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/deploy/chains.json"));
        string memory key = string.concat(".", vm.toString(chainId));
        require(
            vm.keyExistsJson(json, key),
            string.concat("deploy/chains.json has no entry for chain ", vm.toString(chainId))
        );
        // Field by field, not `abi.decode(vm.parseJson(json, key), (ChainRecord))`: stdJson infers "0x…" strings of
        // 20 bytes as `address`, which would silently break the tuple decode for chains that list a `usdc` address.
        return ChainRecord({
            explorer: vm.parseJsonString(json, string.concat(key, ".explorer")),
            gasToken: vm.parseJsonString(json, string.concat(key, ".gasToken")),
            name: vm.parseJsonString(json, string.concat(key, ".name")),
            rpcEnv: vm.parseJsonString(json, string.concat(key, ".rpcEnv")),
            slug: vm.parseJsonString(json, string.concat(key, ".slug")),
            usdc: vm.parseJsonString(json, string.concat(key, ".usdc")),
            usdcHts: vm.parseJsonString(json, string.concat(key, ".usdcHts"))
        });
    }

    /// @notice Role addresses and mode from env (Anvil defaults on 31337 only).
    /// @param chainId Target chain.
    /// @return cfg The config.
    function loadConfig(uint256 chainId) public view returns (Config memory cfg) {
        if (chainId == ANVIL) {
            cfg.payout = vm.envOr("PAYOUT_ADDRESS", ANVIL_PAYOUT);
            cfg.attestor = vm.envOr("ATTESTOR_ADDRESS", ANVIL_ATTESTOR);
            cfg.owner = vm.envOr("OWNER_ADDRESS", address(0));
        } else {
            cfg.payout = vm.envAddress("PAYOUT_ADDRESS");
            cfg.attestor = vm.envAddress("ATTESTOR_ADDRESS");
            cfg.owner = vm.envAddress("OWNER_ADDRESS");
        }
        cfg.ledgerOnly = vm.envOr("LEDGER_ONLY", false);
    }

    /// @notice Deploys for `block.chainid` with an explicit config and writes the addresses file.
    /// @param chain The chain's record from chains.json.
    /// @param cfg Roles and mode.
    /// @return result The deployed addresses.
    function deploy(ChainRecord memory chain, Config memory cfg) public returns (Result memory result) {
        bool anvil = block.chainid == ANVIL;
        bool hedera = block.chainid == 295 || block.chainid == 296;
        address usdc;
        if (!anvil && !cfg.ledgerOnly) {
            require(
                bytes(chain.usdc).length != 0,
                string.concat("deploy/chains.json lists no usdc for ", chain.slug, "; set LEDGER_ONLY=true explicitly")
            );
            usdc = vm.parseAddress(chain.usdc);
        }

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        address owner = cfg.owner == address(0) ? deployer : cfg.owner;
        DataDrop dataDrop;
        if (anvil) {
            MockUSDC3009 mock = new MockUSDC3009();
            usdc = address(mock);
            dataDrop = new DataDrop(IERC20(usdc), cfg.payout, cfg.attestor, owner);
            string memory mnemonic = vm.envOr("ANVIL_MNEMONIC", ANVIL_MNEMONIC);
            for (uint32 i = 0; i < ANVIL_FUNDED_ACCOUNTS; i++) {
                // derives a *public* Anvil account address from the public test mnemonic; no key is used to sign
                // forge-lint: disable-next-line(unsafe-cheatcode)
                mock.mint(vm.addr(vm.deriveKey(mnemonic, i)), ANVIL_MINT);
            }
        } else if (hedera && usdc != address(0)) {
            // associateHts is onlyOwner: deploy owned by the broadcaster, associate, then hand over (2-step).
            dataDrop = new DataDrop(IERC20(usdc), cfg.payout, cfg.attestor, deployer);
            dataDrop.associateHts(usdc);
            if (owner != deployer) dataDrop.transferOwnership(owner); // OWNER_ADDRESS must call acceptOwnership()
        } else {
            dataDrop = new DataDrop(IERC20(usdc), cfg.payout, cfg.attestor, owner);
        }
        vm.stopBroadcast();

        require(dataDrop.ledgerOnly() == (usdc == address(0)), "DataDrop mode differs from the intended mode");
        require(dataDrop.usdc() == usdc, "DataDrop usdc mismatch");

        result = Result({
            dataDrop: address(dataDrop),
            usdc: usdc,
            deployer: deployer,
            owner: owner,
            ledgerOnly: usdc == address(0),
            addressesPath: bytes(cfg.addressesPath).length != 0 ? cfg.addressesPath : defaultAddressesPath(chain.slug)
        });
        _writeAddresses(chain, cfg, result);
        console.log("DataDrop  %s (ledgerOnly=%s)", result.dataDrop, result.ledgerOnly);
        console.log("USDC      %s", result.usdc);
        console.log("addresses %s", result.addressesPath);
    }

    /// @dev Hand-assembled so the key order is exactly INTERFACES §6.3 (stdJson serialisation does not promise it).
    ///      `txs` stays empty here (a script cannot see its own tx hashes); `script/fill-deploy-txs.mjs` fills it.
    function _writeAddresses(ChainRecord memory chain, Config memory cfg, Result memory r) internal {
        string memory q = '"';
        string memory json = string.concat(
            "{\n",
            '  "chainId": ',
            vm.toString(block.chainid),
            ",\n",
            '  "network": "eip155:',
            vm.toString(block.chainid),
            '",\n',
            '  "ledgerOnly": ',
            r.ledgerOnly ? "true" : "false",
            ",\n",
            string.concat('  "dataDrop": ', q, vm.toString(r.dataDrop), q, ",\n"),
            string.concat('  "usdc": ', q, vm.toString(r.usdc), q, ",\n"),
            string.concat('  "usdcHts": ', q, chain.usdcHts, q, ",\n")
        );
        json = string.concat(
            json,
            string.concat('  "payout": ', q, vm.toString(cfg.payout), q, ",\n"),
            string.concat('  "attestor": ', q, vm.toString(cfg.attestor), q, ",\n"),
            string.concat('  "owner": ', q, vm.toString(r.owner), q, ",\n"),
            string.concat('  "deployer": ', q, vm.toString(r.deployer), q, ",\n"),
            string.concat('  "deployedAt": ', vm.toString(block.timestamp), ",\n"),
            '  "txs": { "dataDrop": "", "usdc": "" }\n',
            "}\n"
        );
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.writeFile(r.addressesPath, json);
    }
}
