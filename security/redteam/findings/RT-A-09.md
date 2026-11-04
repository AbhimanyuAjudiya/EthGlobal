---
id: RT-A-09
title: MODE=live inherits local defaults: AGENT_PAYERS = Anvil #4 (a public key), CHAIN = 31337, CORS_ORIGINS = localhost
module: services/api/src/env.ts
threat: T-77
severity: Low
likelihood: M
status: fixed
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-surface.test.ts::MODE=live without AGENT_PAYERS ⇒ no public Anvil address is an allow-listed agent payer_RTFINDING; services/api/test/redteam/rt-surface.test.ts::MODE=live without CORS_ORIGINS / CHAIN ⇒ refused or no localhost origin and no 31337 domain_RTFINDING
regression_test: services/api/test/redteam/verify-rt-a-09-a-10.test.ts::CORS_ORIGINS=<spelling> ⇒ refused or no loopback origin [RT-A-09] ×4 (+ ::MODE=live refuses the loopback-equivalent (or invalid) CORS origin … [RT-A-09] ×20, ::a non-loopback origin … is not a loopback origin [RT-A-09] ×8); earlier regressions (still green): services/api/test/redteam/rt-surface.test.ts::MODE=live without AGENT_PAYERS ⇒ no public Anvil address is an allow-listed agent payer [RT-A-09]; ::MODE=live without CORS_ORIGINS / CHAIN ⇒ refused or no localhost origin and no 31337 domain [RT-A-09]
fix_commit: (uncommitted, verification fix pass 2026-11-04; orchestrator commits)
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

Live inherits nothing local: `CHAIN` has no schema default and is required in live (and refused if 31337); `CORS_ORIGINS` and `AGENT_PAYERS` default to empty in live and refuse localhost origins / Anvil accounts; the local defaults (31337, the PWA dev origins, Anvil #4) are applied only in `localDefaults()`. `src/env.ts`; `.env.example` and INTERFACES §11 document it (A-42).

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): REOPENED (Low, narrow).** The named regressions pass and the inherited defaults are
gone (no CHAIN default, empty CORS_ORIGINS / AGENT_PAYERS in live; `0x7a69`, `031337`, `eip155:31337` and every spelling of
an Anvil payer are refused — `verify-rt-a-09-a-10.test.ts`). The explicit-origin guard the fix added does not cover every
loopback spelling.

### Repro (verification variant)

```sh
cd services/api && npx vitest run test/redteam/verify-rt-a-09-a-10.test.ts -t 'CORS_ORIGINS'
```

`parseEnv({ ...liveEnv, CORS_ORIGINS })` **boots MODE=live** with each of: `http://localhost.:3000` (FQDN trailing dot),
`http://app.localhost:3000` (browsers resolve `*.localhost` to loopback), `http://0.0.0.0:3000`, `http://127.1:3000`.
`LOCALHOST_ORIGIN` (`src/env.ts:70`) only matches `localhost`, `127.d.d.d` and `[::1]` exactly.

Failing tests (marked `// RT-FINDING`, suffixed `_RTFINDING`):
`services/api/test/redteam/verify-rt-a-09-a-10.test.ts::CORS_ORIGINS=<spelling> ⇒ refused or no loopback origin_RTFINDING` (4 cases).

Impact: Low — needs an operator to type such a value; the original "inherited default" root cause is fixed. It defeats the
guard that is meant to catch exactly that mistake.

Suggested fix: parse each origin with `new URL()`, strip one trailing dot from the hostname, and refuse `localhost`,
`*.localhost`, any address in 127.0.0.0/8 (incl. short forms `inet_aton` accepts), `0.0.0.0` and `::1`/`::`.

## Builder notes (verification fix pass)

`isLoopbackOrigin` / `isLoopbackEquivalentHost` (src/env.ts) parse with WHATWG URL (which canonicalises `127.1`, `0x7f.1`, `2130706433`, `017700000001`, IPv6 forms), strip trailing dots, and refuse `localhost`, `*.localhost`, 127.0.0.0/8, 0.0.0.0/8, `::`, `::1`, IPv4-mapped 127/8 and 0/8, IPv4-compatible 127/8; an unparsable origin is refused too. `isLoopbackHost` (the MODE=local bind allow-list) is unchanged.
