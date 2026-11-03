# @ethglobal/api

Hono on Node (`@hono/node-server`), pino JSON logs, zod-validated environment.

```
src/env.ts     MODE / PORT / LOG_LEVEL / CHAIN / RPC_URL schema (RPC_URL required when MODE=live)
src/chain.ts   chain id resolver: 31337 in local mode, eth_chainId via viem in live mode
src/app.ts     createApp(deps) → Hono app; GET /healthz → { ok, mode, chainId }
src/index.ts   boots the server from process.env, graceful shutdown on SIGINT/SIGTERM
test/          vitest; no network (viem is exercised against a stubbed fetch)
```

`pnpm dev` runs `tsx watch` with the root `.env` and pretty logs; `pnpm build && pnpm start` runs the compiled
`dist/`. Routes receive their dependencies through `createApp`, so tests inject a chain-id resolver instead of
an RPC.
