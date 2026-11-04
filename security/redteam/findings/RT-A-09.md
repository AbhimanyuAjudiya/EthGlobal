---
id: RT-A-09
title: MODE=live inherits local defaults: AGENT_PAYERS = Anvil #4 (a public key), CHAIN = 31337, CORS_ORIGINS = localhost
module: services/api/src/env.ts
threat: T-77
severity: Low
likelihood: M
status: open
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-surface.test.ts::MODE=live without AGENT_PAYERS ⇒ no public Anvil address is an allow-listed agent payer_RTFINDING; services/api/test/redteam/rt-surface.test.ts::MODE=live without CORS_ORIGINS / CHAIN ⇒ refused or no localhost origin and no 31337 domain_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd services/api && npx vitest run test/redteam/rt-surface.test.ts -t "inherits local defaults"
```

`parseEnv({ MODE: 'live', …complete live env without AGENT_PAYERS/CHAIN/CORS_ORIGINS })` boots with
`AGENT_PAYERS = ['0x15d3…6A65']` (Anvil #4, `anvilRoles.agent`), `CHAIN = 31337` and `CORS_ORIGINS =
['http://127.0.0.1:3000', 'http://localhost:3000']`.

## Impact

Anyone can sign as Anvil #4 (its key is public), so in live anyone who pays a top-up from that address gets their
`X-Agent-Uaid` recorded as an `agent-topup` with any UAID they choose (T-77 reputation spoof, receipts on HCS). `CHAIN`
silently defaults to the Anvil EIP-712 domain for every Recharge signature and the DataDrop client. Hygiene, Low.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

In the live branch of `envSchema.superRefine`: require `CHAIN`, `CORS_ORIGINS` and `AGENT_PAYERS` explicitly; refuse any
Anvil address in `AGENT_PAYERS` (same `anvilAddresses` set as the key check); refuse `CHAIN=31337` and localhost origins.

## Builder notes (optional)

## Verification (red team)
