// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title HtsPrecompileMock — stand-in for the HTS system contract, `vm.etch`ed at 0x…0167.
/// @notice Records every `associateToken(account, token)` call and returns 22 (SUCCESS) unless `setResponse` chose
///         another code. Storage starts empty after `vm.etch`, so "no override" must mean SUCCESS.
contract HtsPrecompileMock {
    struct Call {
        address account;
        address token;
    }

    Call[] internal _calls;
    bool internal _overridden;
    int64 internal _response;

    /// @notice HTS `associateToken` stand-in.
    /// @param account Account to associate (DataDrop passes itself).
    /// @param token Token to associate.
    /// @return responseCode 22 unless overridden.
    function associateToken(address account, address token) external returns (int64 responseCode) {
        _calls.push(Call(account, token));
        return _overridden ? _response : int64(22);
    }

    /// @notice Makes every later call return `rc`.
    /// @param rc Response code to return.
    function setResponse(int64 rc) external {
        _overridden = true;
        _response = rc;
    }

    /// @notice The most recent call's arguments (zero when none).
    /// @return account Last `account`.
    /// @return token Last `token`.
    function last() external view returns (address account, address token) {
        if (_calls.length == 0) return (address(0), address(0));
        Call memory c = _calls[_calls.length - 1];
        return (c.account, c.token);
    }

    /// @notice Number of recorded calls.
    /// @return Count.
    function callCount() external view returns (uint256) {
        return _calls.length;
    }
}
