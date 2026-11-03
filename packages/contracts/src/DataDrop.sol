// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IDataDrop} from "./interfaces/IDataDrop.sol";
import {IHederaTokenService} from "./interfaces/IHederaTokenService.sol";

/// @title DataDrop — sponsor pools that pay the service once per verified human.
/// @notice A sponsor funds a campaign with USDC; the API's attestor key calls `claim(id, claimKey)` once per verified
///         human and the contract pays `pricePerClaim` to the immutable `payout` address. Controls (THREAT-MODEL T-01…T-11):
///         one claim per `(id, claimKey)`; at most `claimsPerHour` claims per `(id, block.timestamp / 3600)`; sponsor may
///         pause/unpause, the attestor may only pause; the sponsor may refund `budget − spent` after `expiresAt` or after
///         ≥ 24 h of continuous pause. There is no sweep/withdraw/rescue function and `usdc`/`payout` are immutable.
///
///         Units: every amount is a USDC base-unit integer with **6 decimals** (`$0.50 == 500_000`, `$1 == 1e6`).
///         `pricePerClaim` is `uint96` (max ≈ 7.9e28 base units) and `budget`/`spent` are `uint128`; all arithmetic is
///         checked and no value is ever scaled by 1e18.
///
///         Modes: `usdc == address(0)` ⇒ LEDGER_ONLY (state and events only, no token movement; sponsor funds move natively
///         on HTS). Otherwise token mode with `SafeERC20` on every transfer.
///
///         Drain bound with a stolen attestor key (THREAT-MODEL §6.4): per hour ≤ Σ_live min(budget − spent,
///         pricePerClaim × claimsPerHour); at a bucket edge up to 2 × pricePerClaim × claimsPerHour within seconds.
///
///         Reentrancy: `ReentrancyGuardTransient` (EIP-1153). The package already targets `evm_version = "cancun"`, so
///         every target chain must accept Cancun bytecode anyway; Hedera supports TSTORE/TLOAD since its Cancun
///         upgrade. [verify Wed]
contract DataDrop is IDataDrop, Ownable2Step, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @notice HTS system contract address on Hedera. [verify Wed]
    address internal constant HTS_PRECOMPILE = 0x0000000000000000000000000000000000000167;
    /// @notice HTS response code SUCCESS.
    int64 internal constant HTS_SUCCESS = 22;
    /// @notice Response code reported when the precompile call fails or returns no data (HTS UNKNOWN).
    int64 internal constant HTS_UNKNOWN = 21;
    /// @notice Hedera mainnet chain id.
    uint256 internal constant HEDERA_MAINNET = 295;
    /// @notice Hedera testnet chain id.
    uint256 internal constant HEDERA_TESTNET = 296;
    /// @notice Seconds of continuous pause after which the sponsor may refund before expiry.
    uint64 internal constant REFUND_PAUSE_DELAY = 24 hours;
    /// @notice Length of one hour bucket.
    uint256 internal constant BUCKET_SECONDS = 3600;

    /// @notice A role address was zero.
    error ZeroAddress();
    /// @notice The HTS precompile returned a response code other than SUCCESS (22).
    /// @param responseCode The Hedera response code (21 when the call itself failed).
    error HtsAssociationFailed(int64 responseCode);
    /// @notice Token mode: `associateHts` may only associate the immutable `usdc` token.
    error NotUsdc();
    /// @notice Token mode: the contract's USDC balance did not grow by exactly `budget` during `createCampaign`.
    error BudgetNotReceived();

    /// @notice `associateHts` succeeded.
    /// @param token The associated HTS token.
    event HtsAssociated(address indexed token);

    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    IERC20 private immutable _usdc;
    /// @inheritdoc IDataDrop
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    address public immutable payout;
    /// @inheritdoc IDataDrop
    address public attestor;

    mapping(bytes32 => Campaign) private _campaigns;
    mapping(bytes32 => mapping(bytes32 => bool)) private _claimed;
    mapping(bytes32 => mapping(uint64 => uint32)) private _claimsInHour;

    /// @notice Deploys a DataDrop. Emits `ModeSet(usdc_ == address(0))` and `AttestorSet(attestor_)`.
    /// @param usdc_ The 6-decimal USDC token, or address(0) for LEDGER_ONLY mode. Immutable.
    /// @param payout_ Receives every claim payment. Immutable.
    /// @param attestor_ Initial attestor (the API's hot key).
    /// @param owner_ Owner (cold key): may only `setAttestor` and `associateHts`.
    constructor(IERC20 usdc_, address payout_, address attestor_, address owner_) Ownable(owner_) {
        if (payout_ == address(0) || attestor_ == address(0)) revert ZeroAddress();
        _usdc = usdc_;
        payout = payout_;
        attestor = attestor_;
        emit ModeSet(address(usdc_) == address(0));
        emit AttestorSet(attestor_);
    }

    /// @dev Reverts `NotAttestor` unless `msg.sender` is the current attestor.
    modifier onlyAttestor() {
        _checkAttestor();
        _;
    }

    // ───────────────────────────────────────────── mutating ─────────────────────────────────────────────

    /// @inheritdoc IDataDrop
    /// @dev Token mode pulls `budget` with `safeTransferFrom` and additionally checks the balance delta, so an HTS
    ///      facade that reports success without moving funds reverts (`BudgetNotReceived`) instead of creating an
    ///      unfunded campaign (T-09).
    function createCampaign(bytes32 id, uint128 budget, uint96 pricePerClaim, uint32 claimsPerHour, uint64 expiresAt)
        external
        nonReentrant
    {
        if (_campaigns[id].sponsor != address(0)) revert CampaignExists();
        if (budget < pricePerClaim || pricePerClaim == 0 || claimsPerHour == 0 || expiresAt <= block.timestamp) {
            revert InvalidCampaign();
        }

        _campaigns[id] = Campaign({
            sponsor: msg.sender,
            pricePerClaim: pricePerClaim,
            budget: budget,
            spent: 0,
            claimsPerHour: claimsPerHour,
            expiresAt: expiresAt,
            pausedSince: 0,
            paused: false
        });
        emit CampaignCreated(id, msg.sender, budget, pricePerClaim, claimsPerHour, expiresAt);

        IERC20 token = _usdc;
        if (address(token) != address(0)) {
            uint256 before = token.balanceOf(address(this));
            token.safeTransferFrom(msg.sender, address(this), budget);
            if (token.balanceOf(address(this)) - before != budget) revert BudgetNotReceived();
        }
    }

    /// @inheritdoc IDataDrop
    /// @dev Check order (binding, the API decodes reverts by name): InvalidCampaign, CampaignPaused, CampaignExpired,
    ///      AlreadyClaimed, HourlyCap, BudgetExhausted. All effects precede the single token transfer (CEI).
    function claim(bytes32 id, bytes32 claimKey) external nonReentrant onlyAttestor {
        Campaign storage c = _campaigns[id];
        if (c.sponsor == address(0)) revert InvalidCampaign();
        if (c.paused) revert CampaignPaused();
        if (block.timestamp >= c.expiresAt) revert CampaignExpired();
        if (_claimed[id][claimKey]) revert AlreadyClaimed();
        // casting to 'uint64' is safe because block.timestamp / 3600 < 2^64 for ~2^76 years
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 bucket = uint64(block.timestamp / BUCKET_SECONDS);
        uint32 inHour = _claimsInHour[id][bucket];
        if (inHour >= c.claimsPerHour) revert HourlyCap();
        uint96 price = c.pricePerClaim;
        uint128 newSpent = c.spent + price;
        if (newSpent > c.budget) revert BudgetExhausted();

        _claimed[id][claimKey] = true;
        _claimsInHour[id][bucket] = inHour + 1;
        c.spent = newSpent;
        emit Claimed(id, claimKey, price, bucket);

        IERC20 token = _usdc;
        if (address(token) != address(0)) token.safeTransfer(payout, price);
    }

    /// @inheritdoc IDataDrop
    /// @dev `pausedSince` is set only on a false→true transition and cleared on true→false, so re-pausing an already
    ///      paused campaign does not move the 24 h refund clock, and unpause→pause restarts it (T-06).
    function pause(bytes32 id, bool paused_) external {
        Campaign storage c = _campaigns[id];
        address sponsor = c.sponsor;
        if (sponsor == address(0)) revert InvalidCampaign();
        if (msg.sender != sponsor && !(msg.sender == attestor && paused_)) revert NotSponsor();

        if (paused_ && !c.paused) {
            c.paused = true;
            // casting to 'uint64' is safe because unix seconds fit in 64 bits until year 2^64/3.15e7
            // forge-lint: disable-next-line(unsafe-typecast)
            c.pausedSince = uint64(block.timestamp);
        } else if (!paused_ && c.paused) {
            c.paused = false;
            c.pausedSince = 0;
        }
        emit Paused(id, paused_, msg.sender);
    }

    /// @inheritdoc IDataDrop
    /// @dev Sets `budget = spent` before transferring, so a re-entrant or repeated refund hits `NotRefundable` and any
    ///      later claim hits `BudgetExhausted`.
    function refund(bytes32 id) external nonReentrant {
        Campaign storage c = _campaigns[id];
        address sponsor = c.sponsor;
        if (msg.sender != sponsor || sponsor == address(0)) revert NotSponsor();
        bool expired = block.timestamp >= c.expiresAt;
        bool longPaused = c.paused && block.timestamp - c.pausedSince >= REFUND_PAUSE_DELAY;
        if (!expired && !longPaused) revert NotRefundable();
        uint128 spent = c.spent;
        uint128 amount = c.budget - spent;
        if (amount == 0) revert NotRefundable();

        c.budget = spent;
        emit Refunded(id, amount);

        IERC20 token = _usdc;
        if (address(token) != address(0)) token.safeTransfer(sponsor, amount);
    }

    /// @inheritdoc IDataDrop
    function setAttestor(address attestor_) external onlyOwner {
        if (attestor_ == address(0)) revert ZeroAddress();
        attestor = attestor_;
        emit AttestorSet(attestor_);
    }

    /// @inheritdoc IDataDrop
    /// @dev Low-level call (as Hedera's own `HederaTokenService.sol` does) so a missing/odd precompile yields
    ///      `HtsAssociationFailed(21)` instead of an opaque revert. Run with `--gas-limit 1_000_000` on Hedera:
    ///      `eth_estimateGas` under-estimates precompile calls. [verify Wed]
    function associateHts(address token) external onlyOwner {
        if (block.chainid != HEDERA_MAINNET && block.chainid != HEDERA_TESTNET) revert NotHedera();
        if (address(_usdc) != address(0) && token != address(_usdc)) revert NotUsdc();
        // slither-disable-next-line low-level-calls
        (bool ok, bytes memory ret) =
            HTS_PRECOMPILE.call(abi.encodeCall(IHederaTokenService.associateToken, (address(this), token)));
        int64 rc = (ok && ret.length >= 32) ? abi.decode(ret, (int64)) : HTS_UNKNOWN;
        if (rc != HTS_SUCCESS) revert HtsAssociationFailed(rc);
        emit HtsAssociated(token);
    }

    // ───────────────────────────────────────────── views ─────────────────────────────────────────────

    function _checkAttestor() internal view {
        if (msg.sender != attestor) revert NotAttestor();
    }

    /// @inheritdoc IDataDrop
    function claimed(bytes32 id, bytes32 claimKey) external view returns (bool) {
        return _claimed[id][claimKey];
    }

    /// @inheritdoc IDataDrop
    function claimsInHour(bytes32 id, uint64 hourBucket) external view returns (uint32) {
        return _claimsInHour[id][hourBucket];
    }

    /// @inheritdoc IDataDrop
    function campaigns(bytes32 id) external view returns (Campaign memory) {
        return _campaigns[id];
    }

    /// @inheritdoc IDataDrop
    function ledgerOnly() external view returns (bool) {
        return address(_usdc) == address(0);
    }

    /// @inheritdoc IDataDrop
    function usdc() external view returns (address) {
        return address(_usdc);
    }

    /// @inheritdoc IDataDrop
    function currentHourBucket() external view returns (uint64) {
        // casting to 'uint64' is safe because block.timestamp / 3600 < 2^64 for ~2^76 years
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(block.timestamp / BUCKET_SECONDS);
    }
}
