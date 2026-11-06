# Why Arkiv

A mobile-data bundle is a thing with a clock: it is valid for N days, then it is gone. Arkiv entities have the same
shape — data with an expiry the chain enforces — so Recharge keeps the plan clock there instead of in a database plus
a cron job.

- **Expiry is the product.** An entitlement's entity expires when the plan does. A top-up extends the entity's expiry
  (live: Fri 6 Nov 06:14 IST, `0x3166df93…bd25`). Nothing deletes expired plans; they stop existing.
- **Queryable by attribute, no indexer.** Gifts are found by namehash and cards by PIN key — `arkiv_query` over
  annotations, straight from the node ([`README.md`](README.md) has one to paste).
- **Verifiable by people who are not us.** A sponsor (an event like ETHGlobal or Devcon paying for welcome bundles) can
  check every claim against its campaign on a public chain, without access to our servers.
- **Cheap, frequent writes.** Every claim, gift, receipt and agent policy is a write; a fee-per-write chain or an
  append-only log (HCS) cannot also expire and be queried by attribute.

What we use elsewhere, and why not for this: Hedera HCS is our tamper-evident receipt log (append-only, no expiry, no
attribute queries); blob stores such as Swarm or IPFS have no expiry semantics and no queries; a Postgres table would
need a cron job and gives sponsors nothing to verify.
