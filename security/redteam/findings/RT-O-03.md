---
id: RT-O-03
title: Check-then-put without an atomic create: concurrent claims across two campaigns both serve and both persist; two API instances both consume one nonce
module: packages/octroi/src/store/common.ts
threat: T-18
severity: Med
likelihood: M
status: fixed
found_by: redteam-octroi
owner: builder-octroi
found_at: 2026-11-04T05:40+05:30
due: 2026-11-05T20:59+05:30
attack_test: packages/octroi/test/redteam/rt-economics.test.ts::two concurrent claims by one human on campaigns A and B: never two live free entitlements and never a paid claim without an entitlement_RTFINDING
regression_test: packages/octroi/test/redteam/verify-rt-o-03-midnight.test.ts::concurrent claims on campaigns A and B straddling UTC midnight ⇒ at most one serve-free [RT-O-03] (+ ::cross-midnight, either start order and either campaign first ⇒ exactly one serve-free [RT-O-03], ::cross-midnight sequential … [RT-O-03]; the original rt-economics/rt-store/rt-challenge [RT-O-03] cases); earlier regressions (still green): packages/octroi/test/redteam/rt-economics.test.ts::two concurrent claims by one human on campaigns A and B: never two live free entitlements and never a paid claim without an entitlement [RT-O-03] (+ rt-store `two concurrent creates … [RT-O-03]`, rt-challenge `two API instances … [RT-O-03]`; packages/octroi/test/regression/redteam-wave1.test.ts::RT-O-03 / RT-O-08)
fix_commit: (uncommitted, verification fix pass 2026-11-04; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd packages/octroi && npx vitest run test/redteam -t 'RT-O-03|two campaigns|two API instances|two concurrent creates'
```

- `rt-economics.test.ts` — one human, verifier that allows repeat verifications (the threat model's O1 assumption), a
  ledger that yields per call like an RPC adapter: `Promise.all([saga(A), saga(B)])` where `saga = decide → DataDrop.claim
(model) → EntitlementStore.create`. Both `decide()` return `serve-free` (different claim keys, so the chain admits both),
  both `create(ent:v1:<quotaKey>)` pass the "live duplicate?" check, and **two live free entitlements** exist. Sequentially
  the same human is `deny: replay` on B (passing test beside it) — the outcome depends on interleaving.
- `rt-store.test.ts::EntitlementStore.create: two concurrent creates of one logical key → exactly one entity_RTFINDING` — two rows
  for one key; from then on every `getByKey` throws `internal_error` (the human is locked out — `/me` 503, every claim
  `ledger-unavailable` — until expiry).
- `rt-challenge.test.ts::two API instances (two caches, one ledger) consuming one nonce concurrently: exactly one ok_RTFINDING`
  → `['ok', 'ok']`. The in-memory `Set` is per process; the ledger leg is `consumed()` then `create()`, not atomic.

## Impact

With a permissive verifier: a second free bundle from a second sponsor (each sponsor pays `pricePerClaim`), or — if one
create loses — a sponsor pays on-chain for a claim that has no entitlement (T-25), and the duplicate-row rule turns the race
into a lock-out. With World v4 one-time uniqueness proofs the second `verify` fails, which is why this is Med, not High; the
model (O1) says the engine must not rely on that. Multi-instance nonce double-consume re-opens T-20 for any deployment with
more than one API process.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

1. octroi: add a per-process single-flight for `Repo.create` keyed by `(type, logicalKey)` (synchronous `Set` before the
   first await, like the nonce cache), and run the free-lane replay check + reservation under the same key
   (`ent:v1:<quotaKey>` reserved in-process from `alreadyServed` until the caller's `create` or a 10-min TTL) — this closes
   the single-instance race.
2. Ledger port: add `create(input, { ifAbsent: logicalKey })` or document that wave 2 runs one API instance (and add the
   constraint to DISCLOSURE + THREAT-MODEL §8). Arkiv has no CAS; a deterministic entity key derived from the logical key
   would give create-if-absent semantics if the SDK allows it.
3. API saga (wave 2): read `EntitlementStore.getByKey` again after `DataDrop.claim` and before `reseller.order`.

Regression test to add (builder): `packages/octroi/test/regression/T-18-nullifier-replay.test.ts` (case: concurrent A/B
claims ⇒ one serve-free) and `T-20-challenge.test.ts` (case: two caches ⇒ one ok, or the single-instance constraint stated).

## Ledger-adapter assumptions octroi relies on (for ArkivLedger; recorded here so the adapter tests pin them)

- **A-L1 creator filter:** `query`/`get` return only rows created by our writer (T-79). `InMemoryLedger` (writer views) and
  `ArkivLedger` (`$creator`) both do; `rt-store.test.ts` "a foreign writer cannot shadow, duplicate or plant…" proves it locally.
- **A-L2 two clocks:** a row is returned only if the ledger lifetime **and** the numeric `expiresAt` annotation are in the future.
- **A-L3 filter before limit:** liveness and creator filtering happen **before** `limit` is applied (the stores call
  `findOne` with `limit: 2`). A non-conforming adapter hides a live row behind two dead ones — demonstrated in
  `rt-store.test.ts` "documents the pre-limit liveness assumption".
- **A-L4 exact match, no coercion:** `1` never matches `'1'`; annotation names/values compared exactly.
- **A-L5 update keeps identity:** `update(entityKey)` acts on the same logical entity and never shortens the lifetime below the
  annotation (ArkivLedger keeps the longer one; the annotation still ends it).
- **A-L6 no atomicity:** octroi currently assumes nothing atomic; this finding is the consequence.
- **A-L7 expiry not earlier than requested:** a nonce or escrow must not die before `expiresIn` in server time (RT-O-04).

## Builder notes (optional)

Ledger port gains create-if-absent (`put({ ifAbsent: true })`, A-32) implemented by `InMemoryLedger` (one synchronous check-and-write) and `ArkivLedger` (per-key serialisation in-process; create-then-re-read, oldest wins, loser tombstones across processes `[verify Wed]`), pinned by five new `describeLedger` contract tests both adapters run. Every `Repo.create` uses it (two creates ⇒ one row, the other `replay`); `NonceStore.consume` too (two instances ⇒ one `ok`). The free lane now reserves, create-if-absent and before `serve-free`, the human's live lock (`claim:HMAC('live'‖quotaKey‖day)`) and the campaign claim record (A-33), so the second concurrent campaign is `deny: replay 'claim_lock'` before any sponsor pays. Cross-process residual (Arkiv indexing lag) is in THREAT-MODEL §8: wave 2 runs one writer process.

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): REOPENED.** The named regressions pass (rt-economics / rt-store / rt-challenge
`[RT-O-03]`, `test/regression/redteam-wave1.test.ts::RT-O-03`), and same-day concurrency holds. The fix does not hold
across a UTC day boundary, in ONE process (not the documented cross-process / Arkiv-lag residual).

### Repro (verification variant)

```sh
cd packages/octroi && npx vitest run test/redteam/verify-rt-o-03-midnight.test.ts
```

1. One human (one nullifier), two live campaigns A and B, one API process, a networked ledger (every call yields).
2. Request 1 claims A with `now = 23:59:59.999 UTC` (day D); request 2 claims B with `now = 00:00:00.001 UTC` (day D+1),
   concurrently.
3. Both `alreadyServed()` reads run before either `reserve()`: every `live(day)` for `day ∈ [today−30, today]` is absent.
4. Request 1 reserves `live(D)`, request 2 reserves `live(D+1)` — different keys, so both create-if-absent writes succeed —
   and each reserves its own campaign record ⇒ **two `serve-free`**, two sponsors pay, two live free bundles for one human.

The control cases in the same file (sequential across midnight ⇒ `replay`; concurrent on the same day ⇒ one serve) pass.
Failing test (marked `// RT-FINDING`, suffixed `_RTFINDING`):
`packages/octroi/test/redteam/verify-rt-o-03-midnight.test.ts::concurrent claims on campaigns A and B straddling UTC midnight ⇒ at most one serve-free_RTFINDING`.

Impact: the original RT-O-03 impact, on a timer anyone can hit (fire two claims ~1 s either side of 00:00 UTC; with Arkiv RPC
latency the read→reserve window is seconds wide). Bounded by one extra bundle per human per midnight.

Suggested fix (builder's choice): make the lock key independent of the request instant for the window that matters, e.g.
after reserving `live(D)` re-read `live(D−1)` and `live(D+1)` (and every day in the validity window) and release/deny on a
collision, or key the live lock by a coarser, collision-forcing bucket and check both neighbours inside `reserve()`, or a
per-quotaKey create-if-absent "live" entity whose lifetime is the entitlement's.

## Builder notes (verification fix pass)

decide() now reserves the human's live lock for **today and tomorrow** (`live(D)`, `live(D+1)`, create-if-absent, in order) and reads `live(D−30 … D+1)`, so two concurrent claims either side of 00:00 UTC contend for the same key `live(D+1)` and exactly one wins (A-44). Deviation from the orchestrator's brief ("key it by campaign + nullifier, no day"), with reason: a lock keyed by campaign + nullifier cannot collide across campaigns A and B (the property this finding is about — the variant test would still serve twice), and a per-human key with no time component repeats across one human's successive claims, which re-links their campaigns on the public ledger and fails the RT-O-01 regression `rt-keys.test.ts::two campaigns claimed by one human … share no ledger-visible identifier` (verified: that test fails with a day-free key). The per-campaign claim record is keyed by campaign + nullifier with no day (RT-O-08). Residual (A-44): two claims by one human < 48 h apart may share one `live(day)` key; cross-process Arkiv-lag residual unchanged (THREAT-MODEL §8, one writer process).
