# test/

Forge tests, one `<Name>.t.sol` per contract under `src/`, plus `Deploy.t.sol` which guards the deploy
skeleton and `deploy/chains.json`.

- Unit tests: `test_<Behaviour>()`; failure cases: `test_Revert<When…>()`; fuzz: `testFuzz_<Behaviour>(…)`
  (512 runs by default, see `[fuzz]` in `foundry.toml`); invariants under `test/invariant/`.
- Run from the repo root with `pnpm test:contracts`, or here with `forge test -vvv`.
