// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

/// @title EmitVectors
/// @notice Writes fixtures/eip3009/vectors.json: 8 fixed authorizations × 2 EIP-712 domains, each with the Circle-layout
///         `TransferWithAuthorization` and `ReceiveWithAuthorization` digests and 65-byte `r ‖ s ‖ v` signatures by
///         Anvil account #5 (derived from the public test mnemonic; RFC 6979 makes them deterministic).
///         Domains: MockUSDC3009 as deployed by Deploy.s.sol on Anvil (`"USD Coin"`, `"2"`, 31337, deployer #0 nonce 0)
///         and Circle USDC on Base Sepolia (`"USDC"`, `"2"`, 84532, 0x036C…CF7e — API-FACTS §7).
///         The digests are computed here from first principles; test/Vectors.t.sol checks them against the contract.
///
///         pnpm vectors   (= forge script script/EmitVectors.s.sol)
contract EmitVectors is Script {
    string internal constant MNEMONIC = "test test test test test test test test test test test junk";
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant TRANSFER_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 internal constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 internal constant CANCEL_TYPEHASH = keccak256("CancelAuthorization(address authorizer,bytes32 nonce)");

    /// @notice Address of MockUSDC3009 on a fresh Anvil after Deploy.s.sol (deployer #0, nonce 0).
    address public constant ANVIL_MOCK_USDC = 0x5FbDB2315678afecb367f032d93F642f64180aa3;
    /// @notice Circle USDC on Base Sepolia.
    address public constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    struct Domain {
        string name;
        string version;
        uint256 chainId;
        address verifyingContract;
    }

    struct Tuple {
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
    }

    // positional struct literals keep the fixture table readable
    // forge-lint: disable-start(named-struct-fields)
    /// @notice The two domains in file order.
    /// @return d Domains.
    function domains() public pure returns (Domain[2] memory d) {
        d[0] = Domain("USD Coin", "2", 31_337, ANVIL_MOCK_USDC);
        d[1] = Domain("USDC", "2", 84_532, BASE_SEPOLIA_USDC);
    }

    /// @notice The 8 fixed tuples (from is always Anvil #5). Values are 6-decimal USDC base units.
    /// @return t Tuples.
    function tuples() public pure returns (Tuple[8] memory t) {
        t[0] = Tuple(
            0x70997970C51812dc3A010C7d01b50e0d17dc79C8, 1_000_000, 0, 1_900_000_000, keccak256("recharge-vector-0")
        );
        t[1] = Tuple(
            0x976EA74026E726554dB657fA54763abd0C3a0aa9,
            500_000,
            1_762_171_200,
            1_762_171_500,
            keccak256("recharge-vector-1")
        );
        t[2] = Tuple(0x70997970C51812dc3A010C7d01b50e0d17dc79C8, 0, 0, type(uint256).max, bytes32(0));
        t[3] = Tuple(
            0x70997970C51812dc3A010C7d01b50e0d17dc79C8, 1, 1_700_000_000, 1_800_000_000, bytes32(type(uint256).max)
        );
        t[4] = Tuple(
            0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,
            10_000,
            0,
            1_762_171_800,
            0xf3746613c2d920b5fdabc0856f2aeb2d4f88ee6037b8cc5d04a71a4462f13480
        );
        t[5] = Tuple(
            0x14dC79964da2C08b23698B3D3cc7Ca32193d9955,
            2_500_000,
            1_762_171_199,
            1_762_171_201,
            keccak256("recharge-vector-5")
        );
        t[6] = Tuple(
            0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65, 100_000_000_000, 0, 2 ** 32, keccak256("recharge-vector-6")
        );
        t[7] = Tuple(
            0x90F79bf6EB2c4f870365E785982E1f101E93b906,
            type(uint128).max,
            1,
            type(uint256).max - 1,
            keccak256("recharge-vector-7")
        );
    }

    // forge-lint: disable-end(named-struct-fields)

    /// @notice EIP-712 domain separator.
    /// @param d Domain.
    /// @return Separator.
    function separator(Domain memory d) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256(bytes(d.name)), keccak256(bytes(d.version)), d.chainId, d.verifyingContract
            )
        );
    }

    /// @notice Circle-layout digest `keccak256(0x1901 ‖ separator ‖ structHash)`.
    /// @param sep Domain separator.
    /// @param typehash Transfer or receive typehash.
    /// @param from Payer.
    /// @param t Tuple.
    /// @return Digest.
    function digest(bytes32 sep, bytes32 typehash, address from, Tuple memory t) public pure returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(typehash, from, t.to, t.value, t.validAfter, t.validBefore, t.nonce));
        return keccak256(abi.encodePacked("\x19\x01", sep, structHash));
    }

    /// @notice Writes the fixture.
    function run() public {
        // Anvil #5 from the public test mnemonic (never a funded key)
        // forge-lint: disable-next-line(unsafe-cheatcode)
        uint256 pk = vm.deriveKey(MNEMONIC, 5);
        address signer = vm.addr(pk);
        Domain[2] memory ds = domains();
        Tuple[8] memory ts = tuples();

        string memory json = string.concat(
            "{\n",
            _s(2, "source", "forge"),
            _s(2, "generator", "packages/contracts/script/EmitVectors.s.sol"),
            _s(2, "note", "Integers are decimal strings. Signatures are 65-byte r||s||v (v in {27,28}) by Anvil #5."),
            _s(2, "signer", vm.toString(signer))
        );
        json = string.concat(
            json,
            '  "typehashes": {\n',
            _s(4, "transferWithAuthorization", vm.toString(TRANSFER_TYPEHASH)),
            _s(4, "receiveWithAuthorization", vm.toString(RECEIVE_TYPEHASH)),
            _last(4, "cancelAuthorization", string.concat('"', vm.toString(CANCEL_TYPEHASH), '"'))
        );
        json = string.concat(json, "  },\n", '  "domains": [\n');
        for (uint256 i = 0; i < ds.length; i++) {
            json = string.concat(
                json,
                "    {\n",
                _s(6, "name", ds[i].name),
                _s(6, "version", ds[i].version),
                _n(6, "chainId", vm.toString(ds[i].chainId))
            );
            json = string.concat(
                json,
                _s(6, "verifyingContract", vm.toString(ds[i].verifyingContract)),
                _last(6, "separator", string.concat('"', vm.toString(separator(ds[i])), '"')),
                i + 1 < ds.length ? "    },\n" : "    }\n"
            );
        }
        json = string.concat(json, "  ],\n", '  "vectors": [\n');
        for (uint256 i = 0; i < ds.length; i++) {
            bytes32 sep = separator(ds[i]);
            for (uint256 j = 0; j < ts.length; j++) {
                bool last = i + 1 == ds.length && j + 1 == ts.length;
                json = string.concat(json, _vector(i, sep, signer, pk, ts[j]), last ? "\n" : ",\n");
            }
        }
        json = string.concat(json, "  ]\n}\n");

        string memory path = string.concat(vm.projectRoot(), "/../../fixtures/eip3009/vectors.json");
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.writeFile(path, json);
        console.log("wrote %s (%s vectors)", path, ds.length * ts.length);
    }

    function _pad(uint256 n) internal pure returns (string memory p) {
        for (uint256 i = 0; i < n; i++) {
            p = string.concat(p, " ");
        }
    }

    /// @dev `<pad>"key": "value",\n`
    function _s(uint256 pad, string memory k, string memory v) internal pure returns (string memory) {
        return string.concat(_pad(pad), '"', k, '": "', string.concat(v, '",\n'));
    }

    /// @dev `<pad>"key": value,\n` (number)
    function _n(uint256 pad, string memory k, string memory v) internal pure returns (string memory) {
        return string.concat(_pad(pad), '"', k, '": ', string.concat(v, ",\n"));
    }

    /// @dev `<pad>"key": raw\n` (last member, no comma)
    function _last(uint256 pad, string memory k, string memory raw) internal pure returns (string memory) {
        return string.concat(_pad(pad), '"', k, '": ', string.concat(raw, "\n"));
    }

    function _sig(uint256 pk, bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    function _vector(uint256 domainIx, bytes32 sep, address from, uint256 pk, Tuple memory t)
        internal
        pure
        returns (string memory out)
    {
        out = string.concat(
            "    {\n",
            _n(6, "domain", vm.toString(domainIx)),
            _s(6, "from", vm.toString(from)),
            _s(6, "to", vm.toString(t.to))
        );
        out = string.concat(
            out,
            _s(6, "value", vm.toString(t.value)),
            _s(6, "validAfter", vm.toString(t.validAfter)),
            _s(6, "validBefore", vm.toString(t.validBefore)),
            _s(6, "nonce", vm.toString(t.nonce))
        );
        bytes32 td = digest(sep, TRANSFER_TYPEHASH, from, t);
        bytes32 rd = digest(sep, RECEIVE_TYPEHASH, from, t);
        out = string.concat(out, _s(6, "transferDigest", vm.toString(td)), _s(6, "receiveDigest", vm.toString(rd)));
        out = string.concat(
            out,
            _s(6, "transferSignature", vm.toString(_sig(pk, td))),
            _last(6, "receiveSignature", string.concat('"', vm.toString(_sig(pk, rd)), '"')),
            "    }"
        );
    }
}
