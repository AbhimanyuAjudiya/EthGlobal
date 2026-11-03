// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";
import {RegressionBase} from "./RegressionBase.sol";

/// @notice T-07 (budget accounting) and RT-C-07 (overflow reported as Panic instead of BudgetExhausted).
contract T07_BudgetAccountingTest is RegressionBase {
    bytes32 internal constant BIG = keccak256("near-uint128");

    function setUp() public override {
        super.setUp();
        vm.prank(ROLE_OWNER);
        ledgerDrop.setLedgerSponsor(ROLE_SPONSOR, true);
    }

    /// RT-C-07 (was test_RT_MaxBudgetAndPriceNoOverflow_RTFINDING).
    function test_Regression_RTC07_MaxBudgetAndPriceReportsBudgetExhausted() public {
        uint96 p = type(uint96).max;
        uint128 budget = type(uint128).max;
        vm.prank(ROLE_SPONSOR);
        ledgerDrop.createCampaign(BIG, budget, p, type(uint32).max, deadline);
        // fast-forward spent to exactly one claim before the end (Campaign slot = keccak(id, 3); spent = high half of +1)
        bytes32 base = keccak256(abi.encode(BIG, uint256(3)));
        uint128 spent = budget - p;
        vm.store(address(ledgerDrop), bytes32(uint256(base) + 1), bytes32((uint256(spent) << 128) | uint256(budget)));
        vm.startPrank(ROLE_ATTESTOR);
        ledgerDrop.claim(BIG, _humanKey(BIG, 1));
        assertEq(ledgerDrop.campaigns(BIG).spent, budget);
        vm.expectRevert(IDataDrop.BudgetExhausted.selector); // not Panic(0x11)
        ledgerDrop.claim(BIG, _humanKey(BIG, 2));
        vm.stopPrank();
    }

    function testFuzz_NoPanicAtTheTopOfTheRange(uint96 price, uint128 spent) public {
        price = uint96(bound(price, 1, type(uint96).max));
        uint128 budget = type(uint128).max;
        spent = uint128(bound(spent, budget - price + 1, budget)); // any remainder smaller than one price
        vm.prank(ROLE_SPONSOR);
        ledgerDrop.createCampaign(BIG, budget, price, type(uint32).max, deadline);
        bytes32 base = keccak256(abi.encode(BIG, uint256(3)));
        vm.store(address(ledgerDrop), bytes32(uint256(base) + 1), bytes32((uint256(spent) << 128) | uint256(budget)));
        vm.prank(ROLE_ATTESTOR);
        vm.expectRevert(IDataDrop.BudgetExhausted.selector);
        ledgerDrop.claim(BIG, _humanKey(BIG, 0));
    }

    function test_ExactBudgetIsFullySpendable() public {
        bytes32 id = keccak256("exact");
        _fund(tokenDrop, ROLE_SPONSOR, id, 3 * uint128(FIFTY_CENTS), FIFTY_CENTS, PER_HOUR);
        vm.startPrank(ROLE_ATTESTOR);
        for (uint256 i = 0; i < 3; i++) {
            tokenDrop.claim(id, _humanKey(id, i));
        }
        vm.expectRevert(IDataDrop.BudgetExhausted.selector);
        tokenDrop.claim(id, _humanKey(id, 3));
        vm.stopPrank();
        assertEq(token.balanceOf(ROLE_PAYOUT), 3 * uint256(FIFTY_CENTS));
    }
}
