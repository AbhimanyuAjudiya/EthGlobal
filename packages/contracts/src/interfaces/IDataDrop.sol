// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title IDataDrop — sponsor pools that pay the service once per verified human (claimKey), with an hourly cap, pause and refund.
/// @notice Binding interface: docs/INTERFACES.md §6.1. Every USDC amount is a 6-decimal base-unit integer
///         ($0.50 == 500_000); nothing here is ever scaled by 1e18.
interface IDataDrop {
    /// @notice One sponsor pool. Packed into three storage slots.
    struct Campaign {
        address sponsor; // slot 0
        uint96 pricePerClaim; // USDC 6-dec; paid to `payout` per claim
        uint128 budget; // slot 1: USDC pulled at creation (token mode) or declared (LEDGER_ONLY)
        uint128 spent;
        uint32 claimsPerHour; // slot 2
        uint64 expiresAt; // unix seconds; no claims at or after
        uint64 pausedSince; // 0 when not paused; set on false→true, cleared on true→false
        bool paused;
    }

    /// @notice Emitted once by the constructor: `true` when `usdc == address(0)` (LEDGER_ONLY: no token moves).
    /// @param ledgerOnly Whether the deployment is in LEDGER_ONLY mode.
    event ModeSet(bool ledgerOnly);
    /// @notice A campaign was created (and, in token mode, `budget` USDC was pulled from `sponsor`).
    /// @param id Campaign id.
    /// @param sponsor The creator; the only account that may unpause or refund.
    /// @param budget Total budget in USDC base units (6 decimals).
    /// @param pricePerClaim Amount paid to `payout` per claim, USDC base units (6 decimals).
    /// @param claimsPerHour Maximum successful claims per `(id, hourBucket)`.
    /// @param expiresAt Unix seconds; claims revert at or after this instant.
    event CampaignCreated(
        bytes32 indexed id,
        address indexed sponsor,
        uint128 budget,
        uint96 pricePerClaim,
        uint32 claimsPerHour,
        uint64 expiresAt
    );
    /// @notice One verified human was paid for.
    /// @param id Campaign id.
    /// @param claimKey keccak256(abi.encodePacked(id, campaignClaimKey)); never the raw nullifier.
    /// @param paid USDC base units paid to `payout` (equals the campaign's pricePerClaim).
    /// @param hourBucket block.timestamp / 3600 at the time of the claim.
    event Claimed(bytes32 indexed id, bytes32 indexed claimKey, uint96 paid, uint64 hourBucket);
    /// @notice `pause(id, paused)` was called (also emitted for no-op transitions).
    /// @param id Campaign id.
    /// @param paused The requested (and now current) paused flag.
    /// @param by The caller (sponsor or attestor).
    event Paused(bytes32 indexed id, bool paused, address by);
    /// @notice The unspent budget was returned to the sponsor (token mode) or released (LEDGER_ONLY).
    /// @param id Campaign id.
    /// @param amount USDC base units refunded (budget − spent before the call).
    event Refunded(bytes32 indexed id, uint128 amount);
    /// @notice The attestor (the only account allowed to `claim`) changed.
    /// @param attestor The new attestor.
    event AttestorSet(address attestor);

    /// @notice `claimKey` was already paid for in this campaign (T-03).
    error AlreadyClaimed();
    /// @notice The campaign is paused.
    error CampaignPaused();
    /// @notice `block.timestamp >= expiresAt`.
    error CampaignExpired();
    /// @notice `claimsPerHour` claims already succeeded in the current hour bucket (T-01).
    error HourlyCap();
    /// @notice `spent + pricePerClaim > budget` (also after a refund, which sets budget = spent).
    error BudgetExhausted();
    /// @notice A campaign with this id already exists (T-04); ids are never reusable.
    error CampaignExists();
    /// @notice Bad campaign parameters, or the campaign does not exist.
    error InvalidCampaign();
    /// @notice Caller is not the attestor.
    error NotAttestor();
    /// @notice Caller is not the sponsor (or the attestor tried to unpause).
    error NotSponsor();
    /// @notice Refund conditions not met, or nothing left to refund.
    error NotRefundable();
    /// @notice `associateHts` called on a chain other than Hedera (295/296).
    error NotHedera();

