// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {DataDrop} from "../../src/DataDrop.sol";
import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";
import {MockUSDC3009} from "../../src/MockUSDC3009.sol";
import {DataDropHandler} from "./handlers/DataDropHandler.sol";

/// @notice Stateful properties of DataDrop (brief §6 + wave1-contracts.md A7). Amounts are 6-decimal base units.
contract DataDropInvariantTest is Test {
    MockUSDC3009 internal usdc;
    DataDrop internal drop;
    DataDropHandler internal handler;
    address internal constant OWNER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address internal constant PAYOUT = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant ATTESTOR = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    function setUp() public {
        vm.warp(1_762_200_000);
        usdc = new MockUSDC3009();
        drop = new DataDrop(IERC20(address(usdc)), PAYOUT, ATTESTOR, OWNER);
        handler = new DataDropHandler(drop, usdc, OWNER, PAYOUT);
        // seed one campaign so every run exercises claims
        handler.createCampaign(1, 20 * 500_000, 500_000, 5, 6 hours);

        bytes4[] memory selectors = new bytes4[](10);
        selectors[0] = handler.createCampaign.selector;
        selectors[1] = handler.claimFresh.selector;
        selectors[2] = handler.claimFresh.selector; // weight fresh claims ×2
        selectors[3] = handler.claimRepeat.selector;
        selectors[4] = handler.claimAsOldAttestor.selector;
        selectors[5] = handler.claimAsStranger.selector;
        selectors[6] = handler.pauseAs.selector;
        selectors[7] = handler.refund.selector;
        selectors[8] = handler.warp.selector;
        selectors[9] = handler.rotateAttestor.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function _campaign(uint256 i) internal view returns (bytes32 id, IDataDrop.Campaign memory c) {
        id = handler.ids(i);
        c = drop.campaigns(id);
    }

    function invariant_SpentNeverExceedsBudget() public view {
        for (uint256 i = 0; i < handler.idCount(); i++) {
            (, IDataDrop.Campaign memory c) = _campaign(i);
            assertLe(c.spent, c.budget);
        }
    }

    function invariant_SpentEqualsClaimsTimesPrice() public view {
        for (uint256 i = 0; i < handler.idCount(); i++) {
            (bytes32 id, IDataDrop.Campaign memory c) = _campaign(i);
            assertEq(uint256(c.spent), handler.ghostClaims(id) * c.pricePerClaim);
        }
    }

    function invariant_TokenBalanceMatchesLedger() public view {
        uint256 held;
        for (uint256 i = 0; i < handler.idCount(); i++) {
            (, IDataDrop.Campaign memory c) = _campaign(i);
            held += c.budget - c.spent;
        }
        assertEq(usdc.balanceOf(address(drop)), held);
    }

    function invariant_PaidInBucketLeqCap() public view {
        for (uint256 i = 0; i < handler.idCount(); i++) {
            (bytes32 id, IDataDrop.Campaign memory c) = _campaign(i);
            uint64[] memory buckets = handler.bucketsOf(id);
            for (uint256 j = 0; j < buckets.length; j++) {
                assertLe(
                    uint256(drop.claimsInHour(id, buckets[j])) * c.pricePerClaim,
                    uint256(c.claimsPerHour) * c.pricePerClaim
                );
            }
        }
    }

    function invariant_ClaimsInHourNeverExceedsCapForAnyBucket() public view {
        for (uint256 i = 0; i < handler.idCount(); i++) {
            (bytes32 id, IDataDrop.Campaign memory c) = _campaign(i);
            uint64[] memory buckets = handler.bucketsOf(id);
            uint256 sum;
            for (uint256 j = 0; j < buckets.length; j++) {
                uint32 n = drop.claimsInHour(id, buckets[j]);
                assertLe(n, c.claimsPerHour);
                sum += n;
            }
            assertEq(sum, handler.ghostClaims(id)); // every successful claim landed in a recorded bucket
        }
    }

    function invariant_ClaimKeyUniquePerCampaign() public view {
        assertEq(handler.ghostDoubleClaims(), 0);
    }

    function invariant_ClaimedFlagsMonotonic() public view {
        for (uint256 i = 0; i < handler.idCount(); i++) {
            bytes32 id = handler.ids(i);
            bytes32[] memory keys = handler.keysOf(id);
            for (uint256 j = 0; j < keys.length; j++) {
                assertTrue(drop.claimed(id, keys[j]));
            }
        }
    }

    function invariant_PayoutEqualsSumSpent() public view {
        uint256 spent;
        for (uint256 i = 0; i < handler.idCount(); i++) {
            (, IDataDrop.Campaign memory c) = _campaign(i);
            spent += c.spent;
        }
        assertEq(usdc.balanceOf(PAYOUT), spent);
    }

    function invariant_TotalPaidOutLeqTotalBudgets() public view {
        assertLe(usdc.balanceOf(PAYOUT), handler.ghostFunded());
    }

    function invariant_RefundedPlusHeldPlusPaidEqualsFunded() public view {
        assertEq(
            handler.ghostRefunded() + usdc.balanceOf(address(drop)) + usdc.balanceOf(PAYOUT), handler.ghostFunded()
        );
    }

    function invariant_OldAttestorNeverSucceedsAfterRotation() public view {
        assertEq(handler.ghostOldAttestorSuccesses(), 0);
        assertEq(handler.ghostStrangerSuccesses(), 0);
    }
}
