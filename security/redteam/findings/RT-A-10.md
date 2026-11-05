---
id: RT-A-10
title: Rate limits key on the full client address: one IPv6 /64 is 2^64 buckets (rp-context signing oracle, challenges, PIN guesses)
module: services/api/src/middleware/rate-limit.ts
threat: T-81
severity: Low
likelihood: M
status: verified
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-surface.test.ts::20 /world/rp-context from one IPv6 /64 within a minute ⇒ at most 10 signed_RTFINDING
regression_test: services/api/test/redteam/rt-surface.test.ts::20 /world/rp-context from one IPv6 /64 within a minute ⇒ at most 10 signed [RT-A-10]
fix_commit: (uncommitted, wave-2 API fix pass; orchestrator commits)
verified_at: 2026-11-04 (redteam-verify, Claude)
duplicate_of:
sign_off:
---

## Repro

```sh
cd services/api && npx vitest run test/redteam/rt-surface.test.ts -t "IPv6"
```

20 `POST /world/rp-context` from `2001:db8:1:2::1 … ::14` ⇒ 20 signatures (`rpSigner.issue` ×20); the limit is 10/min/IP.

## Impact

Any host with an IPv6 /64 (every VPS, most home connections) bypasses every per-IP limit: the T-81 signing-oracle bound, the
10/min challenge rate that also bounds PIN guesses (still 10^15 PINs, so no practical brute force), `/claim` 5/min. Low.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Normalise the bucket key: IPv4 as is, IPv6 truncated to its /64 (or /56), including IPv4-mapped IPv6 (`::ffff:a.b.c.d` →
`a.b.c.d`).

## Builder notes (optional)

`ipBucket()` normalises the rate-limit key: IPv4 as is, IPv4-mapped IPv6 (`::ffff:a.b.c.d`) as its IPv4, any other IPv6 address (brackets and zone ids stripped, `::` and embedded IPv4 expanded) as its /64. Both the global and the per-route limiters use it. `src/middleware/rate-limit.ts`.

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): VERIFIED.**

- Regression: `rt-surface.test.ts` `[RT-A-10]` passes. (re-run 2026-11-04, green under the CI `_RTFINDING` filter).
- Variant (new, not covered by the regression): eight spellings of one /64 (upper case, zero-padded groups, `::` elsewhere, brackets, `%zone`, embedded IPv4 low bits, the last address of the /64) map to one bucket, and 20 `/world/rp-context` across them sign ≤ 10. Observation: a right-most XFF hop that carries a PORT (`[2001:db8::5]:4431`, `1.2.3.4:5555`) is not normalised (one bucket per port) — only matters behind a proxy that appends ports, and applies to IPv4 too.

```sh
cd services/api && npx vitest run test/redteam/verify-rt-a-09-a-10.test.ts -t RT-A-10
```
