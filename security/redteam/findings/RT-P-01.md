---
id: RT-P-01
title: The API binds 0.0.0.0, so a MODE=local demo stack publishes /__local/clock, /__local/world-proof and the X-Seed-* hooks to the venue LAN
module: services/api/src/index.ts; scripts/e2e-local.sh; scripts/lib/harness.ts
threat: T-85
severity: Med
likelihood: M
status: fixed
found_by: redteam-wave3-ops
owner: builder-api (bind), builder-ops-demo (harness)
found_at: 2026-11-04T16:10+05:30
due: 2026-11-05T20:59+05:30
attack_test: security/redteam/wave3-ops/run.sh::api_binds_loopback_RTFINDING; security/redteam/wave3-ops/run.sh::api_binds_loopback_static_RTFINDING
regression_test: services/api/test/listen.test.ts (boots src/index.ts in MODE=local, asserts the 127.0.0.1 listener; MODE=local refuses a non-loopback HOST) + security/redteam/wave3-ops/run.sh::API binds loopback / services/api/src/index.ts binds an explicit host
fix_commit: (uncommitted, wave-3 ops fix pass on claude/ethglobal-mumbai-build; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
security/redteam/wave3-ops/run.sh            # section "OP2" (dynamic) and "process hygiene" (static)
awk 'NR>1 && $4=="0A"{print $2}' /proc/net/tcp   # during `pnpm demo` / `bash scripts/e2e-local.sh --keep`
```

1. Boot the real API (`tsx services/api/src/index.ts`) with any env; `/proc/net/tcp` shows the listener as `00000000:<port>`
   (all interfaces). `serve({ fetch: app.fetch, port: env.PORT })` passes no `hostname`; env.ts has no `HOST`.
2. `scripts/e2e-local.sh`, `scripts/lib/harness.ts startApi` and `pnpm demo` start it that way in MODE=local
   (Anvil and `next` are correctly bound to 127.0.0.1).
3. In this sandbox a MODE=local API from an earlier run was still listening on `0.0.0.0:8788` and answered
   `POST /__local/clock {"advanceMs":0}` with `{"now":…}` (see RT-P-02 for why it was still alive).

## Impact

The demo laptop on venue Wi-Fi (Sat/Sun rehearsals, judging) runs `pnpm demo`. Anyone on the LAN can: `POST /__local/clock`
with `advanceMs` up to 60 days ⇒ every seeded plan shows `expired` mid-demo; `POST /__local/world-proof` ⇒ free
IDKit-shaped proofs ⇒ `/claim` drains the Anvil campaign (local money, but the dashboard numbers judges see);
`X-Seed-Card-Campaign` ⇒ unlimited free cards; `X-Seed-Validity-S` / `-Claim-Window-S`. No real funds (MODE=local is Anvil
only), hence Med: demo integrity, the one thing the weekend is judged on. In live the 0.0.0.0 bind is intended (VPS).

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

`serve({ fetch, port, hostname: env.HOST })` with `HOST` defaulting to `127.0.0.1` when `MODE=local` (and `0.0.0.0` only
when set explicitly, e.g. on the VPS). The harness/e2e/demo keep the default. Regression: a vitest that boots
`index.ts` in local mode and asserts the listener address, plus the run.sh check turning green.

## Builder notes

`env.ts` gains `HOST` (default `127.0.0.1` in **every** mode; `MODE=local` refuses anything that is not 127.0.0.0/8, `::1` or `localhost`); `index.ts` passes `hostname: env.HOST` to `serve()` and logs the bound host. `scripts/e2e-local.sh` and `scripts/lib/harness.ts startApi` set `HOST=127.0.0.1` explicitly. Live keeps loopback unless the VPS says `HOST=0.0.0.0` (documented in `.env.example`, ONSITE-RUNBOOK §0 VPS env, INTERFACES §11 / A-43). The run.sh live boot now listens on 127.0.0.1.
