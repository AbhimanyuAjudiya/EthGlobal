---
id: RT-O-01
title: Entitlement capabilities and the global quotaKey pseudonym are written in clear to the public ledger; paid keys are derivable from the on-chain payment
module: packages/octroi/src/store/entitlement.ts
threat: T-37
severity: High
likelihood: H
status: open
found_by: redteam-octroi
owner: builder-octroi
found_at: 2026-11-04T05:40+05:30
due: 2026-11-04T09:40+05:30
attack_test: services/api/test/redteam/verify-rt-o-01-variants.test.ts::(d2) a fresh (<60 s) cache entry is never served past the entitlement expiry, ledger down or up_RTFINDING (earlier: packages/octroi/test/redteam/rt-keys.test.ts::the /me/:key capability of a free entitlement does not appear on the public ledger_RTFINDING)
regression_test: services/api/test/redteam/verify-rt-o-01-index-cache.test.ts::/me/<hk:index> after the owner read /me/<key> ⇒ 404, never the owner’s entitlement [RT-O-01] (+ ::/me/<hk:index> while the ledger is down, and after expiry ⇒ the same 404 as an unknown key [RT-O-01]; services/api/test/unit/primitives.test.ts::keyed by the capability, never the ledger index … [RT-O-01]; services/api/test/me.test.ts::after expiry → the same 404 as unknown …, ::degraded ledger: a cached copy past its entitlement expiry, or one not marked stale-allowed, is never served [RT-O-01]; packages/octroi/test/redteam/rt-keys.test.ts [RT-O-01] cases); earlier regressions (still green): packages/octroi/test/redteam/rt-keys.test.ts::the /me/:key capability of a free entitlement does not appear on the public ledger [RT-O-01] (+ the two other [RT-O-01] cases in that file; packages/octroi/test/regression/redteam-wave1.test.ts::RT-O-01)
fix_commit: 041136f (verification fix pass; partial, reopened 2026-11-04 by the closing verification)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd packages/octroi && npx vitest run test/redteam/rt-keys.test.ts -t 'public-ledger observer'
```

Three `_RTFINDING` cases in `rt-keys.test.ts` (`describe('attack: rt public-ledger observer …')`):

1. **Capability on the ledger.** `decide()` → `serve-free` → `EntitlementStore.create(entitlement)`; dump the ledger as any
   reader of Arkiv would (TB-5: every payload and annotation is world-readable). The dump contains `ent:v1:<quotaKey>` — the
   logical key that `/me/:key` treats as an unguessable capability (T-36) and that T-73 says "the PWA treats as a capability".
2. **Cross-campaign linkage.** One human claims campaign A; the bundle expires; the same human claims campaign B. Both
   entities carry the same `key` annotation `ent:v1:<quotaKey>` next to different `campaignId` annotations. Arkiv history is
   permanent, so any indexer joins the two campaigns' claim lists — exactly what INTERFACES A-9 (per-campaign `auditKey`,
   "published claim lists unlinkable across campaigns") was meant to prevent. Receipts make it worse: `entitlementKeyHash =
sha256(entitlementKey)` is the same global value on every receipt of that human, with `campaignId` beside it.
3. **Paid keys are public by construction.** `serve-paid.entitlement.key === keys.entitlementPaid(from, nonce)`, and `from` and
   `nonce` are arguments of the public `transferWithAuthorization` call (Hedera: the tx id). Anyone watching the payout
   address can compute every buyer's `/me/:key`.

## Impact

- `/me/:key` for every user is readable by anyone: plan, usage, expiry, payer, network (privacy; T-37's
  "payer-address↔human-key link" in a stronger form: a payer address → its keys).
- T-73(b) owner squat becomes trivial: whoever reads the key off Arkiv first can `PUT /agent/policy` for a free entitlement
  (the wave-2 control is "first-owner registration needs a consumed challenge", which any stranger can obtain).
- Any wave-2 route that authorises by "knows the entitlement key" (top-up target, `/me/:key/receipts`, refresh) is open.
- The sponsor-unlinkability promise of A-9 is false at the system level; `quotaKey` is documented "server-side only"
  (INTERFACES §5) but is published.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

1. Split the **capability** from the **index key**. Store `ANN.key = H(logicalKey)` (e.g. `sha256(utf8(logicalKey))`, or an
   HMAC with a store key) and never write the logical key into the payload; `getByKey(k)` queries `H(k)`. Receipts already
   use `sha256(entitlementKey)` — reuse the same hash so `entitlementKeyHash` and the index agree.
2. Make free keys per-campaign on the ledger: index the free entitlement by `HMAC(secret, 'ent' ‖ campaignId ‖ nullifier)`
   (keep the global `quotaKey` server-side only, as a lookup in the replay check), or accept linkage explicitly in DISCLOSURE.
3. Make paid capabilities unguessable from chain data: `paid:<HMAC(secret, 'paid' ‖ payer ‖ nonce)>` (Hedera: over the tx id).
4. Update INTERFACES §1.4 (annotation list), §5, A-9, and the `/me/:key` contract in §7.

Regression test to add (builder): `packages/octroi/test/regression/T-37-ledger-capabilities.test.ts` — the three cases above,
asserting the safe behaviour. The red-team attack tests are marked `// RT-FINDING` and suffixed `_RTFINDING`
(vitest filter: `-t '^(?!.*_RTFINDING).*$'`); they must turn green with the fix.

