# `@ethglobal/octroi`

The proof-or-pay quota engine inside Recharge. It covers credential tiers, bundle sizing, pseudonymous keys, MAC-bound challenges, `decide()` (which turns a request into _serve free_, _serve paid_, _402_ or _deny_), the agent's `shouldTopUp`, the gift-reclaim rule, and the ledger stores. The stores are the only code in the repo that builds annotations or calls `ledger.put/query/update`.

The package is pure TypeScript. It does no network I/O and has no clock or randomness of its own. Everything external comes through the injected `Ledger`, `Personhood` and `PaymentRail` ports, `now()`, and `@ethglobal/crypto`. It imports `@ethglobal/protocol`, `@ethglobal/crypto` and the **types** of `@ethglobal/adapters` (root only, never `./live`).

```ts
import { decide, challenge, consumeChallenge, sizeBundle, shouldTopUp, decideGiftReclaim } from '@ethglobal/octroi';
import { EntitlementStore, NonceStore, GiftStore, CampaignStore, ReceiptStore, AgentPolicyStore } from '@ethglobal/octroi/store';
```

Binding spec: `docs/INTERFACES.md` §5 (with §13 A-1, A-3, A-4, A-8, A-9, A-13, A-14, A-17) and `docs/build-briefs/octroi-engine.md`.

## `decide()`: the order is the specification

```
0. request validity   both proof and payment ⇒ invalid-request; mb not an integer ⇒ invalid-request;
                      paid / 402 path: assertMbStep(mb, stepMb, maxMbPerPurchase) else invalid-request
1. FREE LANE (proof)
   a. no campaign ⇒ no-campaign; no challenge / sessionPubKey / counters ⇒ invalid-request;
      challenge.path ≠ '/claim' or audience ≠ AUDIENCE ⇒ invalid-proof            (T-21)
   b. counters, before anything is burned (T-24):
      paused ⇒ paused; now ≥ expiresAt ⇒ expired; claimsThisHour ≥ claimsPerHour ⇒ cap
      (a count from an earlier hour bucket counts as 0); spent + pricePerClaim > budget ⇒ budget
   c. consumeChallenge: replayed ⇒ replay; expired|invalid ⇒ invalid-proof; unavailable ⇒ ledger-unavailable
   d. personhood.verify(proof, { action, signal: signalFor(nonce, audience) })   (recomputed, T-19)
      already_verified ⇒ replay; any other throw ⇒ invalid-proof
   e. tier = tierFromLevel(result.level) (verifier only, T-22); mb = sizeBundle; 0 ⇒ payment-required
   f. quotaKey, campaignClaimKey(auditKey(secret, id), nullifier), onchainClaimKey
   g. existingEntitlement ∨ counters.claimed ∨ EntitlementStore.getByKey(ent:v1:<quotaKey>) ⇒ replay (T-18)
      (lookup throws ⇒ ledger-unavailable)
   h. actionCheck(claimKey) false or throws ⇒ invalid-proof ('action')
   i. serve-free { entitlement (pending-profile), claimKey, campaignClaimKey, tier, mb }
2. PAID LANE (payment)
   a. payment.accepted deep-equals one of buildAccepts(deps, mb, { sessionKeyRequired }) by canonical
      JSON of the RAW echo (asset lower-cased; payTo lower-cased on EVM) ⇒ else requirements_mismatch (T-28)
      the payload fails paymentPayloadSchema ⇒ malformed_payload
   b. requireSessionKey: no sessionPubKey ⇒ invalid-request; EVM nonce ≠ sessionNonce(spk) ⇒ session_binding
      (T-32); Hedera ⇒ session_binding_unsupported (fail closed until the memo can be read [verify Wed])
   c. EVM: authorization.value ≠ amount (exact, T-26) ⇒ amount_mismatch; to ≠ payTo ⇒ recipient_mismatch
   d. payments.verify → !isValid / throws ⇒ invalid-payment          (settle is never called)
   e. payments.settle → throws / malformed / !success (incl. settlement_pending) / network ≠ accepted /
      transaction not 32-byte hex on eip155 or 0.0.x@s.n on hedera / EVM payer ≠ authorization.from ⇒
      invalid-payment (T-27)
   f. serve-paid { entitlement paid:<payer>:<nonce>, settlement, requirements }
3. NEITHER ⇒ payment-required (accepts = steps × price on every template)
```

