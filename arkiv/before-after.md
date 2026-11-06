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

First in-window entities (Fri 6 Nov, live API, same code):

| When (IST) | Entity | What happened |
|---|---|---|
| Fri 6 Nov 05:22 | `recharge.entitlement.v1` [`0x3166df93…bd25`](https://rabdi.explorer.arkiv.network/entity/0x3166df93b01eba1d6ff30e00dd3d36e7b0ec461754846c33ebcd63ba6080bd25) | a 300 MB plan bought over x402 (Base Sepolia) by the top-up agent's key; expiry = plan expiry (Fri 13 Nov 05:22) |
| Fri 6 Nov 05:34 | `recharge.entitlement.v1` [`0xea35cfb2…74fe`](https://rabdi.explorer.arkiv.network/entity/0xea35cfb2d96d838e5795468d1c7db6f91b547badb43e518f4af3f87394cb74fe) | a 300 MB plan bought in the browser with RainbowKit (Base Sepolia); the plan page shows "Plan written to Arkiv" |
| Fri 6 Nov 05:51 / 05:54 | both entities | updated when eSIM Access allocated the profiles (`pending-profile` → `ready`) |
| Fri 6 Nov 06:14 | `0x3166df93…bd25` | updated by the agent's autonomous Hedera top-up (`0.0.9185802@1793925870.465901542`): 300 → 400 MB, and the entity's expiry moved to Fri 13 Nov 06:14 — the plan clock extended on Arkiv |

The Arkiv **code** is unchanged since the tag; what is new is live traffic through it: the first paid plans, the first
profile allocations and the first top-up that extends an entity's expiry.
