// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {DataDrop} from "../../src/DataDrop.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {HtsPrecompileMock} from "../mocks/HtsPrecompileMock.sol";
import {HtsTokenStub} from "../mocks/HtsTokenStub.sol";
import {InstallAt} from "../utils/InstallAt.sol";
import {DeployRegressionBase} from "./DeployRegressionBase.sol";

/// @notice T-10 deploy guards (ops red team, RT-P-12 context): the chain record must be chains.json's record for the
///         connected chain with a safe slug, checked before any broadcast or addresses-file write; on Hedera the
///         HTS association must be read back after `associateHts`, or the broadcast fails.
contract T10_DeployChainGuardsTest is DeployRegressionBase {
    function _assertNoFile(Deploy.Config memory cfg) internal view {
        assertFalse(vm.exists(cfg.addressesPath), "addresses file written despite revert");
    }

    function test_RevertWhen_ChainIdUnknownToChainsJson() public {
        Deploy.ChainRecord memory chain = script.loadChain(84_532);
        vm.chainId(999);
        Deploy.Config memory cfg = _config(true, makeAddr("cold"), "unknown-chain");
        (bool reverted, bytes memory reason) = _deployReverts(chain, cfg);
        assertTrue(reverted);
        assertEq(reason, abi.encodeWithSignature("Error(string)", "deploy/chains.json has no entry for chain 999"));
        _assertNoFile(cfg);
    }

    function test_RevertWhen_RecordBelongsToAnotherChain() public {
        Deploy.ChainRecord memory base = script.loadChain(84_532);
        vm.chainId(296); // connected to Hedera testnet, but handed Base Sepolia's record
        Deploy.Config memory cfg = _config(true, makeAddr("cold"), "wrong-chain");
        (bool reverted, bytes memory reason) = _deployReverts(base, cfg);
        assertTrue(reverted);
        assertEq(
            reason,
            abi.encodeWithSignature(
                "Error(string)", "chain record slug 'base_sepolia' is not chains.json's slug for chain 296"
            )
        );
        _assertNoFile(cfg);
    }

    function test_RevertWhen_SlugUnknownOrUnsafe() public {
        vm.chainId(84_532);
        string[3] memory bad = ["nonexistent", "../../etc/evil", "BASE_SEPOLIA"];
        for (uint256 i = 0; i < bad.length; i++) {
            Deploy.ChainRecord memory chain = script.loadChain(84_532);
            chain.slug = bad[i];
            Deploy.Config memory cfg = _config(true, makeAddr("cold"), string.concat("slug-", vm.toString(i)));
            (bool reverted,) = _deployReverts(chain, cfg);
            assertTrue(reverted, bad[i]);
            _assertNoFile(cfg);
        }
    }

    function _hedera(bool tokenSaysAssociated) internal returns (Deploy.ChainRecord memory chain) {
        vm.chainId(296);
        vm.etch(HTS_SYSTEM, type(HtsPrecompileMock).runtimeCode);
        InstallAt.install(
            HEDERA_USDC_ALIAS, abi.encodePacked(type(HtsTokenStub).creationCode, abi.encode(tokenSaysAssociated))
        );
        chain = script.loadChain(296);
    }

    function test_RevertWhen_HtsTokenDeniesAssociation() public {
        Deploy.ChainRecord memory chain = _hedera(false); // precompile said 22, the token says "not associated"
        Deploy.Config memory cfg = _config(false, makeAddr("cold"), "hts-denied");
        (bool reverted, bytes memory reason) = _deployReverts(chain, cfg);
        assertTrue(reverted);
        assertEq(reason, abi.encodeWithSignature("Error(string)", "HTS association of usdc not recorded on DataDrop"));
        _assertNoFile(cfg);
    }

    function test_RevertWhen_HtsPrecompileReportsFailure() public {
        Deploy.ChainRecord memory chain = _hedera(true);
        HtsPrecompileMock(HTS_SYSTEM).setResponse(int64(184)); // any rc != SUCCESS
        Deploy.Config memory cfg = _config(false, makeAddr("cold"), "hts-rc");
        (bool reverted, bytes memory reason) = _deployReverts(chain, cfg);
        assertTrue(reverted);
        assertEq(reason, abi.encodeWithSelector(DataDrop.HtsAssociationFailed.selector, int64(184)));
        _assertNoFile(cfg);
    }

    function test_HtsAssociationReadBackSucceeds() public {
        Deploy.ChainRecord memory chain = _hedera(true);
        Deploy.Config memory cfg = _config(false, makeAddr("cold"), "hts-ok");
        Deploy.Result memory r = script.deploy(chain, cfg);
        assertTrue(DataDrop(r.dataDrop).htsAssociated(HEDERA_USDC_ALIAS));
        assertTrue(DataDrop(r.dataDrop).isHtsAssociated(HEDERA_USDC_ALIAS));
        vm.removeFile(cfg.addressesPath);
    }

    function test_IsHtsAssociatedFalseUntilAssociated() public {
        vm.chainId(296);
        vm.etch(HTS_SYSTEM, type(HtsPrecompileMock).runtimeCode);
        address owner_ = makeAddr("owner");
        DataDrop d = new DataDrop(IERC20(address(0)), makeAddr("payout"), makeAddr("attestor"), owner_);
        address codeless = makeAddr("codeless-hts-token");
        assertFalse(d.isHtsAssociated(codeless));
        vm.prank(owner_);
        d.associateHts(codeless);
        assertTrue(d.isHtsAssociated(codeless)); // no facade answer ⇒ the recorded SUCCESS decides
    }
}
