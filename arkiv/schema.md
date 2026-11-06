# Arkiv entity schema

Defined once in `arkivSchemas()` (`packages/adapters/src/live/arkiv-sdk.ts`) with the SDK's `defineSchema`, one schema
per type, named `recharge.<type>.v1` (the SDK writes that name as the `arkiv.schema` attribute). The payload JSON is
specified in [`docs/arkiv.schema.json`](../docs/arkiv.schema.json), generated from
`packages/protocol/src/schemas/entities.ts` (`pnpm schema:gen`; CI fails on drift with `pnpm schema:check`).

## Columns (every type)

| Attribute                                                                                                                                                      | SDK type        | Indexed | Meaning                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `payload`                                                                                                                                                      | `bytes`         | no      | UTF-8 JSON, the typed record (≤ 128 KiB)                                                                                                               |
| `createdAtMs`                                                                                                                                                  | `u64`           | no      | write time, ms since epoch                                                                                                                             |
| `rev`                                                                                                                                                          | `u64`, optional | no      | revision for conditional updates (A-32)                                                                                                                |
| `type`                                                                                                                                                         | `str`           | yes     | `entitlement`, `campaign`, `gift`, `nonce`, `receipt`, `agentpolicy`, `claim`                                                                          |
| `logicalKey`                                                                                                                                                   | `str`           | yes     | our key (`hk:<sha256>`, `gift:<id>`, `camp:<id>`, `rcpt:…`, `nonce:…`, `policy:…`, `claim:…`); `key` is reserved in the query language, hence the name |
| `expiresAt`                                                                                                                                                    | `u64`           | yes     | ms; the second clock (`min(ledger expiry, expiresAt)`)                                                                                                 |
| `day`                                                                                                                                                          | `u64`           | yes     | UTC day, on receipts                                                                                                                                   |
| `kind`, `status`, `tier`, `campaignId`, `sponsor`, `iccidHash`, `namehash`, `pinKey`, `serial`, `state`, `nonce`, `entitlementKeyHash`, `receiptKind`, `owner` | `str`           | yes     | set per type, see below                                                                                                                                |

The ledger's own fields (`$key`, `$creator`, `$owner`, `$expiresAt`, …) come from Arkiv. Every read filters
`$creator = <writer>` first (T-79), so look-alike entities written by anyone else are never read.

## Per type

| Type          | Indexed attributes                                                                           | Lifetime                                     |
| ------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `entitlement` | `type, logicalKey, kind, status, tier, campaignId?, iccidHash?, expiresAt`                   | plan validity (7 d default), reset on top-up |
| `campaign`    | `type, logicalKey, sponsor, expiresAt`                                                       | until the campaign's `expiresAt`             |
| `gift`        | `type, logicalKey, kind, state, namehash?, pinKey, serial, campaignId?, expiresAt = claimBy` | `claimBy − now` (7 d)                        |
| `nonce`       | `type, logicalKey, nonce`                                                                    | 300 s                                        |
| `receipt`     | `type, logicalKey, receiptKind, entitlementKeyHash, campaignId?, day`                        | 38 d                                         |
| `agentpolicy` | `type, logicalKey, owner`                                                                    | 30 d                                         |
| `claim`       | `type, logicalKey, expiresAt`                                                                | until its `expiresAt`                        |

No payload carries a nullifier, a clear ICCID, an LPA, a PIN, a private key or a capability key; the red team greps the
ledger dump for them after every e2e run.

## The u64 wrapper (RT-A-15)

SDK 1.0.1 types an untagged JavaScript `bigint` as `u256`. A `u64()` column then refuses it on the client, before any
transaction: `SchemaMismatchError: Column "createdAtMs": a u64 column, but the value is a u256`. So every value crosses
the SDK boundary tagged: `toSdkValues` maps `bigint → u64(v)`, `string → str(v)`, `Uint8Array → bytes(v)`, for both
`createEntity` and `patchEntity`'s `set`. Query values are tagged the same way in `toSdkWhere`. Fix `85f3f69`, regression
test `packages/adapters/test/live/sdk-bindings.test.ts`
([`security/redteam/findings/RT-A-15.md`](../security/redteam/findings/RT-A-15.md)).
