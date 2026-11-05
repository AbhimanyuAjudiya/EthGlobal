// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {DataDrop} from "../../../src/DataDrop.sol";
import {IDataDrop} from "../../../src/interfaces/IDataDrop.sol";
import {MockUSDC3009} from "../../../src/MockUSDC3009.sol";

/// @notice Drives DataDrop through random sequences: ≤ 3 campaigns, fresh and repeated claim keys, pause toggles by
///         sponsor/attestor/stranger, warps, refunds, attestor rotations and claims by rotated-out attestors. Ghost
///         variables record what *should* be true so the invariant suite can compare. Amounts are 6-decimal.
contract DataDropHandler is Test {
    DataDrop public immutable drop;
    MockUSDC3009 public immutable usdc;
    address public immutable owner;
    address public immutable payout;
    address public immutable stranger = makeAddr("stranger");
    address[2] internal sponsors = [makeAddr("sponsorA"), makeAddr("sponsorB")];

    bytes32[] public ids;
    mapping(bytes32 => uint256) public ghostClaims;
    mapping(bytes32 => bytes32[]) internal _keys;
    mapping(bytes32 => uint64[]) internal _buckets;
    mapping(bytes32 => mapping(uint64 => bool)) internal _bucketSeen;

    address[] public oldAttestors;
    uint256 public ghostFunded;
    uint256 public ghostRefunded;
    uint256 public ghostOldAttestorSuccesses;
    uint256 public ghostDoubleClaims;
    uint256 public ghostStrangerSuccesses;
    uint256 internal _keyNonce;
    uint256 internal _attestorNonce;

    mapping(bytes4 => uint256) public calls;

    constructor(DataDrop drop_, MockUSDC3009 usdc_, address owner_, address payout_) {
        drop = drop_;
        usdc = usdc_;
        owner = owner_;
        payout = payout_;
    }

    // ───────────────────────────── views for the invariant suite ─────────────────────────────

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function keysOf(bytes32 id) external view returns (bytes32[] memory) {
        return _keys[id];
    }

    function bucketsOf(bytes32 id) external view returns (uint64[] memory) {
        return _buckets[id];
    }

    function oldAttestorCount() external view returns (uint256) {
        return oldAttestors.length;
    }

    // ───────────────────────────── actions ─────────────────────────────

    function _pick(uint256 seed) internal view returns (bytes32 id, bool ok) {
        if (ids.length == 0) return (bytes32(0), false);
        return (ids[seed % ids.length], true);
    }

    function createCampaign(uint256 seed, uint128 budget, uint96 price, uint32 cap, uint32 ttl) external {
        calls[this.createCampaign.selector]++;
        if (ids.length >= 3) return;
        price = uint96(bound(price, 1, 2_000_000)); // ≤ $2
        budget = uint128(bound(budget, price, uint256(price) * 40 + 3)); // up to 40 claims (+ dust)
        cap = uint32(bound(cap, 1, 6));
        uint64 expiresAt = uint64(block.timestamp + bound(ttl, 1 hours, 12 hours));
        bytes32 id = keccak256(abi.encode("campaign", ids.length, seed));
        address sponsor = sponsors[seed % 2];
        usdc.mint(sponsor, budget);
        vm.startPrank(sponsor);
        usdc.approve(address(drop), budget);
        drop.createCampaign(id, budget, price, cap, expiresAt);
        vm.stopPrank();
        ids.push(id);
        ghostFunded += budget;
    }

    function _recordSuccess(bytes32 id, bytes32 k) internal {
        ghostClaims[id]++;
        _keys[id].push(k);
        uint64 b = drop.currentHourBucket();
        if (!_bucketSeen[id][b]) {
            _bucketSeen[id][b] = true;
            _buckets[id].push(b);
        }
    }

    function claimFresh(uint256 seed) external {
        calls[this.claimFresh.selector]++;
        (bytes32 id, bool ok) = _pick(seed);
        if (!ok) return;
        bytes32 k = keccak256(abi.encode(id, "fresh", _keyNonce++));
        vm.prank(drop.attestor());
        try drop.claim(id, k) {
            _recordSuccess(id, k);
        } catch {}
    }

    function claimRepeat(uint256 seed, uint256 keySeed) external {
        calls[this.claimRepeat.selector]++;
        (bytes32 id, bool ok) = _pick(seed);
        if (!ok || _keys[id].length == 0) return;
        bytes32 k = _keys[id][keySeed % _keys[id].length];
        vm.prank(drop.attestor());
        try drop.claim(id, k) {
            ghostDoubleClaims++;
        } catch {}
    }

    function claimAsOldAttestor(uint256 seed, uint256 who) external {
        calls[this.claimAsOldAttestor.selector]++;
        (bytes32 id, bool ok) = _pick(seed);
        if (!ok || oldAttestors.length == 0) return;
        address old = oldAttestors[who % oldAttestors.length];
        if (old == drop.attestor()) return;
        bytes32 k = keccak256(abi.encode(id, "old", _keyNonce++));
        vm.prank(old);
        try drop.claim(id, k) {
            ghostOldAttestorSuccesses++;
        } catch {}
    }

    function claimAsStranger(uint256 seed) external {
        calls[this.claimAsStranger.selector]++;
        (bytes32 id, bool ok) = _pick(seed);
        if (!ok) return;
        vm.prank(stranger);
        try drop.claim(id, keccak256(abi.encode(id, "stranger", _keyNonce++))) {
            ghostStrangerSuccesses++;
        } catch {}
    }

    function pauseAs(uint256 seed, uint8 who, bool p) external {
        calls[this.pauseAs.selector]++;
        (bytes32 id, bool ok) = _pick(seed);
        if (!ok) return;
        address caller;
        uint8 w = who % 3;
        if (w == 0) caller = drop.campaigns(id).sponsor;
        else if (w == 1) caller = drop.attestor();
        else caller = stranger;
        bool before = drop.campaigns(id).paused;
        vm.prank(caller);
        try drop.pause(id, p) {
            // only the sponsor can unpause
            if (before && !p) assertEq(caller, drop.campaigns(id).sponsor, "non-sponsor unpaused");
        } catch {}
    }

    function refund(uint256 seed) external {
        calls[this.refund.selector]++;
        (bytes32 id, bool ok) = _pick(seed);
        if (!ok) return;
        IDataDrop.Campaign memory c = drop.campaigns(id);
        uint256 before = usdc.balanceOf(c.sponsor);
        vm.prank(c.sponsor);
        try drop.refund(id) {
            uint256 got = usdc.balanceOf(c.sponsor) - before;
            assertEq(got, c.budget - c.spent, "refund amount");
            ghostRefunded += got;
        } catch {}
    }

    function warp(uint256 secs) external {
        calls[this.warp.selector]++;
        vm.warp(block.timestamp + bound(secs, 0, 3 hours));
    }

    function rotateAttestor(uint256 seed) external {
        calls[this.rotateAttestor.selector]++;
        address next = makeAddr(string.concat("attestor-", vm.toString(_attestorNonce++), "-", vm.toString(seed % 7)));
        oldAttestors.push(drop.attestor());
        vm.prank(owner);
        drop.setAttestor(next);
    }
}
