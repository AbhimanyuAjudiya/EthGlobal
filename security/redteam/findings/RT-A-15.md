---
id: RT-A-15
title: ArkivLedger cannot write on rabdi — SDK 1.0.1 types a bare bigint as u256, so every u64 column (createdAtMs, rev, expiresAt, day) fails the SDK's client-side schema check
module: packages/adapters/src/live/arkiv-sdk.ts
threat: T-35
severity: High
likelihood: H
status: fixed
found_by: orchestrator (live pre-deploy)
owner: builder-adapters
found_at: 2026-11-05T15:55+05:30
due: 2026-11-05T19:55+05:30
attack_test: 'packages/adapters/test/live/sdk-bindings.test.ts::pre-fix shape (bare bigint): the real SDK refuses the create and the patch before any RPC — SchemaMismatchError'
regression_test: 'packages/adapters/test/live/sdk-bindings.test.ts::createArkivClient: createEntity and patchEntity pass the schema check and fail only at the transport (+ ::toSdkValues tags every value by its column type: bigint → u64, string → str, Uint8Array → bytes; ::where: $creator first, then attribute equalities, then $key pagination asserts the u64 tag on numeric equalities)'
fix_commit: 85f3f69 (cherry-picked from the worktree commit 4c77949)
verified_at:
duplicate_of:
sign_off:
---

## Repro

First real write on rabdi (chain 7794095, `@arkiv-network/sdk@1.0.1`, Hub access key and RPC fine — `blockNumber()`
answered 244094). Every `ArkivLedger.put()` threw `AdapterError ledger: SchemaMismatchError`; the raw SDK client shows the
cause, raised **before any transaction** (the check is client-side):

```
SchemaMismatchError: Column "createdAtMs": a u64 column, but the value is a u256. Write u64(...) around the value.
```

Offline, with the real SDK (no RPC leaves the process):

```sh
cd packages/adapters && npx vitest run test/live/sdk-bindings.test.ts -t 'RT-A-15'
```

1. `arkivSchemas()` declares `createdAtMs: u64()`, `rev: u64().optional()` and the `NUMERIC_ANNOTATIONS` (`expiresAt`,
   `day`) as `u64().indexed()`; `ArkivLedger.encodeValues` hands over plain `bigint`s for all four.
2. SDK 1.0.1's `toValue` types an untagged `bigint` as **u256** (a `number` as i32, a `string` as str, a `Uint8Array` as
   bytes); `encodeColumn` then compares the tag with the column's and throws `SchemaMismatchError` on the first u64
   column it meets. `patchEntity`'s `set` runs through the same `encodeColumn`.
3. `MODE=local` never runs the SDK validator (`FakeArkiv` + fixtures), so the shape was wrong since the adapter was
   written and surfaced only on the live chain.

## Impact

No entitlement, gift, nonce, receipt, campaign, agent policy or claim lock can be created or patched on the live ledger:
`ArkivLedger.put`/`update` fail on every call. The plan clock is Arkiv (T-35: `$expiresAt` + the `expiresAt`
attribute are the two expiry clocks every load-bearing read uses), so in `MODE=live` the product cannot issue a bundle,
hold a gift escrow, record a receipt, or take a claim lock — a complete outage of the write path, found at the pre-deploy
with no on-chain or money side effect (nothing was sent). Reads (`select`, `getEntity`) were unaffected: `toSdkWhere`
already tagged its values (`u64`/`str`/`addr`/`key`).

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Found and fixed by the orchestrator at the pre-deploy. Every attribute value crosses the SDK boundary tagged:
`toSdkValues` in `packages/adapters/src/live/arkiv-sdk.ts` maps `bigint → u64(value)`, `string → str(value)`,
`Uint8Array → bytes(value)` and is applied to `createEntity`'s values and to `patchEntity`'s `set`. `extendEntity`
carries no attribute values; `toSdkWhere` was already correct; `fromSdkRow` still unwraps `{ type, value }` rows to
plain `bigint`/`string`/`Uint8Array`. `ArkivLedger` (`arkiv-ledger.ts`) is untouched — the wrapper belongs at the one
file that imports the SDK.

## Builder notes (optional)

The regression suite uses the real SDK with a transport that answers every JSON-RPC request with a sentinel error (code
4242, which viem never retries). A write refused by the schema never reaches that transport; a write that passes it fails
with the sentinel. The suite asserts both directions: the pre-fix bare-bigint shape against the real SDK wallet client
still throws `SchemaMismatchError` with zero methods sent (so the test is not vacuous), and `createArkivClient`'s
`createEntity`/`patchEntity` now throw the sentinel with methods recorded. Recorded facts: `docs/vendor/API-FACTS.md` §3.3
(value typing), `docs/ARKIV_FEEDBACK.md` §5 item 9. Live write to be re-run by the human at the Wednesday pre-deploy step
that found it.

## Verification (red team)

Pending (`status: fixed`): re-run the two cases above and one real `createEntity` on rabdi, then set `verified_at`.
