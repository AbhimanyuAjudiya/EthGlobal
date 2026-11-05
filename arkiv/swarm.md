# Swarm (bonus)

The full design is [`docs/SWARM.md`](../docs/SWARM.md). In one line: the eSIM activation code (LPA) is sealed to the
buyer's browser session key and stored on Swarm (`POST /bzz` with a postage batch,
`packages/adapters/src/live/swarm-blobs.ts`); the Arkiv `entitlement` carries only `sealedRef = bzz://<reference>`.

Status, honestly: no live entity key ↔ Swarm reference pair exists yet. The only live entitlement on rabdi
(`0xcfca33d1…55e7`, see [`README.md`](README.md)) is `pending-profile` because no eSIM order was placed (the reseller
balance was $0.00), so nothing was sealed or uploaded. In `MODE=local` the pair is produced by every claim
(`MemoryBlobStore`, content-addressed).
