// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {DataDrop} from "../../src/DataDrop.sol";
import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";
import {MockUSDC3009} from "../../src/MockUSDC3009.sol";

/// @notice Shared red-team fixture: Anvil roles (wave1-contracts.md §0), token-mode `drop` + LEDGER_ONLY `ledger`.
abstract contract RT_Base is Test {
    MockUSDC3009 internal usdc;
    DataDrop internal drop;
    DataDrop internal ledger;

    address internal owner = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266; // #0
    address internal payout = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // #1
    address internal attestor = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; // #2
    address internal sponsor = 0x90F79bf6EB2c4f870365E785982E1f101E93b906; // #3
    address internal stranger = 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955; // #7

    bytes32 internal constant ID = keccak256("demo-welcome");
    uint128 internal constant BUDGET = 500_000_000; // $500
    uint96 internal constant PRICE = 500_000; // $0.50
    uint32 internal constant CAP = 5;
    uint64 internal expiresAt;

    function setUp() public virtual {
        vm.warp(1_762_200_000);
        usdc = new MockUSDC3009();
        drop = new DataDrop(IERC20(address(usdc)), payout, attestor, owner);
        ledger = new DataDrop(IERC20(address(0)), payout, attestor, owner);
        expiresAt = uint64(block.timestamp + 7 days);
        usdc.mint(sponsor, 10 * uint256(BUDGET));
        vm.startPrank(sponsor);
        usdc.approve(address(drop), type(uint256).max);
        drop.createCampaign(ID, BUDGET, PRICE, CAP, expiresAt);
        vm.stopPrank();
    }

    function key(bytes32 id, uint256 i) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(id, keccak256(abi.encodePacked("cck", i))));
    }

    function _sel(bytes memory ret) internal pure returns (bytes4) {
        if (ret.length < 4) return bytes4(0xffffffff);
        return bytes4(ret);
    }
}
