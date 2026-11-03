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
///         on HTS; only owner-allow-listed sponsors may create). Otherwise token mode with `SafeERC20` on every transfer.
///
///         Ids: use `scopedCampaignId(sponsor, salt)` — only that sponsor can create it, so it cannot be squatted. Other
///         ids are first come, never reusable; the API pins `(id, sponsor)`. `renounceOwnership` is disabled.
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
    /// @notice `renounceOwnership` is disabled: it would make attestor rotation (the T-01 recovery) impossible (RT-C-06).
    error RenounceDisabled();

    /// @notice `associateHts` succeeded.
    /// @param token The associated HTS token.
    event HtsAssociated(address indexed token);
    /// @notice Who backed a new campaign and with how much (RT-C-01). Token mode: `amount` USDC moved from `funder`
    ///         into this contract. LEDGER_ONLY (see `ModeSet`): `amount` is declared by `funder`, an owner-allow-listed
    ///         sponsor (`ledgerSponsor`) who funds natively on HTS; nothing moved on this contract.
    /// @param id Campaign id.
    /// @param funder The sponsor that funded (token mode) or declared (LEDGER_ONLY) the budget.
    /// @param amount Budget in USDC base units (6 decimals).
    event CampaignFunded(bytes32 indexed id, address indexed funder, uint128 amount);
    /// @notice The owner allowed or revoked an account as a LEDGER_ONLY sponsor.
    /// @param sponsor The account.
    /// @param allowed Whether it may create LEDGER_ONLY campaigns.
    event LedgerSponsorSet(address indexed sponsor, bool allowed);

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
    /// @notice LEDGER_ONLY only: accounts the owner allows to declare (unbacked-on-chain) budgets (RT-C-01).
    mapping(address => bool) public ledgerSponsor;

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
    ///      unfunded campaign (T-09). LEDGER_ONLY: only owner-allow-listed sponsors (`ledgerSponsor`) may create, else
    ///      `NotSponsor` (RT-C-01). Sponsor-scoped ids (`scopedCampaignId`) can only be created by their sponsor, else
    ///      `NotSponsor` (RT-C-02); any other id is first come, first served and never reusable.
    function createCampaign(bytes32 id, uint128 budget, uint96 pricePerClaim, uint32 claimsPerHour, uint64 expiresAt)
        external
        nonReentrant
    {
        IERC20 token = _usdc;
        if (address(token) == address(0) && !ledgerSponsor[msg.sender]) revert NotSponsor();
        if (_isScoped(id) && address(uint160(uint256(id) >> 96)) != msg.sender) revert NotSponsor();
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
        emit CampaignFunded(id, msg.sender, budget);

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
        uint128 spent = c.spent;
        // compare against the remainder (budget ≥ spent is invariant) so a near-2^128 budget reports BudgetExhausted,
        // never Panic(0x11) (RT-C-07)
        if (price > c.budget - spent) revert BudgetExhausted();

        _claimed[id][claimKey] = true;
        _claimsInHour[id][bucket] = inHour + 1;
        c.spent = spent + price;
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
        _refund(id, msg.sender);
    }

    /// @notice Same as `refund(id)` but pays the unspent budget to `to`, chosen by the sponsor — e.g. when the
    ///         sponsor's own address is blacklisted/frozen by the token issuer (RT-C-03). Never an owner power (T-10).
    /// @param id Campaign id.
    /// @param to Recipient of `budget − spent`; must not be address(0).
    function refund(bytes32 id, address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        _refund(id, to);
    }

    /// @notice Owner only: allow or revoke `sponsor` as a LEDGER_ONLY campaign creator. The owner allow-lists a sponsor
    ///         only after seeing its native HTS funding; has no effect on the token-mode path (RT-C-01).
    /// @param sponsor The account.
    /// @param allowed Whether it may create LEDGER_ONLY campaigns.
    function setLedgerSponsor(address sponsor, bool allowed) external onlyOwner {
        if (sponsor == address(0)) revert ZeroAddress();
        ledgerSponsor[sponsor] = allowed;
        emit LedgerSponsorSet(sponsor, allowed);
    }

    /// @notice Disabled (always reverts `RenounceDisabled`): an ownerless DataDrop could never rotate a compromised
    ///         attestor (T-01, RT-C-06). Ownership can still move with `transferOwnership` + `acceptOwnership`.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    function _refund(bytes32 id, address to) internal {
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
        if (address(token) != address(0)) token.safeTransfer(to, amount);
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

    /// @notice A sponsor-scoped campaign id: `sponsor (20 bytes) ‖ 0x00000000 ‖ salt (8 bytes)`. Only `sponsor` can
    ///         create it, so it cannot be squatted or front-run (RT-C-02). Use these for every production campaign.
    /// @param sponsor The only account allowed to create the id.
    /// @param salt Sponsor-chosen discriminator.
    /// @return The id.
    function scopedCampaignId(address sponsor, uint64 salt) external pure returns (bytes32) {
        return bytes32((uint256(uint160(sponsor)) << 96) | uint256(salt));
    }

    /// @dev Scoped ids have bytes 20..23 == 0 (a random/keccak id does so with probability 2^-32).
    function _isScoped(bytes32 id) internal pure returns (bool) {
        return uint32(uint256(id) >> 64) == 0;
    }

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
