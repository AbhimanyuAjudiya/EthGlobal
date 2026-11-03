// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {DataDrop} from "../src/DataDrop.sol";
import {IDataDrop} from "../src/interfaces/IDataDrop.sol";
import {MockUSDC3009} from "../src/MockUSDC3009.sol";
import {HtsPrecompileMock} from "./mocks/HtsPrecompileMock.sol";
import {ReentrantToken} from "./mocks/ReentrantToken.sol";
import {FalseReturnToken, LyingToken} from "./mocks/BadTokens.sol";

/// @notice DataDrop acceptance tests (brief §6, DECISION §6.5) plus every Foundry case in
///         security/redteam/attacks/wave1-contracts.md (prefixed `test_Attack_` / `test_Drill_`). Every attack must fail.
/// @dev Roles follow `anvilRoles`: owner #0, payout #1, attestor #2, sponsor #3, human #5, stranger #7.
///      All amounts are 6-decimal USDC base units.
contract DataDropTest is Test {
    MockUSDC3009 internal usdc;
    DataDrop internal drop;

    address internal constant OWNER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266; // Anvil #0
    address internal constant PAYOUT = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // #1
    address internal constant ATTESTOR = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; // #2
    address internal constant SPONSOR = 0x90F79bf6EB2c4f870365E785982E1f101E93b906; // #3
    address internal constant STRANGER = 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955; // #7
    address internal constant HTS = 0x0000000000000000000000000000000000000167;

    bytes32 internal constant ID = keccak256("demo-welcome");
    uint128 internal constant BUDGET = 500_000_000; // $500.00
    uint96 internal constant PRICE = 500_000; // $0.50
    uint32 internal constant CAP = 5;
    bytes32 internal constant TRANSFER_TOPIC = keccak256("Transfer(address,address,uint256)");

    uint64 internal expiresAt;

    function setUp() public {
        vm.warp(1_762_200_000);
        usdc = new MockUSDC3009();
        drop = new DataDrop(IERC20(address(usdc)), PAYOUT, ATTESTOR, OWNER);
        expiresAt = uint64(block.timestamp + 7 days);
        usdc.mint(SPONSOR, 10 * uint256(BUDGET));
        vm.startPrank(SPONSOR);
        usdc.approve(address(drop), type(uint256).max);
        drop.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);
        vm.stopPrank();
    }

    // ───────────────────────────── helpers ─────────────────────────────

    /// onchainClaimKey as octroi computes it: keccak256(abi.encodePacked(id, campaignClaimKey)).
    function key(bytes32 id, uint256 humanIx) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(id, keccak256(abi.encodePacked("cck", humanIx))));
    }

    function _create(bytes32 id, uint128 budget, uint96 price, uint32 cap, uint64 exp) internal {
        vm.prank(SPONSOR);
        drop.createCampaign(id, budget, price, cap, exp);
    }

    function _claim(bytes32 id, uint256 ix) internal {
        vm.prank(ATTESTOR);
        drop.claim(id, key(id, ix));
    }

    function _assertNoTransferLogs(Vm.Log[] memory logs) internal pure {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 0) assertTrue(logs[i].topics[0] != TRANSFER_TOPIC, "unexpected Transfer");
        }
    }

    // ───────────────────────────── constructor / mode ─────────────────────────────

    function test_ConstructorEmitsModeAndAttestor() public {
        vm.expectEmit(true, true, true, true);
        emit IDataDrop.ModeSet(false);
        vm.expectEmit(true, true, true, true);
        emit IDataDrop.AttestorSet(ATTESTOR);
        DataDrop d = new DataDrop(IERC20(address(usdc)), PAYOUT, ATTESTOR, OWNER);
        assertFalse(d.ledgerOnly());
        assertEq(d.usdc(), address(usdc));
        assertEq(d.payout(), PAYOUT);
        assertEq(d.attestor(), ATTESTOR);
        assertEq(d.owner(), OWNER);

        vm.expectEmit(true, true, true, true);
        emit IDataDrop.ModeSet(true);
        vm.expectEmit(true, true, true, true);
        emit IDataDrop.AttestorSet(ATTESTOR);
        DataDrop lo = new DataDrop(IERC20(address(0)), PAYOUT, ATTESTOR, OWNER);
        assertTrue(lo.ledgerOnly());
        assertEq(lo.usdc(), address(0));
    }

    function test_RevertWhen_ConstructorZeroRoles() public {
        vm.expectRevert(DataDrop.ZeroAddress.selector);
        new DataDrop(IERC20(address(usdc)), address(0), ATTESTOR, OWNER);
        vm.expectRevert(DataDrop.ZeroAddress.selector);
        new DataDrop(IERC20(address(usdc)), PAYOUT, address(0), OWNER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new DataDrop(IERC20(address(usdc)), PAYOUT, ATTESTOR, address(0));
    }

    function test_SetupInvariants() public view {
        assertEq(usdc.balanceOf(address(drop)), BUDGET);
        assertEq(drop.campaigns(ID).spent, 0);
        assertFalse(drop.ledgerOnly());
        assertEq(drop.attestor(), ATTESTOR);
    }

    // ───────────────────────────── createCampaign ─────────────────────────────

    function test_CreateCampaignPullsBudget() public {
        bytes32 id = keccak256("pull");
        uint256 sponsorBefore = usdc.balanceOf(SPONSOR);
        uint256 dropBefore = usdc.balanceOf(address(drop));
        vm.expectEmit(true, true, true, true, address(drop));
        emit IDataDrop.CampaignCreated(id, SPONSOR, BUDGET, PRICE, CAP, expiresAt);
        _create(id, BUDGET, PRICE, CAP, expiresAt);
        assertEq(usdc.balanceOf(address(drop)) - dropBefore, BUDGET);
        assertEq(sponsorBefore - usdc.balanceOf(SPONSOR), BUDGET);

        IDataDrop.Campaign memory c = drop.campaigns(id);
        assertEq(c.sponsor, SPONSOR);
        assertEq(c.budget, BUDGET);
        assertEq(c.spent, 0);
        assertEq(c.pricePerClaim, PRICE);
        assertEq(c.claimsPerHour, CAP);
        assertEq(c.expiresAt, expiresAt);
        assertEq(c.pausedSince, 0);
        assertFalse(c.paused);
    }

    function test_RevertWhen_CreateCampaignIdExists() public {
        _claim(ID, 1);
        usdc.mint(STRANGER, BUDGET);
        vm.startPrank(STRANGER);
        usdc.approve(address(drop), type(uint256).max);
        vm.expectRevert(IDataDrop.CampaignExists.selector);
        drop.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);
        vm.stopPrank();
        assertEq(drop.campaigns(ID).sponsor, SPONSOR);
        assertEq(drop.campaigns(ID).spent, PRICE);
        assertEq(usdc.balanceOf(STRANGER), BUDGET);
    }

    function test_RevertWhen_CreateCampaignInvalid() public {
        uint64 exp = expiresAt;
        vm.startPrank(SPONSOR);
        vm.expectRevert(IDataDrop.InvalidCampaign.selector); // budget < price
        drop.createCampaign(keccak256("a"), PRICE - 1, PRICE, CAP, exp);
        vm.expectRevert(IDataDrop.InvalidCampaign.selector); // price == 0
        drop.createCampaign(keccak256("b"), BUDGET, 0, CAP, exp);
        vm.expectRevert(IDataDrop.InvalidCampaign.selector); // claimsPerHour == 0
        drop.createCampaign(keccak256("c"), BUDGET, PRICE, 0, exp);
        vm.expectRevert(IDataDrop.InvalidCampaign.selector); // expiresAt == now
        drop.createCampaign(keccak256("d"), BUDGET, PRICE, CAP, uint64(block.timestamp));
        vm.expectRevert(IDataDrop.InvalidCampaign.selector); // expiresAt < now
        drop.createCampaign(keccak256("e"), BUDGET, PRICE, CAP, uint64(block.timestamp - 1));
        vm.expectRevert(IDataDrop.InvalidCampaign.selector); // budget == 0, price == 0
        drop.createCampaign(keccak256("f"), 0, 0, CAP, exp);
        vm.stopPrank();
        assertEq(drop.campaigns(keccak256("a")).sponsor, address(0));
        // budget == price is the smallest valid campaign
        _create(keccak256("ok"), PRICE, PRICE, 1, exp);
    }

    function test_RevertWhen_CreateCampaignTransferFails() public {
        bytes32 id = keccak256("x");
        // 1) no allowance
        usdc.mint(STRANGER, BUDGET);
        vm.prank(STRANGER);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(drop), 0, BUDGET)
        );
        drop.createCampaign(id, BUDGET, PRICE, CAP, expiresAt);
        // 2) allowance but no balance
        vm.startPrank(makeAddr("broke"));
        usdc.approve(address(drop), type(uint256).max);
        vm.expectRevert();
        drop.createCampaign(id, BUDGET, PRICE, CAP, expiresAt);
        vm.stopPrank();
        assertEq(drop.campaigns(id).sponsor, address(0));

        // 3) token returns false (HTS facade style) ⇒ SafeERC20 reverts
        FalseReturnToken f = new FalseReturnToken();
        DataDrop df = new DataDrop(IERC20(address(f)), PAYOUT, ATTESTOR, OWNER);
        f.mint(SPONSOR, BUDGET);
        vm.prank(SPONSOR);
        vm.expectRevert(abi.encodeWithSignature("SafeERC20FailedOperation(address)", address(f)));
        df.createCampaign(id, BUDGET, PRICE, CAP, expiresAt);
        assertEq(df.campaigns(id).sponsor, address(0));

        // 4) token returns true but moves nothing ⇒ balance-delta check reverts
        LyingToken l = new LyingToken();
        DataDrop dl = new DataDrop(IERC20(address(l)), PAYOUT, ATTESTOR, OWNER);
        vm.prank(SPONSOR);
        vm.expectRevert(DataDrop.BudgetNotReceived.selector);
        dl.createCampaign(id, BUDGET, PRICE, CAP, expiresAt);
        assertEq(dl.campaigns(id).sponsor, address(0));
    }

    // ───────────────────────────── claim ─────────────────────────────

    function test_ClaimPaysPayoutOnce() public {
        bytes32 k = key(ID, 1);
        uint64 bucket = drop.currentHourBucket();
        vm.expectEmit(true, true, true, true, address(drop));
        emit IDataDrop.Claimed(ID, k, PRICE, bucket);
        vm.prank(ATTESTOR);
        drop.claim(ID, k);
        assertEq(usdc.balanceOf(PAYOUT), PRICE);
        assertEq(usdc.balanceOf(address(drop)), BUDGET - PRICE);
        assertTrue(drop.claimed(ID, k));
        assertEq(drop.campaigns(ID).spent, PRICE);
        assertEq(drop.claimsInHour(ID, bucket), 1);
    }

    function test_RevertWhen_ClaimTwiceSameKey() public {
        bytes32 k = key(ID, 1);
        vm.startPrank(ATTESTOR);
        drop.claim(ID, k);
        vm.expectRevert(IDataDrop.AlreadyClaimed.selector);
        drop.claim(ID, k);
        vm.stopPrank();
        assertEq(drop.campaigns(ID).spent, PRICE);
        assertEq(drop.claimsInHour(ID, drop.currentHourBucket()), 1);

        // the same raw key on another campaign succeeds (by design)
        bytes32 id2 = keccak256("other");
        _create(id2, BUDGET, PRICE, CAP, expiresAt);
        vm.prank(ATTESTOR);
        drop.claim(id2, k);
        assertTrue(drop.claimed(id2, k));
    }

    function test_RevertWhen_ClaimNotAttestor() public {
        address[3] memory callers = [SPONSOR, OWNER, STRANGER];
        for (uint256 i = 0; i < callers.length; i++) {
            vm.prank(callers[i]);
            vm.expectRevert(IDataDrop.NotAttestor.selector);
            drop.claim(ID, key(ID, i));
        }
        assertEq(drop.campaigns(ID).spent, 0);
    }

    function test_RevertWhen_ClaimPaused() public {
        vm.prank(SPONSOR);
        drop.pause(ID, true);
        vm.prank(ATTESTOR);
        vm.expectRevert(IDataDrop.CampaignPaused.selector);
        drop.claim(ID, key(ID, 1));
        vm.prank(SPONSOR);
        drop.pause(ID, false);
        _claim(ID, 1);
    }

    function test_RevertWhen_ClaimExpired() public {
        vm.warp(expiresAt);
        vm.prank(ATTESTOR);
        vm.expectRevert(IDataDrop.CampaignExpired.selector);
        drop.claim(ID, key(ID, 1));
    }

    function test_RevertWhen_ClaimBudgetExhausted() public {
        bytes32 id = keccak256("small");
        _create(id, 2 * uint128(PRICE) + 1, PRICE, CAP, expiresAt);
        _claim(id, 1);
        _claim(id, 2);
        vm.prank(ATTESTOR);
        vm.expectRevert(IDataDrop.BudgetExhausted.selector);
        drop.claim(id, key(id, 3));
        // the 1-unit remainder stays refundable
        vm.warp(expiresAt);
        uint256 before = usdc.balanceOf(SPONSOR);
        vm.prank(SPONSOR);
        drop.refund(id);
        assertEq(usdc.balanceOf(SPONSOR) - before, 1);
    }

    function test_RevertWhen_ClaimUnknownCampaign() public {
        vm.prank(ATTESTOR);
        vm.expectRevert(IDataDrop.InvalidCampaign.selector);
        drop.claim(keccak256("nope"), key(ID, 1));
        assertEq(usdc.balanceOf(PAYOUT), 0);
    }

    function test_HourlyCapAcrossBucketBoundary() public {
        vm.warp(3599);
        bytes32 id = keccak256("edge");
        _create(id, BUDGET, PRICE, CAP, uint64(3599 + 7 days));
        assertEq(drop.currentHourBucket(), 0);
        vm.startPrank(ATTESTOR);
        for (uint256 i = 0; i < CAP; i++) {
            drop.claim(id, key(id, i));
        }
        assertEq(drop.claimsInHour(id, 0), CAP);
        vm.expectRevert(IDataDrop.HourlyCap.selector);
        drop.claim(id, key(id, 100));

        vm.warp(3600);
        assertEq(drop.currentHourBucket(), 1);
        for (uint256 i = 0; i < CAP; i++) {
            vm.expectEmit(true, true, true, true, address(drop));
            emit IDataDrop.Claimed(id, key(id, 200 + i), PRICE, 1);
            drop.claim(id, key(id, 200 + i));
        }
        assertEq(drop.claimsInHour(id, drop.currentHourBucket()), CAP);
        vm.expectRevert(IDataDrop.HourlyCap.selector);
        drop.claim(id, key(id, 300));
        vm.stopPrank();
        assertEq(drop.claimsInHour(id, 0), CAP);
        assertEq(drop.campaigns(id).spent, 2 * uint128(CAP) * PRICE);
    }

    // ───────────────────────────── pause ─────────────────────────────

    function _expectPaused(bool p, address by) internal {
        vm.expectEmit(true, true, true, true, address(drop));
        emit IDataDrop.Paused(ID, p, by);
    }

    function test_PauseMatrix() public {
        // sponsor: true and false
        vm.warp(block.timestamp + 10);
        _expectPaused(true, SPONSOR);
        vm.prank(SPONSOR);
        drop.pause(ID, true);
        assertTrue(drop.campaigns(ID).paused);
        assertEq(drop.campaigns(ID).pausedSince, uint64(block.timestamp));
        _expectPaused(false, SPONSOR);
        vm.prank(SPONSOR);
        drop.pause(ID, false);
        assertFalse(drop.campaigns(ID).paused);
        assertEq(drop.campaigns(ID).pausedSince, 0);

        // attestor: true ok, false NotSponsor
        _expectPaused(true, ATTESTOR);
        vm.prank(ATTESTOR);
        drop.pause(ID, true);
        assertTrue(drop.campaigns(ID).paused);
        vm.prank(ATTESTOR);
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.pause(ID, false);
        assertTrue(drop.campaigns(ID).paused);

        // stranger and owner: both values NotSponsor
        address[2] memory others = [STRANGER, OWNER];
        for (uint256 i = 0; i < others.length; i++) {
            vm.prank(others[i]);
            vm.expectRevert(IDataDrop.NotSponsor.selector);
            drop.pause(ID, true);
            vm.prank(others[i]);
            vm.expectRevert(IDataDrop.NotSponsor.selector);
            drop.pause(ID, false);
        }
        assertTrue(drop.campaigns(ID).paused);

        // no-op transitions still emit and keep pausedSince
        uint64 since = drop.campaigns(ID).pausedSince;
        vm.warp(block.timestamp + 100);
        _expectPaused(true, SPONSOR);
        vm.prank(SPONSOR);
        drop.pause(ID, true);
        assertEq(drop.campaigns(ID).pausedSince, since);
        vm.prank(SPONSOR);
        drop.pause(ID, false);
        _expectPaused(false, SPONSOR);
        vm.prank(SPONSOR);
        drop.pause(ID, false);
        assertEq(drop.campaigns(ID).pausedSince, 0);
    }

    // ───────────────────────────── refund ─────────────────────────────

    function test_RefundOnlyAfterExpiryOrLongPause() public {
        _claim(ID, 1);
        vm.prank(SPONSOR);
        vm.expectRevert(IDataDrop.NotRefundable.selector);
        drop.refund(ID);

        // pause → (23 h) → unpause → pause resets the 24 h clock
        vm.startPrank(SPONSOR);
        drop.pause(ID, true);
        vm.warp(block.timestamp + 23 hours);
        drop.pause(ID, false);
        drop.pause(ID, true);
        vm.warp(block.timestamp + 24 hours - 1);
        vm.expectRevert(IDataDrop.NotRefundable.selector);
        drop.refund(ID);
        vm.warp(block.timestamp + 1); // exactly 24 h since the last false→true
        uint256 before = usdc.balanceOf(SPONSOR);
        vm.expectEmit(true, true, true, true, address(drop));
        emit IDataDrop.Refunded(ID, BUDGET - PRICE);
        drop.refund(ID);
        assertEq(usdc.balanceOf(SPONSOR) - before, BUDGET - PRICE);
        IDataDrop.Campaign memory c = drop.campaigns(ID);
        assertEq(c.budget, c.spent);
        vm.expectRevert(IDataDrop.NotRefundable.selector);
        drop.refund(ID);
        drop.pause(ID, false);
        vm.stopPrank();
        vm.prank(ATTESTOR);
        vm.expectRevert(IDataDrop.BudgetExhausted.selector);
        drop.claim(ID, key(ID, 2));
        assertEq(usdc.balanceOf(address(drop)), 0);

        // expiry path on a second campaign
        bytes32 id2 = keccak256("expiry");
        _create(id2, BUDGET, PRICE, CAP, uint64(block.timestamp + 1 days));
        vm.prank(SPONSOR);
        vm.expectRevert(IDataDrop.NotRefundable.selector);
        drop.refund(id2);
        vm.warp(block.timestamp + 1 days);
        vm.prank(SPONSOR);
        drop.refund(id2);
        assertEq(drop.campaigns(id2).budget, 0);
        // non-sponsors never refund
        vm.prank(STRANGER);
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.refund(id2);
    }

    // ───────────────────────────── LEDGER_ONLY ─────────────────────────────

    function test_LedgerOnlyMovesNoTokens() public {
        DataDrop lo = new DataDrop(IERC20(address(0)), PAYOUT, ATTESTOR, OWNER);
        assertTrue(lo.ledgerOnly());
        assertEq(lo.usdc(), address(0));
        uint256 sponsorBal = usdc.balanceOf(SPONSOR);

        vm.recordLogs();
        vm.prank(SPONSOR);
        lo.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);
        vm.prank(ATTESTOR);
        lo.claim(ID, key(ID, 1));
        vm.prank(ATTESTOR);
        lo.pause(ID, true);
        vm.prank(SPONSOR);
        lo.pause(ID, false);
        vm.warp(expiresAt);
        vm.prank(SPONSOR);
        lo.refund(ID);
        vm.prank(OWNER);
        lo.setAttestor(STRANGER);
        _assertNoTransferLogs(vm.getRecordedLogs());

        IDataDrop.Campaign memory c = lo.campaigns(ID);
        assertEq(c.spent, PRICE);
        assertEq(c.budget, PRICE);
        assertTrue(lo.claimed(ID, key(ID, 1)));
        assertEq(usdc.balanceOf(SPONSOR), sponsorBal);
        assertEq(usdc.balanceOf(PAYOUT), 0);
        assertEq(usdc.balanceOf(address(lo)), 0);
    }

    // ───────────────────────────── HTS ─────────────────────────────

    function test_AssociateHtsOnlyOnHedera() public {
        vm.prank(OWNER);
        vm.expectRevert(IDataDrop.NotHedera.selector);
        drop.associateHts(address(usdc));

        vm.chainId(296);
        vm.etch(HTS, type(HtsPrecompileMock).runtimeCode);
        vm.expectEmit(true, true, true, true, address(drop));
        emit DataDrop.HtsAssociated(address(usdc));
        vm.prank(OWNER);
        drop.associateHts(address(usdc));
        (address acct, address tok) = HtsPrecompileMock(HTS).last();
        assertEq(acct, address(drop));
        assertEq(tok, address(usdc));
        assertEq(HtsPrecompileMock(HTS).callCount(), 1);

        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, STRANGER));
        drop.associateHts(address(usdc));
        vm.prank(ATTESTOR);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ATTESTOR));
        drop.associateHts(address(usdc));

        // 295 (mainnet) is Hedera too
        vm.chainId(295);
        vm.prank(OWNER);
        drop.associateHts(address(usdc));
        assertEq(HtsPrecompileMock(HTS).callCount(), 2);
    }

    function test_Attack_AssociateHtsOffHederaReverts() public {
        uint256[3] memory ids = [uint256(1), 84_532, 297];
        for (uint256 i = 0; i < ids.length; i++) {
            vm.chainId(ids[i]);
            vm.prank(OWNER);
            vm.expectRevert(IDataDrop.NotHedera.selector);
            drop.associateHts(address(usdc));
        }
    }

    function test_AssociateHtsOnHederaCallsPrecompileWithThisAndToken() public {
        vm.chainId(296);
        vm.etch(HTS, type(HtsPrecompileMock).runtimeCode);
        vm.prank(OWNER);
        drop.associateHts(address(usdc));
        (address acct, address tok) = HtsPrecompileMock(HTS).last();
        assertEq(acct, address(drop));
        assertEq(tok, address(usdc));
        vm.prank(OWNER);
        vm.expectRevert(DataDrop.NotUsdc.selector); // token mode: only usdc may be associated
        drop.associateHts(address(0xBEEF));
        vm.prank(STRANGER);
        vm.expectRevert();
        drop.associateHts(address(usdc));

        // LEDGER_ONLY may associate any token (funds move natively on HTS)
        DataDrop lo = new DataDrop(IERC20(address(0)), PAYOUT, ATTESTOR, OWNER);
        vm.prank(OWNER);
        lo.associateHts(address(0xBEEF));
        (acct, tok) = HtsPrecompileMock(HTS).last();
        assertEq(acct, address(lo));
        assertEq(tok, address(0xBEEF));
    }

    function test_Attack_HtsFailureCodeReverts() public {
        vm.chainId(296);
        vm.etch(HTS, type(HtsPrecompileMock).runtimeCode);
        HtsPrecompileMock(HTS).setResponse(int64(167));
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(DataDrop.HtsAssociationFailed.selector, int64(167)));
        drop.associateHts(address(usdc));
    }

    function test_Attack_HtsMissingPrecompileReverts() public {
        vm.chainId(296); // nothing etched at 0x167: the call returns no data
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(DataDrop.HtsAssociationFailed.selector, int64(21)));
        drop.associateHts(address(usdc));
    }

    // ───────────────────────────── owner powers / ABI (T-10) ─────────────────────────────

    function test_NoTokenMovesOutsideThreeFunctions() public {
        // the artefact's size depends on build flags (slither adds build-info): keep its parse out of the gas snapshot
        vm.pauseGasMetering();
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/out/DataDrop.sol/DataDrop.json"));
        string[9] memory allowed = [
            "createCampaign",
            "claim",
            "pause",
            "refund",
            "setAttestor",
            "associateHts",
            "transferOwnership",
            "acceptOwnership",
            "renounceOwnership"
        ];
        bool[9] memory seen;
        uint256 mutating;
        for (uint256 i = 0;; i++) {
            string memory p = string.concat(".abi[", vm.toString(i), "]");
            if (!vm.keyExistsJson(json, p)) break;
            if (keccak256(bytes(vm.parseJsonString(json, string.concat(p, ".type")))) != keccak256("function")) {
                continue;
            }
            bytes32 mut = keccak256(bytes(vm.parseJsonString(json, string.concat(p, ".stateMutability"))));
            if (mut == keccak256("view") || mut == keccak256("pure")) continue;
            assertTrue(mut != keccak256("payable"), "payable function");
            string memory name = vm.parseJsonString(json, string.concat(p, ".name"));
            bool ok;
            for (uint256 j = 0; j < allowed.length; j++) {
                if (keccak256(bytes(name)) == keccak256(bytes(allowed[j]))) {
                    ok = true;
                    seen[j] = true;
                }
            }
            assertTrue(ok, string.concat("unexpected state-changing function: ", name));
            mutating++;
        }
        assertEq(mutating, allowed.length);
        for (uint256 j = 0; j < allowed.length; j++) {
            assertTrue(seen[j], allowed[j]);
        }
        vm.resumeGasMetering();

        // and the six non-moving ones really move no tokens
        vm.chainId(296);
        vm.etch(HTS, type(HtsPrecompileMock).runtimeCode);
        vm.recordLogs();
        vm.prank(SPONSOR);
        drop.pause(ID, true);
        vm.prank(SPONSOR);
        drop.pause(ID, false);
        vm.startPrank(OWNER);
        drop.setAttestor(STRANGER);
        drop.associateHts(address(usdc));
        drop.transferOwnership(SPONSOR);
        vm.stopPrank();
        vm.prank(SPONSOR);
        drop.acceptOwnership();
        vm.prank(SPONSOR);
        drop.renounceOwnership();
        _assertNoTransferLogs(vm.getRecordedLogs());
        assertEq(usdc.balanceOf(address(drop)), BUDGET);
    }

    function test_Attack_SetAttestorOwnerOnlyAndNonZero() public {
        address[3] memory others = [ATTESTOR, SPONSOR, STRANGER];
        for (uint256 i = 0; i < others.length; i++) {
            vm.prank(others[i]);
            vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, others[i]));
            drop.setAttestor(others[i]);
        }
        vm.prank(OWNER);
        vm.expectRevert(DataDrop.ZeroAddress.selector);
        drop.setAttestor(address(0));
        address a2 = makeAddr("attestor-2");
        vm.expectEmit(true, true, true, true, address(drop));
        emit IDataDrop.AttestorSet(a2);
        vm.prank(OWNER);
        drop.setAttestor(a2);
        assertEq(drop.attestor(), a2);
    }

    function test_Attack_Ownable2StepNeedsAccept() public {
        vm.prank(OWNER);
        drop.transferOwnership(STRANGER);
        assertEq(drop.owner(), OWNER);
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, STRANGER));
        drop.setAttestor(STRANGER);
        vm.prank(SPONSOR);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, SPONSOR));
        drop.acceptOwnership();
        vm.prank(STRANGER);
        drop.acceptOwnership();
        assertEq(drop.owner(), STRANGER);
    }

    function test_Attack_ImmutablesNotInStorage() public view {
        // usdc/payout are immutable: no storage slot of the first few holds them.
        for (uint256 slot = 0; slot < 8; slot++) {
            bytes32 v = vm.load(address(drop), bytes32(slot));
            assertTrue(address(uint160(uint256(v))) != address(usdc), "usdc in storage");
            assertTrue(address(uint160(uint256(v))) != PAYOUT, "payout in storage");
        }
    }

    // ───────────────────────────── reentrancy (T-11) ─────────────────────────────

    function test_ReentrantTokenCannotDoubleClaim() public {
        ReentrantToken rt = new ReentrantToken();
        DataDrop d = new DataDrop(IERC20(address(rt)), PAYOUT, address(rt), OWNER); // the token is the attestor
        rt.arm(d, ReentrantToken.Mode.None, bytes32(0), bytes32(0));
        rt.mint(address(rt), BUDGET);
        rt.callCreate(ID, BUDGET, PRICE, CAP, expiresAt); // the token is also the sponsor

        bytes32 k1 = key(ID, 1);
        bytes32 k2 = key(ID, 2);
        rt.arm(d, ReentrantToken.Mode.Claim, ID, k2);
        rt.callClaim(ID, k1);
        assertEq(rt.reentryAttempts(), 1);
        assertEq(rt.lastError(), abi.encodeWithSelector(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector));
        assertEq(d.campaigns(ID).spent, PRICE);
        assertTrue(d.claimed(ID, k1));
        assertFalse(d.claimed(ID, k2));
        assertEq(d.claimsInHour(ID, d.currentHourBucket()), 1);
        assertEq(rt.balanceOf(PAYOUT), PRICE);
        assertEq(rt.balanceOf(address(d)), BUDGET - PRICE);

        // refund re-entry
        vm.warp(expiresAt);
        rt.arm(d, ReentrantToken.Mode.Refund, ID, bytes32(0));
        rt.callRefund(ID);
        assertEq(rt.reentryAttempts(), 2);
        assertEq(rt.lastError(), abi.encodeWithSelector(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector));
        IDataDrop.Campaign memory c = d.campaigns(ID);
        assertEq(c.budget, c.spent);
        assertEq(rt.balanceOf(address(d)), 0);
        assertEq(rt.balanceOf(address(rt)), BUDGET - PRICE);
    }

    // ───────────────────────────── decimals (T-08) ─────────────────────────────

    function test_Decimals6() public {
        assertEq(usdc.decimals(), 6);
        assertEq(uint256(PRICE), 0.5e6);
        assertEq(uint256(500_000), 0.5e6); // $0.50
        address s = makeAddr("million-dollar-sponsor");
        usdc.mint(s, 1_000_000e6); // 1 M USDC
        uint96 wrong = 500_000 * 1e12; // a parseEther() bug: $0.50 at 18 decimals
        vm.startPrank(s);
        usdc.approve(address(drop), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, s, 1_000_000e6, uint256(wrong))
        );
        drop.createCampaign(keccak256("18dec"), wrong, wrong, CAP, expiresAt);
        vm.stopPrank();
    }

    function test_Attack_EighteenDecimalPriceCannotBeFunded() public {
        uint96 wrong = uint96(0.5e18);
        vm.prank(SPONSOR);
        vm.expectRevert(IDataDrop.InvalidCampaign.selector); // price > budget
        drop.createCampaign(keccak256("18dec"), BUDGET, wrong, CAP, expiresAt);
    }

    // ───────────────────────────── fuzz ─────────────────────────────

    function testFuzz_PriceLeqBudget(uint128 budget, uint96 price) public {
        bytes32 id = keccak256(abi.encode("fuzz", budget, price));
        address s = makeAddr("fuzz-sponsor");
        usdc.mint(s, budget);
        vm.startPrank(s);
        usdc.approve(address(drop), type(uint256).max);
        bool valid = budget >= price && price > 0;
        if (!valid) vm.expectRevert(IDataDrop.InvalidCampaign.selector);
        drop.createCampaign(id, budget, price, CAP, expiresAt);
        vm.stopPrank();
        assertEq(drop.campaigns(id).sponsor, valid ? s : address(0));
        assertEq(usdc.balanceOf(s), valid ? 0 : budget);
    }

    function testFuzz_ClaimSequenceRespectsCapAndBudget(uint8 n, uint32 cap, uint32 warpSeconds) public {
        cap = uint32(bound(cap, 1, 20));
        uint256 step = bound(warpSeconds, 0, 3600);
        bytes32 id = keccak256(abi.encode("seq", n, cap, warpSeconds));
        uint128 budget = 30 * uint128(PRICE) + 7;
        _create(id, budget, PRICE, cap, expiresAt);
        uint256 ok;
        vm.startPrank(ATTESTOR);
        for (uint256 i = 0; i < n; i++) {
            try drop.claim(id, key(id, i)) {
                ok++;
            } catch (bytes memory r) {
                bytes4 sel = bytes4(r);
                assertTrue(
                    sel == IDataDrop.HourlyCap.selector || sel == IDataDrop.BudgetExhausted.selector
                        || sel == IDataDrop.CampaignExpired.selector,
                    "unexpected revert"
                );
            }
            assertLe(drop.claimsInHour(id, drop.currentHourBucket()), cap);
            vm.warp(block.timestamp + step);
        }
        vm.stopPrank();
        IDataDrop.Campaign memory c = drop.campaigns(id);
        assertLe(c.spent, c.budget);
        assertEq(c.spent, ok * PRICE);
        assertEq(usdc.balanceOf(PAYOUT), ok * PRICE);
    }

    function testFuzz_SpentNeverExceedsBudgetAndRemainderRefunds(uint96 price, uint128 budget, uint8 n) public {
        price = uint96(bound(price, 1, 1_000_000));
        budget = uint128(bound(budget, price, 50 * uint128(price)));
        bytes32 id = keccak256(abi.encode(price, budget, n));
        usdc.mint(SPONSOR, budget);
        vm.prank(SPONSOR);
        drop.createCampaign(id, budget, price, type(uint32).max, expiresAt);
        uint256 ok;
        vm.startPrank(ATTESTOR);
        for (uint256 i = 0; i < n; i++) {
            try drop.claim(id, key(id, i)) {
                ok++;
            } catch (bytes memory r) {
                assertEq(bytes4(r), IDataDrop.BudgetExhausted.selector);
                break;
            }
        }
        vm.stopPrank();
        assertEq(drop.campaigns(id).spent, ok * price);
        assertLe(drop.campaigns(id).spent, budget);
        vm.warp(expiresAt + 1);
        vm.prank(SPONSOR);
        if (budget > ok * price) drop.refund(id);
        assertEq(usdc.balanceOf(address(drop)), BUDGET); // only the setUp campaign's money remains
    }

    // ───────────────────────────── gas ─────────────────────────────

    function test_GasSnapshot_Claim() public {
        bytes32 k = key(ID, 1);
        vm.prank(ATTESTOR);
        uint256 g = gasleft();
        drop.claim(ID, k);
        uint256 first = g - gasleft(); // cold: payout balance 0 → non-zero
        vm.prank(ATTESTOR);
        g = gasleft();
        drop.claim(ID, key(ID, 2));
        uint256 second = g - gasleft();
        emit log_named_uint("claim gas (first, payout cold)", first);
        emit log_named_uint("claim gas (second claim, same tx: warm slots)", second);
        assertLe(first, 100_000);
        assertLe(second, 100_000);
    }

    // ═════════════════════ red-team script (wave1-contracts.md) ═════════════════════

    // A1 — compromised attestor (T-01)
    function test_Attack_AttestorDrainStopsAtHourlyCap() public {
        vm.startPrank(ATTESTOR);
        for (uint256 i = 0; i < CAP; i++) {
            drop.claim(ID, key(ID, i));
        }
        assertEq(usdc.balanceOf(PAYOUT), uint256(CAP) * PRICE); // $2.50
        assertEq(drop.claimsInHour(ID, drop.currentHourBucket()), CAP);
        vm.expectRevert(IDataDrop.HourlyCap.selector);
        drop.claim(ID, key(ID, 999));
        vm.stopPrank();
    }

    function test_Attack_RotationDoesNotResetTheHourCap() public {
        vm.startPrank(ATTESTOR);
        for (uint256 i = 0; i < CAP; i++) {
            drop.claim(ID, key(ID, i));
        }
        vm.stopPrank();
        address a2 = makeAddr("attestor-2");
        vm.prank(OWNER);
        drop.setAttestor(a2);
        vm.prank(a2);
        vm.expectRevert(IDataDrop.HourlyCap.selector);
        drop.claim(ID, key(ID, 50));
    }

    function test_Attack_ThreeCampaignsDrainBound() public {
        bytes32 id2 = keccak256("c2");
        bytes32 id3 = keccak256("c3");
        vm.startPrank(SPONSOR);
        drop.createCampaign(id2, BUDGET, PRICE, 2, expiresAt);
        drop.createCampaign(id3, 3 * uint128(PRICE), PRICE, 100, expiresAt);
        vm.stopPrank();
        vm.startPrank(ATTESTOR);
        for (uint256 i = 0; i < 50; i++) {
            try drop.claim(ID, key(ID, i)) {} catch {}
            try drop.claim(id2, key(id2, i)) {} catch {}
            try drop.claim(id3, key(id3, i)) {} catch {}
        }
        vm.stopPrank();
        // bound = Σ min(remaining, cap × price) = 5×0.5 + 2×0.5 + min(1.5, 50) = $5.00
        assertEq(usdc.balanceOf(PAYOUT), (5 + 2 + 3) * uint256(PRICE));
    }

    function test_Attack_AttestorCannotUnpauseOrTouchUnknownIds() public {
        vm.prank(ATTESTOR);
        drop.pause(ID, true);
        vm.prank(ATTESTOR);
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.pause(ID, false);
        vm.prank(ATTESTOR);
        vm.expectRevert(IDataDrop.InvalidCampaign.selector);
        drop.pause(keccak256("unknown"), true);
        vm.prank(STRANGER);
        vm.expectRevert(IDataDrop.InvalidCampaign.selector);
        drop.pause(keccak256("unknown"), false);
    }

    // A2 — bucket edge (T-02) and expiry boundary
    function test_Attack_BucketEdgeAllowsExactlyTwoCaps() public {
        uint256 edge = (block.timestamp / 3600 + 1) * 3600;
        vm.warp(edge - 1);
        vm.startPrank(ATTESTOR);
        for (uint256 i = 0; i < CAP; i++) {
            vm.expectEmit(true, true, true, true, address(drop));
            emit IDataDrop.Claimed(ID, key(ID, i), PRICE, uint64((edge - 1) / 3600));
            drop.claim(ID, key(ID, i));
        }
        vm.warp(edge);
        assertEq(drop.currentHourBucket(), uint64(edge / 3600));
        for (uint256 i = 0; i < CAP; i++) {
            vm.expectEmit(true, true, true, true, address(drop));
            emit IDataDrop.Claimed(ID, key(ID, 100 + i), PRICE, uint64(edge / 3600));
            drop.claim(ID, key(ID, 100 + i));
        }
        vm.expectRevert(IDataDrop.HourlyCap.selector);
        drop.claim(ID, key(ID, 200));
        vm.stopPrank();
        assertEq(usdc.balanceOf(PAYOUT), 2 * uint256(CAP) * PRICE);
    }

    function test_Attack_ClaimAtExpiresAtReverts() public {
        vm.warp(expiresAt - 1);
        _claim(ID, 1);
        vm.warp(expiresAt);
        vm.prank(ATTESTOR);
        vm.expectRevert(IDataDrop.CampaignExpired.selector);
        drop.claim(ID, key(ID, 2));
    }

    // A3 — replay and check order (T-03)
    function test_Attack_ReplaySameClaimKeyReverts() public {
        bytes32 k = key(ID, 1);
        vm.startPrank(ATTESTOR);
        drop.claim(ID, k);
        assertTrue(drop.claimed(ID, k));
        vm.expectRevert(IDataDrop.AlreadyClaimed.selector);
        drop.claim(ID, k);
        vm.stopPrank();
    }

    function test_Attack_ReplayIsReportedBeforeCapOrBudget() public {
        vm.startPrank(ATTESTOR);
        for (uint256 i = 0; i < CAP; i++) {
            drop.claim(ID, key(ID, i));
        }
        vm.expectRevert(IDataDrop.AlreadyClaimed.selector);
        drop.claim(ID, key(ID, 0));
        vm.stopPrank();
    }

    function test_Attack_CheckOrderPausedBeforeExpiredBeforeReplay() public {
        _claim(ID, 0);
        vm.prank(SPONSOR);
        drop.pause(ID, true);
        vm.warp(expiresAt);
        vm.startPrank(ATTESTOR);
        vm.expectRevert(IDataDrop.CampaignPaused.selector); // paused + expired + replay ⇒ CampaignPaused
        drop.claim(ID, key(ID, 0));
        vm.stopPrank();
        vm.prank(SPONSOR);
        drop.pause(ID, false);
        vm.prank(ATTESTOR);
        vm.expectRevert(IDataDrop.CampaignExpired.selector); // expired + replay ⇒ CampaignExpired
        drop.claim(ID, key(ID, 0));
    }

    function test_SameHumanDifferentCampaignIsAllowed() public {
        bytes32 id2 = keccak256("second-sponsor");
        _create(id2, BUDGET, PRICE, CAP, expiresAt);
        vm.startPrank(ATTESTOR);
        drop.claim(ID, key(ID, 1));
        drop.claim(id2, key(id2, 1));
        vm.stopPrank();
    }

    // A4 — id hijack (T-04)
    function test_Attack_CreateCampaignWithExistingIdReverts() public {
        usdc.mint(STRANGER, BUDGET);
        vm.startPrank(STRANGER);
        usdc.approve(address(drop), type(uint256).max);
        vm.expectRevert(IDataDrop.CampaignExists.selector);
        drop.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);
        vm.stopPrank();
        assertEq(drop.campaigns(ID).sponsor, SPONSOR);
    }

    function test_Attack_IdNotReusableAfterRefund() public {
        vm.warp(expiresAt + 1);
        vm.prank(SPONSOR);
        drop.refund(ID);
        vm.prank(SPONSOR);
        vm.expectRevert(IDataDrop.CampaignExists.selector);
        drop.createCampaign(ID, BUDGET, PRICE, CAP, uint64(block.timestamp + 1 days));
    }

    // A5 — authorisation matrix (T-05)
    function test_Attack_AuthorizationMatrix() public {
        bytes32 sid = keccak256("stranger-campaign");
        usdc.mint(STRANGER, BUDGET);
        vm.startPrank(STRANGER);
        usdc.approve(address(drop), type(uint256).max);
        drop.createCampaign(sid, BUDGET, PRICE, CAP, expiresAt);
        vm.stopPrank();
        vm.warp(expiresAt); // make refund otherwise eligible

        // attestor
        vm.startPrank(ATTESTOR);
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.refund(ID);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ATTESTOR));
        drop.setAttestor(ATTESTOR);
        vm.stopPrank();
        // sponsor of ID on the stranger's campaign
        vm.startPrank(SPONSOR);
        vm.expectRevert(IDataDrop.NotAttestor.selector);
        drop.claim(ID, key(ID, 1));
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.pause(sid, true);
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.pause(sid, false);
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.refund(sid);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, SPONSOR));
        drop.setAttestor(SPONSOR);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, SPONSOR));
        drop.associateHts(address(usdc));
        vm.stopPrank();
        // stranger on ID
        vm.startPrank(STRANGER);
        vm.expectRevert(IDataDrop.NotAttestor.selector);
        drop.claim(ID, key(ID, 1));
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.pause(ID, true);
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.refund(ID);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, STRANGER));
        drop.associateHts(address(usdc));
        vm.stopPrank();
        // owner
        vm.startPrank(OWNER);
        vm.expectRevert(IDataDrop.NotAttestor.selector);
        drop.claim(ID, key(ID, 1));
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.pause(ID, true);
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.pause(ID, false);
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.refund(ID);
        vm.expectRevert(IDataDrop.NotHedera.selector);
        drop.associateHts(address(usdc));
        vm.stopPrank();
        // the rightful sponsors can refund
        vm.prank(SPONSOR);
        drop.refund(ID);
        vm.prank(STRANGER);
        drop.refund(sid);
    }

    // A6 — refund rules (T-06)
    function test_Attack_RefundBeforeExpiryWithoutPauseReverts() public {
        vm.prank(SPONSOR);
        vm.expectRevert(IDataDrop.NotRefundable.selector);
        drop.refund(ID);
    }

    function test_Attack_PauseToggleDoesNotShortenThe24h() public {
        vm.startPrank(SPONSOR);
        drop.pause(ID, true);
        vm.warp(block.timestamp + 23 hours);
        drop.pause(ID, false);
        drop.pause(ID, true);
        assertEq(drop.campaigns(ID).pausedSince, uint64(block.timestamp));
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(IDataDrop.NotRefundable.selector);
        drop.refund(ID);
        vm.warp(block.timestamp + 22 hours);
        drop.refund(ID);
        vm.stopPrank();
        assertEq(usdc.balanceOf(SPONSOR), 10 * uint256(BUDGET));
    }

    function test_Attack_AttestorPauseStartsRefundClock() public {
        vm.prank(ATTESTOR);
        drop.pause(ID, true);
        vm.warp(block.timestamp + 24 hours);
        vm.prank(SPONSOR);
        drop.refund(ID);
        assertEq(usdc.balanceOf(SPONSOR), 10 * uint256(BUDGET));
    }

    function test_Attack_NoOpPauseDoesNotResetTheClock() public {
        vm.startPrank(SPONSOR);
        drop.pause(ID, true);
        uint64 t0 = drop.campaigns(ID).pausedSince;
        vm.warp(block.timestamp + 1 hours);
        drop.pause(ID, true);
        assertEq(drop.campaigns(ID).pausedSince, t0);
        vm.stopPrank();
        vm.prank(ATTESTOR);
        drop.pause(ID, true);
        assertEq(drop.campaigns(ID).pausedSince, t0);
    }

    function test_Attack_RefundAmountAfterPartialClaims() public {
        vm.startPrank(ATTESTOR);
        for (uint256 i = 0; i < 3; i++) {
            drop.claim(ID, key(ID, i));
        }
        vm.stopPrank();
        vm.warp(expiresAt + 1);
        vm.prank(SPONSOR);
        drop.refund(ID);
        assertEq(usdc.balanceOf(SPONSOR), 10 * uint256(BUDGET) - 3 * uint256(PRICE));
        IDataDrop.Campaign memory c = drop.campaigns(ID);
        assertEq(c.budget, c.spent);
        vm.prank(SPONSOR);
        vm.expectRevert(IDataDrop.NotRefundable.selector);
        drop.refund(ID);
        vm.prank(ATTESTOR);
        vm.expectRevert(IDataDrop.CampaignExpired.selector);
        drop.claim(ID, key(ID, 9));
    }

    function test_Attack_NonDivisibleBudget() public {
        bytes32 id = keccak256("odd");
        _create(id, 3 * uint128(PRICE) + 1, PRICE, CAP, expiresAt);
        for (uint256 i = 0; i < 3; i++) {
            _claim(id, i);
        }
        vm.prank(ATTESTOR);
        vm.expectRevert(IDataDrop.BudgetExhausted.selector);
        drop.claim(id, key(id, 3));
        vm.warp(expiresAt);
        uint256 before = usdc.balanceOf(SPONSOR);
        vm.prank(SPONSOR);
        drop.refund(id);
        assertEq(usdc.balanceOf(SPONSOR) - before, 1);
    }

    function test_Attack_FullySpentCampaignIsNotRefundable() public {
        bytes32 id = keccak256("spent");
        _create(id, uint128(PRICE), PRICE, CAP, expiresAt);
        _claim(id, 1);
        vm.warp(expiresAt);
        vm.prank(SPONSOR);
        vm.expectRevert(IDataDrop.NotRefundable.selector);
        drop.refund(id);
    }

    // A9 — LEDGER_ONLY and failing transferFrom (T-09)
    function test_LedgerOnlyMovesNoTokensAndSaysSo() public {
        vm.expectEmit(false, false, false, true);
        emit IDataDrop.ModeSet(true);
        DataDrop lo = new DataDrop(IERC20(address(0)), PAYOUT, ATTESTOR, OWNER);
        assertTrue(lo.ledgerOnly());
        assertEq(lo.usdc(), address(0));
        vm.prank(SPONSOR);
        lo.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);
        vm.prank(ATTESTOR);
        lo.claim(ID, key(ID, 1));
        assertEq(usdc.balanceOf(PAYOUT), 0);
        assertEq(lo.campaigns(ID).spent, PRICE);
    }

    function test_Attack_TokenModeFailingTransferFromReverts() public {
        vm.prank(STRANGER);
        vm.expectRevert();
        drop.createCampaign(keccak256("x"), BUDGET, PRICE, CAP, expiresAt);
        assertEq(drop.campaigns(keccak256("x")).sponsor, address(0));
    }

    // A15 — settlement front-run facts are covered in MockUSDC3009.t.sol.

    // A18 — rotation drill (T-01, THREAT-MODEL §6.7)
    function test_Drill_PauseRotateUnpause() public {
        address newAttestor = makeAddr("attestor-2");
        vm.startPrank(ATTESTOR);
        for (uint256 i = 0; i < CAP - 1; i++) {
            drop.claim(ID, key(ID, i));
        }
        vm.stopPrank();
        vm.prank(ATTESTOR);
        drop.pause(ID, true);
        vm.prank(ATTESTOR);
        vm.expectRevert(IDataDrop.CampaignPaused.selector);
        drop.claim(ID, key(ID, 50));
        vm.prank(OWNER);
        drop.setAttestor(newAttestor);
        vm.prank(ATTESTOR);
        vm.expectRevert(IDataDrop.NotAttestor.selector);
        drop.claim(ID, key(ID, 51));
        vm.prank(ATTESTOR);
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.pause(ID, false);
        vm.prank(SPONSOR);
        drop.pause(ID, false);
        vm.prank(newAttestor);
        drop.claim(ID, key(ID, 52));
        // the old key can still not even pause any more (it is no longer the attestor)
        vm.prank(ATTESTOR);
        vm.expectRevert(IDataDrop.NotSponsor.selector);
        drop.pause(ID, true);
    }
}