`decide()` never throws for a business outcome. It throws only for configuration bugs, for example an accept template that fails the x402 schema. The only thing it writes is the consumed-nonce entity in step 1c. It never writes an entitlement, and it never calls the reseller, the chain or HCS. The API does those after `decide()` returns (ARCHITECTURE §2.1 steps 6–7).

**Top-ups:** the API calls `decide()` with the existing entitlement's `mb` request and ignores the `key` of the returned entitlement. It patches the existing entitlement with `EntitlementStore.patch` instead of creating a new one.

### Sequence

```mermaid
sequenceDiagram
  participant API
  participant O as octroi.decide
  participant L as Ledger
  participant W as Personhood
  participant P as PaymentRail
  Note over API,O: free lane (/claim)
  API->>O: proof, challenge, sessionPubKey, campaign, counters
  O->>O: validity, then paused / expired / cap / budget (no I/O)
  O->>L: NonceStore.consumed(nonce)? then put nonce (expiresIn 120)
  O->>W: verify(proof, {action, signal = keccak(nonce‖audience)})
  O->>O: tier from level, sizeBundle, quota/audit/claim keys
  O->>L: EntitlementStore.getByKey(ent:v1:<quotaKey>)
  O-->>API: serve-free | payment-required (device) | deny
  API->>API: DataDrop.claim(claimKey) → reseller.order → EntitlementStore.create
  Note over API,O: paid lane (/esim/*)
  API->>O: payment, mb, requireSessionKey, sessionPubKey
  O->>O: accepted ≡ buildAccepts(mb), session nonce, exact value, payTo
  O->>P: verify
  O->>P: settle (only after verify ok)
  O-->>API: serve-paid | deny
```

## `shouldTopUp` (evaluated top to bottom)

| Condition                                                                                      | Verdict                                                  |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `p.paused`                                                                                     | `{ buy:false, reason:'paused' }`                         |
| `now ≥ e.expiresAt`                                                                            | `{ buy:false, reason:'expired' }`                        |
| `p.topUpOnExpiry ∧ e.expiresAt − now ≤ p.expiryLeadS×1000 ∧ lastExpiryBought === e.expiresAt` | `{ buy:false, reason:'already-bought-for-expiry' }`      |
| `p.topUpOnExpiry ∧ e.expiresAt − now ≤ p.expiryLeadS×1000`                                    | candidate `'expiry'`                                     |
| else `e.mbTotal − e.mbUsed ≤ p.thresholdMb`                                                    | candidate `'threshold'`                                  |
| else                                                                                           | `{ buy:false, reason:'ok' }`                             |
| candidate ∧ `spentTodayUsd6 + stepPriceUsd6 > p.maxUsd6PerDay`                                 | `{ buy:false, reason:'cap' }` (reaching the cap exactly is allowed) |
| candidate                                                                                      | `{ buy:true, mb: p.stepMb, reason, costUsd6: stepPriceUsd6 }` |

"Day" is the UTC `dayBucket`. The agent records `lastExpiryBought = e.expiresAt` after an expiry purchase (T-30).

## `decideGiftReclaim` (evaluated top to bottom)

