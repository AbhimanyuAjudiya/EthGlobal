---
id: RT-O-04
title: The consumed-nonce entity can die before the challenge does (skew guard +5 s, block-time drift, now == exp boundary) — fresh-cache replay
module: packages/octroi/src/store/nonce.ts
threat: T-20
severity: Med
likelihood: M
status: open
found_by: redteam-octroi
owner: builder-octroi
found_at: 2026-11-04T05:40+05:30
due: 2026-11-05T20:59+05:30
attack_test: packages/octroi/test/redteam/rt-challenge.test.ts::a challenge issued by an instance 5 s ahead (inside the skew guard) cannot be replayed on a fresh cache after 121 s_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd packages/octroi && npx vitest run test/redteam/rt-challenge.test.ts -t 'nonce entity outlives'
```

All three use a fresh `Set` for the second consume (a second API instance or a restart — the case O3's "fresh Set,
populated ledger → replayed" exists for):

1. Issued by an instance 5 s ahead (`exp = T0 + 125 s`, accepted because the skew guard allows TTL + 5 s); consumed at T0;
   the nonce entity has `expiresIn: 120` from **consume** time ⇒ gone at T0 + 120 s; at T0 + 121 s the replay returns `'ok'`.
2. Ledger expiry 6 % fast (Arkiv counts blocks; T-35 quotes ≈5 % drift): consumed at T0, replay at T0 + 115 s → `'ok'`.
3. Single clock, consumed in the issuing millisecond: the entity dies at exactly `exp` (`expiresAt > now` is the liveness
   test), while `consumeChallenge` still accepts `now == exp` → `'ok'` at `now = exp`.

A constant clock offset is harmless (passing test "ledger clock 10 s ahead (offset, not drift)").

## Impact

A captured challenge (+ proof) can be consumed twice across instances/restarts inside a few-second window. The second
consume reaches `personhood.verify` again; the entitlement / `claimed` checks still stop a double claim, so the impact is a
broken T-20 control (and a second burned verification), not a free bundle — Med.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Derive the nonce lifetime from the challenge, with margin for both clocks:
`expiresIn = ceil((c.exp − now) / 1000) + CHALLENGE_TTL_S` (or a fixed `2 × CHALLENGE_TTL_S + 10`), and/or annotate
`expiresAt = c.exp + margin` so liveness never ends before the challenge can still be accepted. Keep `now > c.exp ⇒ expired`.

Regression test to add (builder): `packages/octroi/test/regression/T-20-challenge.test.ts` (cases: +5 s issuer, 6 % fast
ledger, `now == exp` after consume-at-issue ⇒ `replayed`).

## Builder notes (optional)

## Verification (red team)