## Builder notes (optional)

Capability ≠ index (INTERFACES A-34). `EntitlementStore` writes `entitlementIndex(key) = 'hk:' + sha256(utf8(key))` as the `key` annotation AND as `payload.key`; `getByKey(capability)` hashes first and refuses an `hk:` value (so a key read off Arkiv opens nothing). Free capability = `ent:v1:HMAC(secret,'entfree'‖campaignId‖nullifier)` — per campaign; the global `quotaKey` never leaves the process (it keys only the claim locks, A-33, which are day-keyed, so two claims ≥ 1 day apart share no identifier). Paid capability = `paid:<payer>:HMAC(secret,'paid'‖network‖payer‖nonce)`. API `MeCache` is keyed by the index so a webhook's invalidation (which only knows the index) still hits. sha256 instead of an HMAC for the index: stores are constructed without the secret (API, agent, these tests) and every capability is ≥ 256 bits of HMAC output; the index equals receipts' `entitlementKeyHash`. Test adaptation: case 2 now ignores A's own entities re-read in B's dump (A's campaign claim record legitimately outlives A's bundle) and compares only what was written for B. Residuals (octroi README Decision 16): `giftent:<giftId>` is derivable from the public gift entity; `AgentPolicyWire.entitlementKey` is still in clear. rt-store forges now target the index.

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): REOPENED.** The octroi regression holds (`rt-keys.test.ts` [RT-O-01] cases and
`test/regression/redteam-wave1.test.ts::RT-O-01` pass; `EntitlementStore.getByKey('hk:…')` returns null), but the
system-level property "a key read off Arkiv opens nothing" is broken by the API's `MeCache`.

### Repro (verification variant)

```sh
cd services/api && npx vitest run test/redteam/verify-rt-o-01-index-cache.test.ts
```

1. Victim provisions a free entitlement and opens `/me/<key>` (the PWA does this on every load) → `MeCache.remember(key, me)`
   stores the response under `entitlementIndex(key)` = `hk:<sha256(key)>`.
2. Attacker reads `hk:<sha256(key)>` off the ledger (annotation `key` / `payload.key`) and calls `GET /me/hk:<sha256(key)>`
   within 60 s. `KEY` (`/^[\x21-\x7E]{8,160}$/`) admits it; `deps.cache.fresh('hk:…')` → `entitlementIndex('hk:…')` is
   idempotent on an index (`keys.ts:76`) → **cache hit**; `getByKey` (which would refuse the index) is never called.
3. Response: **200** with the victim's `MeResponse` — including **`entitlementKey`** (the capability itself), plan, usage,
   expiry. The same applies to `cache.stale()` while the ledger is degraded (any age), and `cache.expired('hk:…')` turns the
   index into a 410-vs-404 liveness oracle.

Failing test (marked `// RT-FINDING`, suffixed `_RTFINDING`):
`services/api/test/redteam/verify-rt-o-01-index-cache.test.ts::/me/<hk:index> after the owner read /me/<key> ⇒ 404, never the owner’s entitlement_RTFINDING`.

Impact: the RT-O-01 impact list in full (capability theft → T-73 b policy squat, top-up target, `/me` privacy) for every
user who has opened `/me` in the last minute — a ledger watcher polling new `hk:` indexes wins reliably.

Suggested fix (builder's choice): in `GET /me/:key` refuse an `INDEX_PREFIX` key before touching the cache (`404`), or key
the cache's capability-facing methods (`fresh`/`stale`/`expired`/`remember`) by a value an index cannot produce (e.g.
reject `hk:` inputs in those methods and keep `invalidate(index)` for webhooks). Not fixed here (red team does not edit `src/`).

## Builder notes (verification fix pass)