| Condition                                                                         | Verdict                                   |
| --------------------------------------------------------------------------------- | ----------------------------------------- |
| `!ledgerOk`                                                                       | deny `ledger-unavailable`                 |
| no receipt of kind `gift`, or that receipt has no `network` / `usd6`             | deny `unknown-gift`                       |
| `giftReceipt.payer?.toLowerCase() !== payer.toLowerCase()`                        | deny `not-payer`                          |
| any `gift-claim` receipt, or the escrow is still readable with `state:'claimed'` | deny `claimed`                            |
| any `gift-reclaim` receipt                                                        | deny `already-reclaimed`                  |
| `escrow !== null` (still claimable)                                               | deny `too-early`                          |
| `now < claimBy` where `claimBy = giftReceipt.at + GIFT_CLAIM_WINDOW_S×1000`       | deny `too-early` (escrow dropped early, T-35) |
| `now ≥ claimBy + GIFT_RECLAIM_WINDOW_S×1000`                                      | deny `window-closed`                      |
| else                                                                              | `refund { to: payer, network, usd6: usd6 − min(fee, usd6), feeUsd6: min(fee, usd6) }` |

## Other rules

- **`sizeBundle`** is `min(bundleMb[tier], ⌊8·idResale·1000 / (10·wholesale)⌋, 300)` in bigint arithmetic, with 1 GB = 1000 MB (A-1). `device` and `none` give 0. Wholesale ≤ 0 gives `min(bundleMb, 300)`. A resale price ≤ 0 or a non-integer configured size gives 0. Worked examples: $1.14/GB gives 300, $2.50/GB gives **160**, $5/GB gives 80.
- **Keys.** `quotaKey = HMAC(secret, 'quota' ‖ nullifier)`, `auditKey = HMAC(secret, 'audit' ‖ id)`, `campaignClaimKey = HMAC(audit, nullifier)`, `onchainClaimKey = keccak256(abi.encodePacked(bytes32 id, bytes32 cck))`. The HMACs run over bytes, so hex case does not matter. Inputs must be hex32 (`invalid_request` otherwise). Secrets shorter than 32 bytes throw `internal_error` (T-29).
- **Challenge.** `nonce = random16 ‖ HMAC(secret, random16 ‖ len‖audience ‖ len‖path ‖ u64be(exp) ‖ sessionPubKey)[0..16]`, `exp = now + 120 s`, `signal = keccak256(nonce ‖ utf8(audience))`. Issuing a challenge writes nothing. `consumeChallenge` checks, in order: MAC, session key, path ∈ `CHALLENGE_PATHS`, signal, expiry, skew (remaining life must be at most TTL + 5 s). It then checks and adds the nonce to the in-memory `Set` **synchronously, before the first await**, then reads the ledger, then writes the nonce entity. When the ledger fails it returns `'unavailable'` and the nonce stays in the cache (fail closed).
- **Stores.** Every lookup is `ledger.query({ annotations: { type, …filter }, limit })`. There is no `ledger.get` anywhere, so a caller-supplied entity key never resolves (T-36). An entity counts as live only if the ledger still holds it **and** its numeric `expiresAt` annotation is in the future (T-35); a non-numeric annotation counts as dead. Payloads are validated with the protocol schema on write and on read. A read also re-derives the annotations from the payload and drops the row if any stored annotation disagrees. Malformed rows read as `null` or are skipped. Two live rows for one lookup throw `internal_error`.

## Decisions (where this package goes beyond the spec text)