    /// @notice Creates a campaign and (token mode) pulls `budget` USDC from msg.sender. Reverts CampaignExists if `id` is taken,
    ///         InvalidCampaign unless budget ≥ pricePerClaim > 0, claimsPerHour > 0, expiresAt > block.timestamp.
    /// @param id Campaign id (any 32 bytes; first come, first served, never reusable).
    /// @param budget USDC base units (6 decimals).
    /// @param pricePerClaim USDC base units (6 decimals) paid per claim.
    /// @param claimsPerHour Hourly cap on successful claims.
    /// @param expiresAt Unix seconds; must be in the future.
    function createCampaign(bytes32 id, uint128 budget, uint96 pricePerClaim, uint32 claimsPerHour, uint64 expiresAt)
        external;
    /// @notice onlyAttestor. claimKey = keccak256(abi.encodePacked(id, campaignClaimKey)). Pays pricePerClaim to `payout` (token mode).
    /// @param id Campaign id.
    /// @param claimKey Per-campaign pseudonym of the human.
    function claim(bytes32 id, bytes32 claimKey) external;
    /// @notice Sponsor may set either value; the attestor may only set `true`; anyone else reverts NotSponsor.
    /// @param id Campaign id.
    /// @param paused_ Desired paused flag.
    function pause(bytes32 id, bool paused_) external;
    /// @notice Sponsor only; after expiresAt, or when paused for ≥ 24 h. Transfers budget − spent, then sets budget = spent.
    /// @param id Campaign id.
    function refund(bytes32 id) external;
    /// @notice Owner only (Ownable2Step): rotates the attestor key.
    /// @param attestor The new attestor.
    function setAttestor(address attestor) external; // owner (Ownable2Step)
    /// @notice Hedera only (chainid 295/296): HTS precompile associateToken(address(this), token). Reverts NotHedera elsewhere.
    /// @param token HTS token EVM address (long-zero form); must equal `usdc()` in token mode.
    function associateHts(address token) external; // owner

    /// @notice Whether `claimKey` has been paid for in campaign `id`. Monotonic: never reset.
    /// @param id Campaign id.
    /// @param claimKey Per-campaign pseudonym.
    /// @return True once claimed.
    function claimed(bytes32 id, bytes32 claimKey) external view returns (bool);
    /// @notice Successful claims in campaign `id` during `hourBucket` (block.timestamp / 3600).
    /// @param id Campaign id.
    /// @param hourBucket Hour bucket.
    /// @return Number of claims, ≤ claimsPerHour.
    function claimsInHour(bytes32 id, uint64 hourBucket) external view returns (uint32);
    /// @notice The stored campaign (all-zero when `id` does not exist).
    /// @param id Campaign id.
    /// @return The campaign struct.
    function campaigns(bytes32 id) external view returns (Campaign memory);
    /// @notice True when deployed with `usdc == address(0)`: state and events only, no token movement.
    /// @return Whether LEDGER_ONLY mode is active.
    function ledgerOnly() external view returns (bool); // usdc == address(0)
    /// @notice The USDC token (immutable; address(0) in LEDGER_ONLY mode).
    /// @return Token address.
    function usdc() external view returns (address);
    /// @notice Receives every claim payment (immutable).
    /// @return Payout address.
    function payout() external view returns (address);
    /// @notice The only account allowed to `claim`.
    /// @return Attestor address.
    function attestor() external view returns (address);
    /// @notice The bucket `claim` would use now: block.timestamp / 3600.
    /// @return Current hour bucket.
    function currentHourBucket() external view returns (uint64); // block.timestamp / 3600
}
// constructor(IERC20 usdc_, address payout_, address attestor_, address owner_)
