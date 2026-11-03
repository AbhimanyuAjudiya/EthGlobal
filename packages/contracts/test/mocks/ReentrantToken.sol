// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {IDataDrop} from "../../src/interfaces/IDataDrop.sol";

/// @title ReentrantToken — 6-decimal ERC-20 whose `transfer` re-enters DataDrop (`claim` or `refund`).
/// @notice To re-enter `claim` the token must be the attestor; to re-enter `refund` it must be the sponsor — so the
///         test deploys a DataDrop whose attestor is this token and lets this token create its own campaign.
///         The re-entrant call is wrapped in try/catch: the revert data is recorded in `lastError` and the outer call
///         completes, so the test can assert both the guard's error and the consistent final state.
contract ReentrantToken is ERC20 {
    enum Mode {
        None,
        Claim,
        Refund
    }

    IDataDrop public drop;
    Mode public mode;
    bytes32 public reenterId;
    bytes32 public reenterKey;
    bytes public lastError;
    uint256 public reentryAttempts;

    constructor() ERC20("Reentrant USD", "RUSD") {}

    /// @notice 6 decimals, like USDC.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Open mint (test only).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Configures the re-entry performed on the next `transfer`.
    function arm(IDataDrop drop_, Mode mode_, bytes32 id, bytes32 key) external {
        drop = drop_;
        mode = mode_;
        reenterId = id;
        reenterKey = key;
    }

    /// @notice Lets this token act as sponsor.
    function callCreate(bytes32 id, uint128 budget, uint96 price, uint32 cap, uint64 expiresAt) external {
        _approve(address(this), address(drop), budget);
        drop.createCampaign(id, budget, price, cap, expiresAt);
    }

    /// @notice Lets this token act as attestor.
    function callClaim(bytes32 id, bytes32 key) external {
        drop.claim(id, key);
    }

    /// @notice Lets this token act as sponsor.
    function callRefund(bytes32 id) external {
        drop.refund(id);
    }

    /// @notice ERC-20 transfer that re-enters DataDrop once after moving the balance.
    function transfer(address to, uint256 value) public override returns (bool) {
        bool ok = super.transfer(to, value);
        Mode m = mode;
        if (m != Mode.None && msg.sender == address(drop)) {
            mode = Mode.None; // one attempt only
            reentryAttempts++;
            if (m == Mode.Claim) {
                try drop.claim(reenterId, reenterKey) {}
                catch (bytes memory err) {
                    lastError = err;
                }
            } else {
                try drop.refund(reenterId) {}
                catch (bytes memory err) {
                    lastError = err;
                }
            }
        }
        return ok;
    }
}
