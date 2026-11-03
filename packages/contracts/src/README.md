# src/

Production contracts live here, one contract per file, `pragma solidity 0.8.30`.

- Imports: `forge-std/…` (scripts and tests only) and `@openzeppelin/contracts/…` (remapped in `foundry.toml`).
- Interfaces go in `src/interfaces/`, shared libraries in `src/libraries/`.
- Every contract added here gets a matching `test/<Name>.t.sol` and a deployment line in `script/Deploy.s.sol`.
