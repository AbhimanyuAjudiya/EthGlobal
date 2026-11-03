# ETHGlobal build (name TBD)

pnpm monorepo for the hackathon build. The product is being decided; this repository holds the
idea-agnostic scaffold: a TypeScript HTTP service, a Next.js app, Foundry contracts, adapter interfaces for
the sponsor SDKs with local mocks, and the design-token package. `research/` and `docs/` hold the
pre-kickoff research and are not touched by any tooling here.

## Layout

```
apps/web             Next.js 16 (App Router, Tailwind v4, standalone output); currently renders the token sheet at /
services/api         Hono on Node: GET /healthz → { ok, mode, chainId }; pino logs; zod env
packages/contracts   Foundry: solc 0.8.30, forge-std + OpenZeppelin 5.7, Deploy.s.sol + deploy/chains.json
packages/adapters    Ledger / Personhood / PaymentRail / Inference / NameResolver interfaces + deterministic mocks
packages/ui          tokens.css, fonts.css, tailwind.css, typed token index, onchain action state machine
scripts/             dev-chain.sh (Anvil + deploy), check-tools.sh
.github/workflows    ci.yml: lint, typecheck, test, forge build/test, jscpd, build
```

## MODE=local workflow

Everything runs with no external network: Anvil for the chain and in-memory mocks for every sponsor API.
`MODE=live` is a configuration switch (RPC URLs and keys in `.env`), not a code change; the live adapters are
added once the product is chosen.

```sh
bash scripts/check-tools.sh                 # node 22, pnpm 10, forge/anvil/cast 1.5.1, solc 0.8.30
cp .env.example .env                        # MODE=local by default; fill URLs/keys only for live mode
pnpm install
pnpm --filter @ethglobal/contracts deps     # forge-std + OpenZeppelin into packages/contracts/lib (git-ignored)
pnpm dev:chain                              # anvil on :8545 (chain 31337) + Deploy.s.sol broadcast
pnpm dev                                    # web on :3000 and api on :8787, in parallel
```

| Command               | What it runs                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm lint`           | ESLint (flat config, typescript-eslint type-aware, react-hooks, import ordering) + `prettier --check` |
| `pnpm typecheck`      | `tsc --noEmit` per package (`next typegen` first for the web app)                                     |
| `pnpm test`           | vitest in `packages/*` and `services/*`                                                               |
| `pnpm test:contracts` | `forge test`                                                                                          |
| `pnpm dupcheck`       | jscpd, fails above 1 % duplicated lines (min 5 lines / 50 tokens)                                     |
| `pnpm format`         | `prettier --write` + `forge fmt`                                                                      |
| `pnpm build`          | `tsc` builds, `next build` (standalone), `forge build`                                                |

Conventions: TypeScript strict + ESM everywhere, Node 22, `.js` suffixes on relative imports in Node packages,
`@ethglobal/ui` is consumed as source (Next transpiles it), `@ethglobal/adapters` compiles to `dist/`.

## Chains

`packages/contracts/deploy/chains.json` is the registry (chain id → name, slug, RPC env var, gas token,
explorer): Anvil 31337, Unichain Sepolia 1301, Arc Testnet 5042002, 0G Galileo 16602, Hedera Testnet 296,
World Chain Sepolia 4801, Whitechain Sepolia 1874, Base Sepolia 84532. `forge script … --rpc-url <slug>`
reads the matching `*_RPC_URL` from `.env`.

## Pre-kickoff work and continuity disclosure

_Placeholder: to be completed at kickoff and kept current._

- What existed before the hackathon start: the research in `research/`, the environment notes in `docs/`,
  and this scaffold (tooling only: no product code, contracts, routes or copy). Commit range: _TBD_.
- Everything product-specific is written during the event; the first product commit is _TBD_.
- Sponsor "continuity" tracks: _which prior work, if any, is being continued and how it is disclosed — TBD_.