1. **Length-prefixed MAC fields.** The brief's plain concatenation `audience ‖ path` gives `('recharge/gift', '/claim')` and `('recharge', '/gift/claim')` the same MAC. Each string field is now `u8 length ‖ utf8`. The wire shape is unchanged.
2. **`consumeChallenge` also rejects a `signal` that is not `keccak(nonce ‖ audience)`.** `decide()` passes the _recomputed_ signal to `verify`, never the client's echo.
3. **`decide()` looks up `ent:v1:<quotaKey>` itself** in addition to honouring `existingEntitlement` and `counters.claimed`. The caller cannot know the quota key before `verify`, which runs inside `decide()`. So T-18 no longer depends on the caller remembering the lookup, or on the verifier being one-shot. If the lookup fails, the result is `ledger-unavailable`.
4. **Additive fields (no call site changes).** `OctroiDeps.planId?`: paid entitlements need a `planId`; the default is `''`. `OctroiDeps.nonceCache?`: the API passes its own bounded `Set`. When it is omitted, `decide()` keeps one self-pruning cache per ledger instance, so concurrent calls still share it (T-20). `buildAccepts(deps, mb, { sessionKeyRequired? })`: the 402 body and the paid-lane comparison must use the **same** `extra`.
5. **`accepts[].extra`** is the template's own keys plus `{ mb, stepMb, sessionKeyRequired }`. This binds the MB count into the offer the buyer signs against. Because the comparison runs on the raw echo, an extra key such as a v1 `maxAmountRequired` fails it.
6. **Settlement hardening (T-27).** A settlement is accepted only if it is schema-valid, its `network` equals the accepted network, its transaction id has the right format for the network, and (on EVM) its `payer` equals `authorization.from`. Hedera paid keys use `keccak256(utf8(transaction))` as the nonce part, because a Hedera payload has no EIP-3009 nonce.
7. **Hedera on LPA routes fails closed.** octroi cannot read the transaction memo without the Hedera SDK, so `requireSessionKey` combined with a Hedera payload is denied (`session_binding_unsupported`). Plain Hedera top-ups work. Revisit after the Wednesday recording.
8. **A stale hour bucket counts as 0.** If `counters.hourBucket` is older than `hourBucket(now)`, `claimsThisHour` belongs to a past hour, matching DataDrop's reset.
9. **Stores.** `create` refuses a live duplicate logical key (`replay`) and an already-dead lifetime (`invalid_request`). `CampaignStore.put` and `AgentPolicyStore.put` upsert, re-deriving the lifetime. `EntitlementStore.patch` keeps the logical key, never resurrects an expired entity (`not_found`), and refuses `patch.expiresAt` unless it equals `opts.expiresAt`. `NonceStore.consumed` counts any live row under the key, including a malformed one (fail closed). `GiftStore.markClaimed` is idempotent for the same entitlement key and throws `already_claimed` for a different one.
10. **Gift reclaim.** An escrow that is still readable with `state:'claimed'` gives `claimed`. A gift receipt without `network` or `usd6` gives `unknown-gift`. A fee ≥ `usd6` refunds `0n` (the brief's formula). Whether that should be a deny instead is an open product question. A negative fee is treated as 0. `claimBy` is derived from `receipt.at + GIFT_CLAIM_WINDOW_S`, so if claim windows ever become per-gift this will drift (Low).
11. **`tierFromLevel`** maps any value outside the four levels to `none`, which sizes to 0.

## Notes for the red team (`security/redteam/attacks/wave1-octroi.md`)

- Each attack is encoded in `test/attack/*.attack.test.ts`. The shared fixture at `test/attack/fixture.ts` re-exports `test/helpers.ts`.
- The script's `Object.create(d.ledger, { put })` wrapper does not work with `InMemoryLedger`, which keeps its state in `#private` fields: inherited methods throw a `TypeError`. Use a delegating wrapper (`ledgerWith` in the helpers).
- The script's accept template has no `extra`. The x402 schema requires `extra.{name, version}` on EVM, so the helpers use `USDC_EIP712_DOMAIN`.
- O8: `decide()` writes exactly one entity, the consumed nonce. That write is the T-20 control, not an entitlement.
- T-79 (`$creator` filtering) needs the creator on `LedgerEntity`, which the port does not expose, so it is the `ArkivLedger` adapter's job. The stores add two layers on top: the annotation/payload consistency check, and the duplicate-row ⇒ `internal_error` rule.
- `MockPersonhood` has no `maxVerifications` option. Its default is one-shot. O1 runs against both a permissive stub and the one-shot mock.

## Development

```sh
pnpm --filter @ethglobal/octroi test       # vitest: unit, store, property (fast-check ≥ 200 runs), attack, design bans
pnpm --filter @ethglobal/octroi coverage   # v8, thresholds 100 % lines/branches/functions/statements
pnpm --filter @ethglobal/octroi typecheck
pnpm --filter @ethglobal/octroi build      # dist/ (".", "./store")
```
