# @ethglobal/contracts

Foundry project (forge 1.5.1, solc 0.8.30, `evm_version = "cancun"`, optimizer on, 512 fuzz runs).

```
deploy/chains.json   chain id → name, slug, RPC env var, gas token, explorer (read by Deploy.s.sol)
script/Deploy.s.sol  chain-agnostic deploy entrypoint (CHAIN env selects the target)
src/                 contracts (see src/README.md)
test/                forge tests (see test/README.md)
lib/                 forge-std v1.17.0 and OpenZeppelin v5.7.0, installed by `pnpm deps`, git-ignored
```

## Commands

| Command                       | What it does                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm deps`                   | `forge install` of the pinned libraries (`--no-git`; skipped when `lib/` is populated) |
| `pnpm build` / `pnpm test`    | `forge build` / `forge test`                                                           |
| `pnpm fmt` / `pnpm fmt:check` | `forge fmt`                                                                            |
| `pnpm dev:chain` (repo root)  | Anvil on 31337 plus a broadcast of `Deploy.s.sol`                                      |

## Deploying

```sh
CHAIN=31337 forge script script/Deploy.s.sol:Deploy --rpc-url anvil --broadcast --private-key $DEPLOYER_PRIVATE_KEY
CHAIN=1301  forge script script/Deploy.s.sol:Deploy --rpc-url unichain_sepolia --broadcast --private-key $DEPLOYER_PRIVATE_KEY
```

`--rpc-url` aliases come from `[rpc_endpoints]` in `foundry.toml`; each resolves an env var named in
`deploy/chains.json` (`ANVIL_RPC_URL`, `UNICHAIN_SEPOLIA_RPC_URL`, …) from the root `.env`. The script
refuses to broadcast when the RPC's chain id differs from `CHAIN`.

## Offline compiler

`offline = true` keeps forge from contacting binaries.soliditylang.org (blocked in the build sandbox); solc
0.8.30 must therefore exist under `~/.svm/0.8.30/`. CI exports `FOUNDRY_OFFLINE=false` so a fresh runner can
download it.
