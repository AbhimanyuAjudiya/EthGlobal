---
id: RT-O-02
title: Hybrid Hedera payload (decoy `authorization` beside `transaction`) defeats the Hedera fail-closed rule on LPA routes and the paid-lane EVM checks
module: packages/octroi/src/decide.ts
threat: T-32
severity: High
likelihood: M
status: open
found_by: redteam-octroi
owner: builder-octroi
found_at: 2026-11-04T05:40+05:30
due: 2026-11-04T09:40+05:30
attack_test: packages/octroi/test/redteam/rt-payment.test.ts::a Hedera payment with a decoy `authorization` beside `transaction` is still refused on an LPA route_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd packages/octroi && npx vitest run test/redteam/rt-payment.test.ts -t 'hybrid Hedera'
```

1. Offer: `buildAccepts(deps, 100, { sessionKeyRequired: true })` → the `hedera:testnet` entry (an LPA route, e.g. `/esim/provision`).
2. Payment: `{ x402Version: 2, accepted: <that offer>, payload: { transaction: <victim's genuine base64 HTS transfer>,
authorization: { from: '0.0.777', to: offer.payTo, value: offer.amount, validAfter: '0', validBefore: '9999999999',
nonce: sessionNonce(ATTACKER_SPK) } } }` — note: **no `signature`** in the decoy.
3. `decide({ …, payment, requireSessionKey: true, sessionPubKey: ATTACKER_SPK })` with an honest Hedera facilitator →
   **`serve-paid`**. Expected `deny: invalid-payment (session_binding_unsupported)` (README decision 7).

Second case (same root cause): decoy `authorization` without `from` → `decide()` **throws** `TypeError` (in `settle()`'s
payer check) instead of returning a deny (ARCHITECTURE §9 rule 2).

## Root cause

`paymentPayloadSchema` validates a _parsed_ copy: the decoy fails the EVM branch (no `signature`), the Hedera branch matches,
zod strips the unknown `authorization`, and the kind/network refinement runs on the stripped value — so the payload is
"valid Hedera". `paidLane` then discards the parsed value and uses the **raw** object, where `isEvmExact(raw.payload)`
(`'authorization' in p`) is true: `sessionBound` checks the decoy's nonce instead of failing closed, `value`/`to` are checked
against the decoy, the settlement payer is compared with the decoy's `from`, and the entitlement key uses the decoy's nonce
(`paid:<payer>:<attacker-chosen nonce>`).

## Impact

The T-32 MITM: an on-path attacker swaps `X-Session-Pubkey` to its own key and adds the decoy; the victim's signed HTS
transfer is untouched, so the facilitator settles it and the API seals the **LPA to the attacker**. Decision 7's fail-closed
rule exists precisely because octroi cannot read the Hedera memo; this payload walks around it. The attacker-chosen nonce
also lets a re-submitted Hedera transaction mint fresh `paid:` keys if a facilitator settles idempotently (see RT-O-05).

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

In `paidLane`, use the parsed value everywhere: `const parsed = paymentPayloadSchema.safeParse(payment); … const p = parsed.data;`
and pass `p` to `sessionBound`, the EVM checks, `settle()` and the entitlement builder. Additionally make the payload
branches strict (`z.strictObject` for `evmExactPayloadSchema` / `hederaExactPayloadSchema` in `@ethglobal/protocol`), so a
payload carrying both shapes is rejected as `malformed_payload`. Hand the parsed payload (not the raw one) to `payments.verify/settle`.

Regression test to add (builder): `packages/octroi/test/regression/T-32-session-binding.test.ts` (case: hybrid Hedera payload
on an LPA route ⇒ deny; decoy without `from` ⇒ deny, no throw). The `_RTFINDING` tests must turn green.

## Builder notes (optional)

## Verification (red team)