`MeCache` (services/api/src/cache.ts) is keyed by HMAC(per-process random secret, capability), never by the ledger index; `fresh`/`stale`/`remember`/`seen`/`expired` refuse an `hk:` value (miss / no-op), and `invalidate(index)` (usage webhooks only know the index) resolves through a write-only index → slot map that no read consults. `GET /me/:key` refuses an `INDEX_PREFIX` key before touching the cache, answers expired and unknown with the same 404 `not_found` (no liveness oracle; the PWA's PlanView tells "expired" from its own snapshot), and serves a stale copy while the ledger is down only for an entry remembered with `staleAllowed` (set for `ready`/`installed`/`active`) whose entitlement has not passed `expiresAt`. OpenAPI and INTERFACES §7 updated; A-45. The top-up guard keeps its 410 for a real capability (AP7.13).

## Verification (red team, closing pass)

**2026-11-04 — redteam-verify closing pass (Claude), against `5a272c5` (fix in `041136f`): REOPENED.** The core
property holds: a ledger-read `hk:` index opens nothing on any route. But the fix's claim "nothing past expiry is
served" does not hold on the 60-s fresh-cache path. The variants are in
`services/api/test/redteam/verify-rt-o-01-variants.test.ts`. The builder's regressions are still green:
`verify-rt-o-01-index-cache` (4/4), `me.test.ts` + `unit/primitives.test.ts` (21/21), and octroi `rt-keys` +
`regression/redteam-wave1` (44/44).

| Variant                                | What was tried                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Result                                                                                                                                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) routes                             | Every `hk:` value read off the ledger (`key` annotation and `payload.key`), in 12 forms: raw, `encodeURIComponent`, upper-cased, `HK:`/`Hk:`, `hk%3A`/`hk%3a`, double-encoded `hk%253A`, fully percent-encoded, the bare hex, `0x`+hex. Sent to `/me/:key` (cached and `?refresh=1`), `/me/:key/receipts`, `/esim/topup?key=`, `GET /agent/policy/:key`, `PUT /agent/policy` (validly signed by a stranger and by the payer), `/gift/claim` (as giftId and as PIN) and `/card/redeem`. Done after the victim primed the cache. | **Holds.** Always 404/400/4xx. No 402 offer was minted, receipts were empty, and no body contained the capability.                                                                                                                                                                    |
| (b) side channel                       | Expired (1 ms past `expiresAt`, while the ledger still holds the row, and again after the ledger dropped it) against a forged unknown `ent:v1:` key. Compared status, body (minus `requestId`), every header except `x-request-id`/`date`, body size, and 200 interleaved timing samples per arm.                                                                                                                                                                                                                              | **Holds.** Status, body, headers and size are identical. Median 0.544 ms vs 0.519 ms. The best threshold classifier reaches 54.0 % (a coin reaches 50 %).                                                                                                                             |
| (c) cache-key confusion                | Near-miss capabilities: case, ±1 character, a `mecache` prefix, a label shifted into the key, double-encoded. Direct `MeCache` probes (prefix, suffix, NUL, case). `remember(index)` and `invalidate(index)`. Two `MeCache` instances. A real `h.restart()` followed by a request while the ledger is down.                                                                                                                                                                                                                    | **Holds.** `hmacKey` concatenates its parts with no separator, but the cache passes one fixed label and one capability, so a collision needs the same capability. HMAC-SHA256 is not open to length extension. After a restart: the owner gets 503 (fail closed), the index gets 404. |
| (d1) ledger down, stale path           | Victim read (`ready`, so `staleAllowed`), then ledger down, at `expiresAt`, +1 ms, +60 s and +8 d, via the capability, the index and `?refresh=1`. Control: 2 min before expiry the degraded copy is served.                                                                                                                                                                                                                                                                                                                   | **Holds.** None of these returned 200.                                                                                                                                                                                                                                                |
| (d2) ledger down or up, **fresh path** | Victim re-reads `/me` 30 s before expiry (the PWA polls). The clock crosses `expiresAt`. The same key is read again within the 60-s TTL.                                                                                                                                                                                                                                                                                                                                                                                       | **FAILS.** 200 with `status: ready` and `expiresAt ≤ now`, with the ledger down **and** with it up, for up to 60 s after expiry. The same key read from the ledger is the 404 of an unknown key.                                                                                      |

### Repro (d2)

```sh
cd services/api && npx vitest run test/redteam/verify-rt-o-01-variants.test.ts -t '_RTFINDING'
```

`MeCache.fresh()` (`services/api/src/cache.ts:49-52`) checks only `now − at < 60 s`, never `me.expiresAt > now`.
`GET /me/:key` (`routes/me.ts:25-28`) consults it before the ledger. So an entry remembered less than 60 s before expiry
outlives the entitlement. This breaks the fix's stated rule: "serves … only for an entry … whose entitlement has not
passed `expiresAt`", and the threat T-35 rule that an entity is live only while `expiresAt` is in the future.

**Severity note.** The caller must already hold the capability, so nothing leaks to a ledger reader, and the window is
at most 60 s. The impact is a live-looking expired bundle and a 60-s 200-vs-404 difference for the same key. The fix
is one line: `fresh()` also requires `hit.me.expiresAt > this.now()`. The finding is kept High and `open` only because
PLAN §1 requires every claimed property of the fix to verify. The lead may downgrade it.

Not verified here (out of RT-O-01's `hk:` scope; already recorded as residuals in octroi README Decision 16):
`AgentPolicyWire.entitlementKey` is still stored in clear on the ledger, and `giftent:<giftId>` can be derived from the
public gift entity.
