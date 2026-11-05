// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Red-team token zoo (extends test/mocks/BadTokens.sol). All 6 decimals unless stated; open mint.
abstract contract RT_Base is ERC20 {
    constructor(string memory n) ERC20(n, n) {}

    function decimals() public view virtual override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Takes `feeBps` on every movement (in and out); the fee is burned.
contract RT_FeeOnTransferToken is RT_Base {
    uint256 public feeBps = 100; // 1 %
    bool public feeOnIn = true;
    bool public feeOnOut = true;

    constructor() RT_Base("FEE") {}

    function setFee(bool in_, bool out_) external {
        feeOnIn = in_;
        feeOnOut = out_;
    }

    function transfer(address to, uint256 v) public override returns (bool) {
        if (feeOnOut) {
            uint256 fee = v * feeBps / 10_000;
            _burn(msg.sender, fee);
            v -= fee;
        }
        return super.transfer(to, v);
    }

    function transferFrom(address from, address to, uint256 v) public override returns (bool) {
        _spendAllowance(from, msg.sender, v);
        uint256 fee = feeOnIn ? v * feeBps / 10_000 : 0;
        if (fee > 0) _burn(from, fee);
        _transfer(from, to, v - fee);
        return true;
    }
}

/// @notice `transfer` (outbound from DataDrop) returns false without moving funds; `transferFrom` is honest.
contract RT_TransferReturnsFalseToken is RT_Base {
    constructor() RT_Base("RFALSE") {}

    function transfer(address, uint256) public pure override returns (bool) {
        return false;
    }
}

/// @notice USDT-style: `transfer`/`transferFrom` return nothing.
contract RT_NoReturnToken {
    string public constant name = "NORET";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external {
        allowance[msg.sender][s] = a;
    }

    function transfer(address to, uint256 a) external {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
    }

    function transferFrom(address f, address to, uint256 a) external {
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
    }
}

/// @notice Reverts every outbound `transfer` once switched on (an issuer-paused token).
contract RT_RevertingToken is RT_Base {
    bool public broken;

    constructor() RT_Base("REVERT") {}

    function breakIt() external {
        broken = true;
    }

    function transfer(address to, uint256 v) public override returns (bool) {
        require(!broken, "token paused");
        return super.transfer(to, v);
    }
}

/// @notice An 18-decimal ERC-20 (a wrong `usdc` entry in chains.json).
contract RT_EighteenDecToken is RT_Base {
    constructor() RT_Base("DAI18") {}

    function decimals() public pure override returns (uint8) {
        return 18;
    }
}

/// @notice `transferFrom` credits the recipient with more than `v` (rebasing/bonus token).
contract RT_InflatingToken is RT_Base {
    constructor() RT_Base("INFL") {}

    function transferFrom(address from, address to, uint256 v) public override returns (bool) {
        bool ok = super.transferFrom(from, to, v);
        _mint(to, 1);
        return ok;
    }
}

/// @notice Circle-style blacklist: any transfer to or from a blacklisted account reverts.
contract RT_BlacklistToken is RT_Base {
    mapping(address => bool) public blacklisted;

    constructor() RT_Base("BLUSDC") {}

    function setBlacklisted(address a, bool b) external {
        blacklisted[a] = b;
    }

    function _update(address from, address to, uint256 v) internal override {
        require(!blacklisted[from] && !blacklisted[to], "Blacklistable: account is blacklisted");
        super._update(from, to, v);
    }
}

/// @notice On its next outbound `transfer` from `target`, calls `target` with arbitrary calldata (as itself) and records
///         the revert data. Make this token the attestor (or sponsor) of a DataDrop to test re-entrant role abuse.
contract RT_ReenterAnyToken is RT_Base {
    address public target;
    bytes[] internal _payloads;
    bytes[] public results;
    bool[] public oks;

    constructor() RT_Base("REENTER") {}

    function arm(address target_, bytes[] calldata payloads) external {
        target = target_;
        delete _payloads;
        for (uint256 i = 0; i < payloads.length; i++) {
            _payloads.push(payloads[i]);
        }
        delete results;
        delete oks;
    }

    function resultCount() external view returns (uint256) {
        return results.length;
    }

    /// @notice Lets this token act as a DataDrop role directly.
    function exec(address to, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) = to.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }

    function transfer(address to, uint256 v) public override returns (bool) {
        bool ok = super.transfer(to, v);
        if (msg.sender == target && _payloads.length > 0) {
            bytes[] memory p = _payloads;
            delete _payloads; // one round only
            for (uint256 i = 0; i < p.length; i++) {
                (bool s, bytes memory r) = target.call(p[i]);
                oks.push(s);
                results.push(r);
            }
        }
        return ok;
    }
}

/// @notice HTS stand-in whose `associateToken` returns raw bytes chosen by the test (or reverts).
contract RT_RawHts {
    bytes public ret;
    bool public doRevert;

    function set(bytes calldata r, bool rv) external {
        ret = r;
        doRevert = rv;
    }

    fallback() external {
        bytes memory r = ret;
        if (doRevert) {
            assembly {
                revert(add(r, 32), mload(r))
            }
        }
        assembly {
            return(add(r, 32), mload(r))
        }
    }
}
