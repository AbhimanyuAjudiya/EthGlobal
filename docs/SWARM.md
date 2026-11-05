# Arkiv + Swarm: what each platform stores

A Recharge bundle is an eSIM activation code (an LPA string, `LPA:1$<SM-DP+>$<matching-id>`). Whoever reads it first
can install the profile. So the code is **sealed to the buyer's session key** and stored as a ciphertext blob on Swarm.
Arkiv holds the entitlement metadata and a reference to that blob.

| Platform | Stores | Readable by |
|---|---|---|
| **Arkiv** (rabdi, chain 7794095) | the `entitlement` entity: kind, tier, MB total/used, usage time, expiry, `iccidHash` (sha256), `iccidEnc` (the ICCID sealed to the server's own key), and `sealedRef` = the Swarm reference | anyone: payloads are public by design and carry no secret ([`arkiv.schema.json`](arkiv.schema.json)) |
| **Swarm** (Bee `/bzz`) | the **sealed LPA** (the JSON `SealedBox`, `application/json`): an XChaCha20-Poly1305 box to an X25519 public key that only the buyer's browser session holds | anyone can download it; only the buyer can open it |
| our API | nothing durable: the LPA is sealed and handed back in the `POST /claim` response (`sealedLpa`), then forgotten | — |

**Why the blob is public-safe.** `packages/crypto` seals the LPA (`sealLpa`) with an ephemeral X25519 key agreement to the
`sessionPubKey` the browser generated for this claim, HKDF-SHA256 (`info = 'recharge/lpa/v1'`), then XChaCha20-Poly1305
with a fresh 24-byte nonce and associated data
`lpaAad(challenge.nonce, entitlementKey)`. The ciphertext only opens with the session secret, which never leaves the
browser, and only for that challenge and that entitlement. Without that key the blob reveals its length and nothing
else. The server's own copy of the ICCID (`iccidEnc`) is sealed separately to `SERVER_SEAL_KEY`. The clear ICCID, the
LPA and the session secret are never written to Arkiv, to Swarm or to a log (THREAT-MODEL T-37, T-31). The red team
greps the logs and the ledger dump for them after every e2e run.

## The entity key ↔ Swarm reference pair

| Where | Arkiv entity key | Swarm reference (`sealedRef`) |
|---|---|---|
| live, the first in-window claim | `TBD by human (Integrations, Fri 06:00)` · `https://rabdi.explorer.arkiv.network/entity/<key>` | `bzz://TBD by human (Integrations, Fri 06:00)` |
| `MODE=local` (format example) | `ent_000001`… (`InMemoryLedger` sequence) | `bzz://<sha256 of the sealed box, 64 hex>` (`MemoryBlobStore` is content-addressed) |

In `MODE=local` the pair lives inside the API process. Run `bash scripts/e2e-local.sh --keep` and claim once, and the
entitlement entity's payload carries `sealedRef` in the format above. The live `SwarmBlobStore` returns Bee's
64-hex (or 128-hex, encrypted) reference as `bzz://<reference>`.

## Bee API calls used (`packages/adapters/src/live/swarm-blobs.ts`)

| Call | When | Notes |
|---|---|---|
| `POST {SWARM_BEE_URL}/bzz` with headers `content-type` and `swarm-postage-batch-id: <SWARM_POSTAGE_BATCH>`, body = the sealed box bytes | after a successful order, before the response | response `{ reference }` (64 or 128 hex). 413 → `too_large`, 402 → `unavailable`; the blob is ≤ `MAX_BLOB_BYTES` |
| `GET {SWARM_BEE_URL}/bzz/{reference}/` | read-back (adapter contract suite); no API route reads it yet. The re-delivery of a pending profile is the open finding AP6.3 in `services/api/README.md` | 404 → `null` (the reference is gone) |

## Postage batch

| Item | Value |
|---|---|
| Bee gateway (`SWARM_BEE_URL`) | TBD by human (Integrations, Thu 21:30): ask Arkiv/Swarm devrel which gateway the bonus expects (DECISION §7.4) |
| Postage batch id (`SWARM_POSTAGE_BATCH`, 64 hex) | TBD by human (Integrations, Thu 21:30) |
| Depth / amount / TTL of the batch | TBD by human (Integrations, Thu 21:30) |

Fixtures to overwrite with live recordings: `fixtures/swarm/*.json` (`packages/adapters/README.md`, "Record on
Wednesday").
