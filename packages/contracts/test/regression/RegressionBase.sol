// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {DataDrop} from "../../src/DataDrop.sol";
import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";
import {MockUSDC3009} from "../../src/MockUSDC3009.sol";

/// @notice Fixture for the THREAT-MODEL §5.12 regression files (`T<nn>_*.t.sol`). Each red-team finding RT-C-0x that
///         was fixed has its attack test here, flipped to assert the fixed behaviour. Amounts are 6-decimal USDC.
abstract contract RegressionBase is Test {
    address internal constant ROLE_OWNER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266; // Anvil #0
    address internal constant ROLE_PAYOUT = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // #1
    address internal constant ROLE_ATTESTOR = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; // #2
    address internal constant ROLE_SPONSOR = 0x90F79bf6EB2c4f870365E785982E1f101E93b906; // #3
    address internal constant ROLE_STRANGER = 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955; // #7

    uint128 internal constant FIVE_HUNDRED_USD = 500_000_000;
    uint96 internal constant FIFTY_CENTS = 500_000;
    uint32 internal constant PER_HOUR = 5;

    MockUSDC3009 internal token;
    DataDrop internal tokenDrop; // token mode
    DataDrop internal ledgerDrop; // LEDGER_ONLY, nobody allow-listed yet
    uint64 internal deadline;

    function setUp() public virtual {
        vm.warp(1_762_200_000);
        token = new MockUSDC3009();
        tokenDrop = new DataDrop(IERC20(address(token)), ROLE_PAYOUT, ROLE_ATTESTOR, ROLE_OWNER);
        ledgerDrop = new DataDrop(IERC20(address(0)), ROLE_PAYOUT, ROLE_ATTESTOR, ROLE_OWNER);
        deadline = uint64(block.timestamp + 7 days);
    }

    /// Mints `amount` to `who`, approves `d` and creates campaign `id` as `who` (token mode).
    function _fund(DataDrop d, address who, bytes32 id, uint128 amount, uint96 price, uint32 cap) internal {
        token.mint(who, amount);
        vm.startPrank(who);
        token.approve(address(d), amount);
        d.createCampaign(id, amount, price, cap, deadline);
        vm.stopPrank();
    }

    /// Per-campaign pseudonym as octroi computes it (the HMAC part is opaque here).
    function _humanKey(bytes32 id, uint256 n) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(id, keccak256(abi.encodePacked("regression-human", n))));
    }

    /// Calls `data` on `target` as `caller`; returns success and the 4-byte selector of the revert (0 on success).
    function _try(address target, address caller, bytes memory data) internal returns (bool ok, bytes4 sel) {
        vm.prank(caller);
        bytes memory ret;
        (ok, ret) = target.call(data);
        if (!ok && ret.length >= 4) sel = bytes4(ret);
    }

    function _create(bytes32 id, uint128 amount, uint96 price, uint32 cap) internal view returns (bytes memory) {
        return abi.encodeCall(IDataDrop.createCampaign, (id, amount, price, cap, deadline));
    }
}
