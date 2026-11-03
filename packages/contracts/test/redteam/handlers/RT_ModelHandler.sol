// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {DataDrop} from "../../../src/DataDrop.sol";
import {IDataDrop} from "../../../src/interfaces/IDataDrop.sol";
import {MockUSDC3009} from "../../../src/MockUSDC3009.sol";

/// @notice Model-based red-team handler. Every action is applied to a token-mode DataDrop AND a LEDGER_ONLY twin with
///         identical arguments. A reference model (written from INTERFACES §6.1 + the binding check order, not from the
///         code) predicts the exact revert selector. A separate event-sourced "indexer" rebuilds campaign state from
///         the token drop's logs only. Counters record: model mismatches, token/ledger parity breaks (outcome, events,
///         state), indexer divergence. Inputs deliberately hit degenerate edges: price 0/1, cap 0/1/uint32.max,
///         budget < price / == price / non-multiple, expiresAt past/now, id collisions across sponsors, refund while
///         paused < 24 h / exactly 24 h, refund twice, warps to bucket edge −1 / edge / expiresAt.
contract RT_ModelHandler is Test {
    struct M {
        address sponsor;
        uint96 price;
        uint128 budget;
        uint128 spent;
        uint32 cap;
        uint64 expiresAt;
        uint64 pausedSince;
        bool paused;
    }

    /// Indexer view rebuilt from events only.
    struct Ix {
        bool exists;
        address sponsor;
        uint128 budget;
        uint128 paidSum;
        uint128 refunded;
        uint256 claims;
        bool paused;
    }

    DataDrop public immutable tokenDrop;
    DataDrop public immutable ledgerDrop;
    MockUSDC3009 public immutable usdc;
    address public immutable owner;
    address public immutable payout;
    address public immutable stranger = makeAddr("rt-stranger");
    address[3] internal sponsors = [makeAddr("rt-sA"), makeAddr("rt-sB"), makeAddr("rt-sC")];

    mapping(bytes32 => M) internal _m;
    mapping(bytes32 => mapping(bytes32 => bool)) internal _mClaimed;
    mapping(bytes32 => mapping(uint64 => uint32)) internal _mInHour;
    mapping(bytes32 => uint64[]) internal _buckets;
    mapping(bytes32 => mapping(uint64 => bool)) internal _bucketSeen;
    mapping(bytes32 => bytes32[]) internal _keys;
    mapping(bytes32 => Ix) internal _ix;
    bytes32[] public ids;
    address[] public oldAttestors;

    uint256 public mismatches;
    uint256 public parityBreaks;
    uint256 public indexerBreaks;
    string public lastBreak;
    uint256 public ghostFunded;
    uint256 public ghostRefunded;
    uint256 public ghostPaid;
    uint256 public successes;
    mapping(address => uint256) public ghostBalance; // expected USDC balance of each sponsor
    uint256 internal _nonce;

    bytes32 internal constant TOPIC_CREATED =
        keccak256("CampaignCreated(bytes32,address,uint128,uint96,uint32,uint64)");
    bytes32 internal constant TOPIC_CLAIMED = keccak256("Claimed(bytes32,bytes32,uint96,uint64)");
    bytes32 internal constant TOPIC_PAUSED = keccak256("Paused(bytes32,bool,address)");
    bytes32 internal constant TOPIC_REFUNDED = keccak256("Refunded(bytes32,uint128)");

    constructor(DataDrop t, DataDrop l, MockUSDC3009 u, address owner_, address payout_) {
        tokenDrop = t;
        ledgerDrop = l;
        usdc = u;
        owner = owner_;
        payout = payout_;
    }

    // ───────────────────────────── views ─────────────────────────────

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function model(bytes32 id) external view returns (M memory) {
        return _m[id];
    }

    function indexer(bytes32 id) external view returns (Ix memory) {
        return _ix[id];
    }

    function bucketsOf(bytes32 id) external view returns (uint64[] memory) {
        return _buckets[id];
    }

    function modelInHour(bytes32 id, uint64 b) external view returns (uint32) {
        return _mInHour[id][b];
    }

    function sponsorAt(uint256 i) external view returns (address) {
        return sponsors[i];
    }

    // ───────────────────────────── plumbing ─────────────────────────────

    function _brk(uint256 which, string memory tag) internal {
        if (which == 0) mismatches++;
        else if (which == 1) parityBreaks++;
        else indexerBreaks++;
        lastBreak = tag;
    }

    function _call(DataDrop d, address caller, bytes memory data) internal returns (bytes4 sel, Vm.Log[] memory logs) {
        vm.recordLogs();
        vm.prank(caller);
        (bool ok, bytes memory ret) = address(d).call(data);
        Vm.Log[] memory all = vm.getRecordedLogs();
        uint256 n;
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].emitter == address(d)) n++;
        }
        logs = new Vm.Log[](n);
        n = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].emitter == address(d)) logs[n++] = all[i];
        }
        if (ok) return (bytes4(0), logs);
        sel = ret.length >= 4 ? bytes4(ret) : bytes4(0xffffffff);
    }

    /// Runs `data` on both drops as `caller`, compares outcome + events with each other and outcome with `expected`.
    function _both(address caller, bytes memory data, bytes4 expected, string memory tag) internal returns (bool) {
        (bytes4 a, Vm.Log[] memory la) = _call(tokenDrop, caller, data);
        (bytes4 b, Vm.Log[] memory lb) = _call(ledgerDrop, caller, data);
        if (a != b) _brk(1, string.concat(tag, ": outcome differs token vs ledger"));
        if (a != expected) _brk(0, string.concat(tag, ": selector != model"));
        if (la.length != lb.length) {
            _brk(1, string.concat(tag, ": event count differs"));
        } else {
            for (uint256 i = 0; i < la.length; i++) {
                if (keccak256(abi.encode(la[i].topics)) != keccak256(abi.encode(lb[i].topics))) {
                    _brk(1, string.concat(tag, ": topics differ"));
                }
                if (keccak256(la[i].data) != keccak256(lb[i].data)) _brk(1, string.concat(tag, ": data differs"));
            }
        }
        _index(la);
        if (a == bytes4(0)) successes++;
        return a == bytes4(0);
    }

    /// The event-sourced indexer: what an off-chain reader can know from DataDrop logs alone.
    function _index(Vm.Log[] memory logs) internal {
        for (uint256 i = 0; i < logs.length; i++) {
            bytes32 t0 = logs[i].topics[0];
            bytes32 id = logs[i].topics.length > 1 ? logs[i].topics[1] : bytes32(0);
            Ix storage x = _ix[id];
            if (t0 == TOPIC_CREATED) {
                (uint128 budget,,,) = abi.decode(logs[i].data, (uint128, uint96, uint32, uint64));
                if (x.exists) _brk(2, "indexer: CampaignCreated twice for one id");
                x.exists = true;
                x.sponsor = address(uint160(uint256(logs[i].topics[2])));
                x.budget = budget;
            } else if (t0 == TOPIC_CLAIMED) {
                (uint96 paid, uint64 bucket) = abi.decode(logs[i].data, (uint96, uint64));
                if (bucket != uint64(block.timestamp / 3600)) _brk(2, "indexer: Claimed.hourBucket != now/3600");
                x.paidSum += paid;
                x.claims++;
            } else if (t0 == TOPIC_PAUSED) {
                (bool p, address by) = abi.decode(logs[i].data, (bool, address));
                if (by == address(0)) _brk(2, "indexer: Paused.by zero");
                x.paused = p;
            } else if (t0 == TOPIC_REFUNDED) {
                uint128 amt = abi.decode(logs[i].data, (uint128));
                x.refunded += amt;
            }
        }
    }

    function _pick(uint256 seed) internal view returns (bytes32) {
        return ids[seed % ids.length];
    }

    // ───────────────────────────── actions ─────────────────────────────

    function create(uint256 seed, uint128 budget, uint96 price, uint32 cap, uint32 ttl) external {
        bytes32 id;
        if (ids.length > 0 && seed % 4 == 0) {
            id = _pick(seed >> 2); // collision attempt, usually by a different sponsor
        } else {
            if (ids.length >= 6) return;
            id = keccak256(abi.encode("rt-id", _nonce++));
        }
        address s = sponsors[(seed >> 4) % 3];

        uint256 pf = (seed >> 8) % 5;
        if (pf == 0) price = 0;
        else if (pf == 1) price = 1;
        else price = uint96(bound(price, 1, 3_000_000));
        uint256 bf = (seed >> 12) % 5;
        if (bf == 0) budget = price == 0 ? 0 : price - 1;
        else if (bf == 1) budget = price;
        else budget = uint128(bound(budget, price, uint256(price) * 25 + 7));
        uint256 cf = (seed >> 16) % 6;
        if (cf == 0) cap = 0;
        else if (cf == 1) cap = type(uint32).max;
        else if (cf == 2) cap = 1;
        else cap = uint32(bound(cap, 1, 4));
        uint256 ef = (seed >> 20) % 6;
        uint64 exp;
        if (ef == 0) exp = uint64(block.timestamp);
        else if (ef == 1) exp = uint64(block.timestamp - 1);
        else exp = uint64(block.timestamp + bound(ttl, 1, 96 hours));

        bytes4 expected;
        if (_m[id].sponsor != address(0)) {
            expected = IDataDrop.CampaignExists.selector;
        } else if (budget < price || price == 0 || cap == 0 || exp <= block.timestamp) {
            expected = IDataDrop.InvalidCampaign.selector;
        }

        usdc.mint(s, budget);
        ghostBalance[s] += budget;
        vm.prank(s);
        usdc.approve(address(tokenDrop), budget);
        bool ok = _both(s, abi.encodeCall(IDataDrop.createCampaign, (id, budget, price, cap, exp)), expected, "create");
        if (ok && expected == bytes4(0)) {
            _m[id] = M(s, price, budget, 0, cap, exp, 0, false);
            ids.push(id);
            ghostFunded += budget;
            ghostBalance[s] -= budget;
        }
    }

    function claim(uint256 seed, uint8 km) external {
        if (ids.length == 0) return;
        bytes32 id = km % 11 == 0 ? keccak256(abi.encode("rt-unknown", _nonce++)) : _pick(seed);
        bytes32 k = (km % 3 == 0 && _keys[id].length > 0)
            ? _keys[id][(seed >> 8) % _keys[id].length]
            : keccak256(abi.encode("rt-key", _nonce++));
        M storage c = _m[id];
        uint64 b = uint64(block.timestamp / 3600);
        bytes4 expected;
        if (c.sponsor == address(0)) expected = IDataDrop.InvalidCampaign.selector;
        else if (c.paused) expected = IDataDrop.CampaignPaused.selector;
        else if (block.timestamp >= c.expiresAt) expected = IDataDrop.CampaignExpired.selector;
        else if (_mClaimed[id][k]) expected = IDataDrop.AlreadyClaimed.selector;
        else if (_mInHour[id][b] >= c.cap) expected = IDataDrop.HourlyCap.selector;
        else if (uint256(c.spent) + c.price > c.budget) expected = IDataDrop.BudgetExhausted.selector;

        bool ok = _both(tokenDrop.attestor(), abi.encodeCall(IDataDrop.claim, (id, k)), expected, "claim");
        if (ok && expected == bytes4(0)) {
            _mClaimed[id][k] = true;
            _mInHour[id][b]++;
            c.spent += c.price;
            ghostPaid += c.price;
            _keys[id].push(k);
            if (!_bucketSeen[id][b]) {
                _bucketSeen[id][b] = true;
                _buckets[id].push(b);
            }
        }
    }

    function claimAsOld(uint256 seed, uint256 who) external {
        if (ids.length == 0 || oldAttestors.length == 0) return;
        address old = oldAttestors[who % oldAttestors.length];
        if (old == tokenDrop.attestor()) return;
        _both(
            old,
            abi.encodeCall(IDataDrop.claim, (_pick(seed), keccak256(abi.encode("rt-old", _nonce++)))),
            IDataDrop.NotAttestor.selector,
            "claimAsOld"
        );
    }

    function pause(uint256 seed, uint8 who, bool p) external {
        if (ids.length == 0) return;
        bytes32 id = who % 13 == 0 ? keccak256(abi.encode("rt-unknown", _nonce++)) : _pick(seed);
        M storage c = _m[id];
        address caller;
        uint8 w = who % 6;
        if (w == 0 || w == 1) caller = c.sponsor == address(0) ? stranger : c.sponsor;
        else if (w == 2) caller = tokenDrop.attestor();
        else if (w == 3) caller = stranger;
        else if (w == 4) caller = owner;
        else caller = oldAttestors.length > 0 ? oldAttestors[seed % oldAttestors.length] : stranger;

        bytes4 expected;
        if (c.sponsor == address(0)) expected = IDataDrop.InvalidCampaign.selector;
        else if (caller != c.sponsor && !(caller == tokenDrop.attestor() && p)) expected = IDataDrop.NotSponsor.selector;

        bool ok = _both(caller, abi.encodeCall(IDataDrop.pause, (id, p)), expected, "pause");
        if (ok && expected == bytes4(0)) {
            if (p && !c.paused) {
                c.paused = true;
                c.pausedSince = uint64(block.timestamp);
            } else if (!p && c.paused) {
                c.paused = false;
                c.pausedSince = 0;
            }
        }
    }

    function refund(uint256 seed, uint8 who) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        M storage c = _m[id];
        // half the time, land exactly on the 24 h pause boundary (−1 s or 0 s) before refunding
        if (c.paused && who % 2 == 1) {
            uint256 edge = uint256(c.pausedSince) + 24 hours - ((who >> 1) % 2);
            if (edge > block.timestamp) vm.warp(edge);
        }
        address caller = who % 4 == 0 ? sponsors[(seed >> 3) % 3] : c.sponsor; // sometimes another sponsor
        if (who % 7 == 0) caller = tokenDrop.attestor();
        bytes4 expected;
        uint128 amount = c.budget - c.spent;
        if (caller != c.sponsor) {
            expected = IDataDrop.NotSponsor.selector;
        } else if (!(block.timestamp >= c.expiresAt || (c.paused && block.timestamp - c.pausedSince >= 24 hours))) {
            expected = IDataDrop.NotRefundable.selector;
        } else if (amount == 0) {
            expected = IDataDrop.NotRefundable.selector;
        }

        bool ok = _both(caller, abi.encodeCall(IDataDrop.refund, (id)), expected, "refund");
        if (ok && expected == bytes4(0)) {
            c.budget = c.spent;
            ghostRefunded += amount;
            ghostBalance[c.sponsor] += amount;
        }
    }

    function warp(uint256 mode, uint256 secs) external {
        uint256 m = mode % 7;
        uint256 t = block.timestamp;
        if (m == 0) {
            t += bound(secs, 1, 2 hours);
        } else if (m == 1) {
            t = (t / 3600 + 1) * 3600 - 1; // bucket edge − 1
        } else if (m == 2) {
            t = (t / 3600 + 1) * 3600; // bucket edge
        } else if (m == 3) {
            t += 24 hours;
        } else if (m == 4 && ids.length > 0) {
            uint64 e = _m[_pick(secs)].expiresAt;
            if (e > t) t = e; // exactly expiresAt
        } else if (m == 5 && ids.length > 0) {
            M storage c = _m[_pick(secs)];
            if (c.paused && uint256(c.pausedSince) + 24 hours > t) t = uint256(c.pausedSince) + 24 hours - (secs % 2);
        } else {
            t += bound(secs, 1, 30 hours);
        }
        if (t <= block.timestamp) t = block.timestamp + 1;
        vm.warp(t);
    }

    function rotate(uint256 seed) external {
        address cur = tokenDrop.attestor();
        address next = seed % 5 == 0 && oldAttestors.length > 0
            ? oldAttestors[seed % oldAttestors.length]  // rotate back to an old key
            : makeAddr(string.concat("rt-attestor-", vm.toString(_nonce++)));
        if (next == cur) return;
        oldAttestors.push(cur);
        vm.prank(owner);
        tokenDrop.setAttestor(next);
        vm.prank(owner);
        ledgerDrop.setAttestor(next);
    }
}
