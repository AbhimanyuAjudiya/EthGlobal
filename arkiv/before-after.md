# Arkiv: before the Mumbai kickoff versus in the window

Kickoff: Thu 5 Nov 2026 21:00 IST. Pre-kickoff tag `v0-prekickoff` = commit `380ff32` (committed 20:20:57 IST; the tag
object was created at 21:16 IST, with no commit in between; [`docs/DISCLOSURE.md`](../docs/DISCLOSURE.md) §1).

## Before kickoff (at `v0-prekickoff`)

From `git log v0-prekickoff -- packages/adapters/src/live/arkiv* fixtures/arkiv docs/ARKIV_FEEDBACK.md packages/octroi/src/store`:

| When (IST) | Commit | What |
|---|---|---|
| Tue 3 Nov 23:50 | `4c2056a` | the Arkiv live adapter (`arkiv-ledger.ts`, `arkiv-sdk.ts`) and its authored fixtures (`fixtures/arkiv/{create,get,query,update,expired}.json`) |
| Wed 4 Nov 09:10–22:25 | `e39897a`, `c577fc7`, `10f68a7`, `041136f`, `69ad131` | red-team waves 1–3 and their fixes (store races RT-O-03/05/06 → `ifAbsent`/`ifVersion`) |
| Thu 5 Nov 15:45 | `d4b4df6` | live rabdi RPC fixture (`fixtures/arkiv/live-rpc.json`) |
| Thu 5 Nov 16:02 | `85f3f69` | RT-A-15: u64 tagging, the fix that made live writes work |
| Thu 5 Nov 16:08 | `6513e8b` | live `arkiv_getEntity` fixtures: a fresh entity and an expired one (`null`) |
| Thu 5 Nov 17:07 | `ab94753` | `docs/ARKIV_FEEDBACK.md` §4 latencies and the Hub/faucet feedback |

On chain before kickoff: the `ArkivLedger` round-trip entity `0xb9429fbd…abb1`, the raw-SDK entity `0x73d83f38…a9dd`
(observed expiring), and 13 entities written by the live API, all created on Thu 5 Nov between 16:17 and 18:54 IST
(claim locks, two gifts, receipts, the hello campaign, and the one entitlement of the real Orb claim). The 13 are listed
by the query in [`README.md`](README.md) with `type` dropped from the filter.

## In the window (since Thu 5 Nov 21:00 IST)

Honestly small so far. `git diff --stat v0-prekickoff..HEAD` over the Arkiv code paths (`arkiv-ledger.ts`,
`arkiv-sdk.ts`, `packages/octroi/src/store`, `packages/protocol/src/schemas/entities.ts`, `fixtures/arkiv`,
`docs/arkiv.schema.json`) is **empty**: no Arkiv code changed after the tag. What the window added:

- the live API on AWS in `MODE=live` (since Fri 6 Nov 02:50 IST), which writes every claim, gift and receipt to rabdi
  with the same code;
- this `arkiv/` folder (Fri 6 Nov), including the `AND` query check against the node.

As of Fri 6 Nov 05:22 IST the writer has **no entity created after kickoff** (every row the query returns has
`createdAtMs` before 21:00 IST Thu). The first in-window entity comes with the first in-window claim, gift or top-up on
the live API; its key goes here and into `docs/SWARM.md`.
