// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {DataDrop} from "../src/DataDrop.sol";
import {MockUSDC3009} from "../src/MockUSDC3009.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {HtsPrecompileMock} from "./mocks/HtsPrecompileMock.sol";

/// @notice Guards the deploy script and deploy/chains.json (brief §6 Deploy.t.sol, wave1-contracts.md A19).
/// @dev No test writes deploy/addresses.anvil.json: every test writes a unique deploy/addresses.test-*.json
///      (git-ignored) and deletes it, so parallel tests never race and a running dev chain's file is never clobbered.
contract DeployTest is Test {
    Deploy internal deploy;
    address internal constant HTS = 0x0000000000000000000000000000000000000167;
    address internal constant PAYOUT = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant ATTESTOR = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address internal constant SPONSOR = 0x90F79bf6EB2c4f870365E785982E1f101E93b906; // Anvil #3
    address internal constant HEDERA_USDC = 0x0000000000000000000000000000000000068cDa; // 0.0.429274
    address internal constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function setUp() public {
        deploy = new Deploy();
    }

    function _path(string memory tag) internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deploy/addresses.test-", tag, ".json");
    }

    function _cfg(bool ledgerOnly, string memory tag) internal returns (Deploy.Config memory) {
        return Deploy.Config({
            payout: PAYOUT,
            attestor: ATTESTOR,
            owner: makeAddr("cold-owner"),
            ledgerOnly: ledgerOnly,
            addressesPath: _path(tag)
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

    function test_RunsAgainstTheDefaultChain() public {
        // forge's default block.chainid is 31337, matching the CHAIN default. The run writes to a scratch file so a
        // `forge test` never clobbers the addresses.anvil.json of a running `pnpm dev:chain`.
        assertEq(deploy.defaultAddressesPath("anvil"), string.concat(vm.projectRoot(), "/deploy/addresses.anvil.json"));
        deploy.setAddressesPathOverride(_path("anvil-run"));
        Deploy.Result memory r = deploy.run();
        DataDrop dd = DataDrop(r.dataDrop);
        MockUSDC3009 usdc = MockUSDC3009(r.usdc);
        assertFalse(dd.ledgerOnly());
        assertEq(dd.usdc(), r.usdc);
        assertEq(dd.payout(), PAYOUT);
        assertEq(dd.attestor(), ATTESTOR);
        assertEq(dd.owner(), r.deployer);
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.name(), "USD Coin");
        assertEq(usdc.balanceOf(SPONSOR), 1_000_000e6);
        assertEq(usdc.balanceOf(0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266), 1_000_000e6); // #0
        assertEq(usdc.balanceOf(0x14dC79964da2C08b23698B3D3cc7Ca32193d9955), 1_000_000e6); // #7
        assertEq(usdc.balanceOf(0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f), 1_000_000e6); // #8 treasury (A-31)
        assertEq(usdc.balanceOf(0xa0Ee7A142d267C1f36714E4a8F75612F20a79720), 0); // #9 is not funded
        assertEq(usdc.totalSupply(), 9 * 1_000_000e6);

        // the addresses file: INTERFACES §6.3 shape, field order
        assertEq(r.addressesPath, _path("anvil-run"));
        string memory json = vm.readFile(r.addressesPath);
        assertEq(vm.parseJsonUint(json, ".chainId"), 31_337);
        assertEq(vm.parseJsonString(json, ".network"), "eip155:31337");
        assertFalse(vm.parseJsonBool(json, ".ledgerOnly"));
        assertEq(vm.parseJsonAddress(json, ".dataDrop"), r.dataDrop);
        assertEq(vm.parseJsonAddress(json, ".usdc"), r.usdc);
        assertEq(vm.parseJsonString(json, ".usdcHts"), "");
        assertEq(vm.parseJsonAddress(json, ".payout"), PAYOUT);
        assertEq(vm.parseJsonAddress(json, ".attestor"), ATTESTOR);
        assertEq(vm.parseJsonAddress(json, ".owner"), r.deployer);
        assertEq(vm.parseJsonAddress(json, ".deployer"), r.deployer);
        assertEq(vm.parseJsonUint(json, ".deployedAt"), block.timestamp);
        assertTrue(vm.keyExistsJson(json, ".txs.dataDrop"));
        assertTrue(vm.keyExistsJson(json, ".txs.usdc"));
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
        vm.removeFile(r.addressesPath);
    }

    function test_AnvilBudgetMovesWithBalanceDelta() public {
        Deploy.Config memory cfg = deploy.loadConfig(31_337);
        cfg.addressesPath = _path("anvil-delta");
        Deploy.Result memory r = deploy.deploy(deploy.loadChain(31_337), cfg);
        MockUSDC3009 usdc = MockUSDC3009(r.usdc);
        DataDrop dd = DataDrop(r.dataDrop);
        uint128 budget = 500_000_000; // $500
        vm.startPrank(SPONSOR);
        usdc.approve(address(dd), budget);
        uint256 before = usdc.balanceOf(address(dd));
        dd.createCampaign(keccak256("delta"), budget, 500_000, 100, uint64(block.timestamp + 1 days));
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(dd)) - before, budget);
        vm.removeFile(cfg.addressesPath);
    }

    function test_LoadsTheAnvilRecord() public view {
        Deploy.ChainRecord memory chain = deploy.loadChain(31_337);
        assertEq(chain.name, "Anvil");
        assertEq(chain.slug, "anvil");
        assertEq(chain.rpcEnv, "ANVIL_RPC_URL");
        assertEq(chain.gasToken, "ETH");
        assertEq(chain.usdc, "");
        assertEq(chain.usdcHts, "");
    }

    function test_EveryConfiguredChainDecodes() public view {
        uint256[8] memory ids = [uint256(31_337), 1301, 5_042_002, 16_602, 296, 4801, 1874, 84_532];
        for (uint256 i = 0; i < ids.length; i++) {
            Deploy.ChainRecord memory chain = deploy.loadChain(ids[i]);
            assertGt(bytes(chain.name).length, 0);
            assertGt(bytes(chain.rpcEnv).length, 0);
            assertGt(bytes(chain.slug).length, 0);
            assertGt(bytes(chain.gasToken).length, 0);
            if (bytes(chain.usdc).length != 0) vm.parseAddress(chain.usdc); // a well-formed address when present
        }
        Deploy.ChainRecord memory hedera = deploy.loadChain(296);
        assertEq(hedera.slug, "hedera_testnet");
        assertEq(hedera.gasToken, "HBAR");
        assertEq(vm.parseAddress(hedera.usdc), HEDERA_USDC);
        assertEq(uint160(HEDERA_USDC), 429_274); // long-zero form of 0.0.429274
        assertEq(hedera.usdcHts, "0.0.429274");
        Deploy.ChainRecord memory base = deploy.loadChain(84_532);
        assertEq(vm.parseAddress(base.usdc), BASE_SEPOLIA_USDC);
        assertEq(base.usdcHts, "");
    }

    function test_HederaLedgerOnlyDeploysDataDropWithZeroUsdc() public {
        vm.chainId(296);
        vm.etch(HTS, type(HtsPrecompileMock).runtimeCode);
        Deploy.Config memory cfg = _cfg(true, "hedera-ledger");
        Deploy.Result memory r = deploy.deploy(deploy.loadChain(296), cfg);
        DataDrop dd = DataDrop(r.dataDrop);
        assertTrue(dd.ledgerOnly());
        assertEq(dd.usdc(), address(0));
        assertEq(dd.owner(), cfg.owner);
        assertEq(HtsPrecompileMock(HTS).callCount(), 0); // nothing to associate
        string memory json = vm.readFile(cfg.addressesPath);
        assertTrue(vm.parseJsonBool(json, ".ledgerOnly"));
        assertEq(vm.parseJsonUint(json, ".chainId"), 296);
        assertEq(vm.parseJsonString(json, ".network"), "eip155:296");
        assertEq(vm.parseJsonAddress(json, ".usdc"), address(0));
        assertEq(vm.parseJsonString(json, ".usdcHts"), "0.0.429274");
        vm.removeFile(cfg.addressesPath);
    }

    function test_HederaTokenModeAssociatesInSameBroadcast() public {
        vm.chainId(296);
        vm.etch(HTS, type(HtsPrecompileMock).runtimeCode);
        Deploy.Config memory cfg = _cfg(false, "hedera-token");
        Deploy.Result memory r = deploy.deploy(deploy.loadChain(296), cfg);
        DataDrop dd = DataDrop(r.dataDrop);
        assertFalse(dd.ledgerOnly());
        assertEq(dd.usdc(), HEDERA_USDC);
        (address acct, address tok) = HtsPrecompileMock(HTS).last();
        assertEq(acct, r.dataDrop);
        assertEq(tok, HEDERA_USDC);
        // ownership handed to the cold owner in two steps
        assertEq(dd.owner(), r.deployer);
        assertEq(dd.pendingOwner(), cfg.owner);
        vm.prank(cfg.owner);
        dd.acceptOwnership();
        assertEq(dd.owner(), cfg.owner);
        assertEq(vm.parseJsonAddress(vm.readFile(cfg.addressesPath), ".usdc"), HEDERA_USDC);
        vm.removeFile(cfg.addressesPath);
    }

    function test_RevertWhen_HederaAssociationFails() public {
        vm.chainId(296); // no precompile mock: association fails, the whole deploy reverts
        Deploy.Config memory cfg = _cfg(false, "hedera-fail");
        Deploy.ChainRecord memory chain = deploy.loadChain(296);
        vm.expectRevert(abi.encodeWithSelector(DataDrop.HtsAssociationFailed.selector, int64(21)));
        deploy.deploy(chain, cfg);
    }

    function test_BaseSepoliaDeploysDataDropOnly() public {
        vm.chainId(84_532);
        Deploy.Config memory cfg = _cfg(false, "base-sepolia");
        Deploy.ChainRecord memory chain = deploy.loadChain(84_532);
        address deployer = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38; // forge's default broadcaster
        uint64 nonceBefore = vm.getNonce(deployer);
        Deploy.Result memory r = deploy.deploy(chain, cfg);
        assertEq(r.deployer, deployer);
        assertEq(vm.getNonce(deployer), nonceBefore + 1); // exactly one tx: no MockUSDC3009, no mints
        assertEq(DataDrop(r.dataDrop).usdc(), BASE_SEPOLIA_USDC);
        assertFalse(DataDrop(r.dataDrop).ledgerOnly());
        assertEq(DataDrop(r.dataDrop).owner(), cfg.owner);
        vm.removeFile(cfg.addressesPath);
    }

    function test_RevertWhen_LiveChainHasNoUsdcAndNoLedgerOnly() public {
        vm.chainId(1301);
        Deploy.Config memory cfg = _cfg(false, "unichain");
        Deploy.ChainRecord memory chain = deploy.loadChain(1301);
        vm.expectRevert(bytes("deploy/chains.json lists no usdc for unichain_sepolia; set LEDGER_ONLY=true explicitly"));
        deploy.deploy(chain, cfg);
        // with LEDGER_ONLY it deploys
        cfg.ledgerOnly = true;
        Deploy.Result memory r = deploy.deploy(chain, cfg);
        assertTrue(DataDrop(r.dataDrop).ledgerOnly());
        vm.removeFile(cfg.addressesPath);
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

    function test_NoPrivateKeyLiteralInScripts() public view {
        string memory src = vm.readFile(string.concat(vm.projectRoot(), "/script/Deploy.s.sol"));
        assertEq(_indexOf(src, "ac0974"), type(uint256).max);
        src = vm.readFile(string.concat(vm.projectRoot(), "/script/EmitVectors.s.sol"));
        assertEq(_indexOf(src, "ac0974"), type(uint256).max);
        assertEq(_indexOf(src, "8b3a350c"), type(uint256).max); // Anvil #5 key is derived, not pasted
    }
}
