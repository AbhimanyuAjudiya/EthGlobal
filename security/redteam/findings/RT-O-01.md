---
id: RT-O-01
title: Entitlement capabilities and the global quotaKey pseudonym are written in clear to the public ledger; paid keys are derivable from the on-chain payment
module: packages/octroi/src/store/entitlement.ts
threat: T-37
severity: High
likelihood: H
status: fixed
found_by: redteam-octroi
owner: builder-octroi
found_at: 2026-11-04T05:40+05:30
due: 2026-11-04T09:40+05:30
attack_test: packages/octroi/test/redteam/rt-keys.test.ts::the /me/:key capability of a free entitlement does not appear on the public ledger_RTFINDING
regression_test: packages/octroi/test/redteam/rt-keys.test.ts::the /me/:key capability of a free entitlement does not appear on the public ledger [RT-O-01] (+ the two other [RT-O-01] cases in that file; packages/octroi/test/regression/redteam-wave1.test.ts::RT-O-01)
fix_commit: (uncommitted, wave-1 octroi fix pass; orchestrator commits)
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
