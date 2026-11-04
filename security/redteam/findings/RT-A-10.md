---
id: RT-A-10
title: Rate limits key on the full client address: one IPv6 /64 is 2^64 buckets (rp-context signing oracle, challenges, PIN guesses)
module: services/api/src/middleware/rate-limit.ts
threat: T-81
severity: Low
likelihood: M
status: open
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-surface.test.ts::20 /world/rp-context from one IPv6 /64 within a minute ⇒ at most 10 signed_RTFINDING
regression_test:
fix_commit:
verified_at:
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

## Verification (red team)
