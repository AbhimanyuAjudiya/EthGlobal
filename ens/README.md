# ENS: a name for every sponsor campaign (ENSv2, Sepolia)

Every sponsor campaign in Recharge gets its own ENSv2 name, **`<slug>.re-charge.eth`**. A traveller scans a
venue poster or types the name, the browser resolves it on Sepolia with plain viem, and "Get 1 GB free" runs the World
ID claim for that campaign. The sponsor owns the name but cannot transfer it, and it expires when the campaign does.
Recharge writes the records that matter: the claim URL, the campaign id, the DataDrop pool and the bundle. The sponsor
can set only its branding: avatar, description and X handle. ENSv2's per-key access control on the campaign's own
resolver enforces that split, not our API.

Feasibility spike, with every transaction and its gas: [`SPIKE.md`](SPIKE.md). Scripts: [`scripts/ens/`](../scripts/ens).

## What is ENSv2-specific

| ENSv2 feature                             | How Recharge uses it                                                                                                                                                                                                                                                                                                                                                          | Where                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Our own subname registry**              | A `UserRegistry` proxy, deployed through the `VerifiableFactory`, is `re-charge.eth`'s subregistry on the v2 `.eth` registry. The API's key (the DataDrop attestor `0x69D0…fc88`) is its registrar: `ROLE_REGISTRAR`, `ROLE_RENEW`, `ROLE_UNREGISTER`, `ROLE_SET_RESOLVER` and `ROLE_SET_PARENT`, each with its admin role. No upgrade role, so nobody can upgrade the proxy. | [`SPIKE.md`](SPIKE.md) steps 5–6                                                                          |
| **Expiring, non-transferable names**      | `UserRegistry.register(slug, sponsor, 0x0, resolver, 0, campaign.expiresAt)`. With role bitmap `0` the token has no `ROLE_CAN_TRANSFER_ADMIN`, so a transfer reverts with `TransferDisallowed`. The name dies with the campaign.                                                                                                                                              | [`ens-campaigns.ts`](../packages/adapters/src/live/ens-campaigns.ts) step 2                               |
| **A `PermissionedResolver` per campaign** | Each campaign gets a resolver proxy from the `VerifiableFactory`, salt `keccak256(campaignId)`. Its `initialize` grants the API its roles and writes `url`, `recharge.campaign`, `recharge.pool`, `recharge.bundle`, `recharge.arkiv` and `description`, all in one transaction.                                                                                              | [`ens-campaigns.ts`](../packages/adapters/src/live/ens-campaigns.ts) step 1                               |
| **Per-key Enhanced Access Control**       | The sponsor gets `ROLE_SET_TEXT` only on the resources `keccak256("avatar")`, `keccak256("description")` and `keccak256("com.twitter")`. The grants are `grantSetterRoles` calls batched in one `multicall`. Setting any Recharge key reverts on-chain.                                                                                                                       | [`ens-campaigns.ts`](../packages/adapters/src/live/ens-campaigns.ts) step 3 · proof below                 |
| **Plain viem resolution**                 | `getEnsText` on viem's `sepolia` chain. Its default Universal Resolver `0xeeee…eeee` is pointed by ENS at `UniversalResolverV2`, so there is no custom read path. `/c/<slug>` resolves in the browser and trusts a name only when `recharge.pool` is our DataDrop on Hedera (`eip155:296:…`) and `UserRegistry.getExpiry` is in the future.                                   | [`lib/ens.ts`](../apps/web/lib/ens.ts), [`CampaignByName.tsx`](../apps/web/components/CampaignByName.tsx) |
| **Sponsor-signed branding**               | On the sponsor page, "Edit branding" switches the wallet to Sepolia and sends `setText`, or a `multicall` of several, straight to the campaign's resolver. The API is not involved.                                                                                                                                                                                           | [`EnsCampaign.tsx`](../apps/web/components/EnsCampaign.tsx)                                               |

How the API runs it: after `POST /sponsor` answers 201, a background job does the work. It picks the slug, which is the
kebab-case of the campaign name, made unique with `-2`, `-3`… on the UserRegistry. It saves
`campaign.ens = { name, status: 'pending' }`, then runs the three steps. Every step reads first, so a retry or a
restart never sends anything twice. Transactions go one at a time, with the job's own nonce and a wait for each receipt.
The outcome, `registered` or `failed` after retries, is stored on the campaign entity and shown by `GET /sponsor/:id`.
An ENS failure never fails the registration. See [`flows/ens.ts`](../services/api/src/flows/ens.ts).

## On-chain proof (Sepolia)

| What                                                                                                                            | Transaction                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `re-charge.eth` registered through the v2 `ETHRegistrar` (commit–reveal, 1 year)                                                | [0xc12c8337…](https://sepolia.etherscan.io/tx/0xc12c8337b7d73a983a0de15003a4d7d5a524194fb7de151b217afcd56e6f1199)                                                                                                                                                                                                                                         |
| UserRegistry proxy deployed · set as `re-charge.eth`'s subregistry                                                              | [0x5de9fb0a…](https://sepolia.etherscan.io/tx/0x5de9fb0a8c027a91ff10dd2743b6ebd8cfd0bbc9a514808ac2d330b59b954361) · [0x211a163f…](https://sepolia.etherscan.io/tx/0x211a163f66a1351016f6001487e42ee3ef39d394c62299bf5b0af4990f724f5e)                                                                                                                     |
| `spike.re-charge.eth`: resolver with its records · name to the sponsor (bitmap 0) · sponsor key grant                           | [0xabdfef2c…](https://sepolia.etherscan.io/tx/0xabdfef2cf7b02909c36f47de6b59c9b7e9a4abde9e723c1b6b2e0214c0fe57df) · [0x3bb53a46…](https://sepolia.etherscan.io/tx/0x3bb53a46a354e8801c8e33ec7967f6d188af4fa88a29c3a45888ce8f4194976f) · [0xc92c3c80…](https://sepolia.etherscan.io/tx/0xc92c3c80fe87ff67db9ef359a2f4045da64185740b12b012a32e26ddbdbebde7) |
| **EAC:** the sponsor sets `avatar`, which succeeds                                                                              | [0x062818ef…](https://sepolia.etherscan.io/tx/0x062818ef47d3a7167752a82403b7423776475dd3c08d7d49e0c7705a425341df) · [0xb5620fec…](https://sepolia.etherscan.io/tx/0xb5620fec19e2ce6c341f2fdf2841d112539db7ce225cb9e1fcb37f5e6b6c8ffa)                                                                                                                     |
| **EAC:** the sponsor sets `url`, which **reverts** with `EACUnauthorizedAccountRoles(keccak256("url"), ROLE_SET_TEXT, sponsor)` | [0xa60e08af…](https://sepolia.etherscan.io/tx/0xa60e08af0032cae8c99032c3d0069c317e4cba3bab00b43ab55683b7b71cbb5a) (status 0)                                                                                                                                                                                                                              |

| Contract                                                                         | Address                                                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `re-charge.eth` UserRegistry                                                     | [`0x297320862052B1d0e069502c0D5DE12841E2EA41`](https://sepolia.etherscan.io/address/0x297320862052B1d0e069502c0D5DE12841E2EA41) |
| `spike.re-charge.eth` PermissionedResolver                                       | [`0xe1ea7EC45d82cB79E8DfD959F4aBFe1212e64C1f`](https://sepolia.etherscan.io/address/0xe1ea7EC45d82cB79E8DfD959F4aBFe1212e64C1f) |
| ENSv2 Sepolia: VerifiableFactory · PermissionedResolver impl · UserRegistry impl | `0xda70306c…2991` · `0x115eb53f…2b2c` · `0x9bd8a887…366a` ([full table](SPIKE.md#addresses))                                    |

Read it yourself with stock viem: `node scripts/ens/read.mjs spike.re-charge.eth 0x297320862052B1d0e069502c0D5DE12841E2EA41`.
The non-transfer and role proofs can be replayed with eth_calls, at no gas: `scripts/ens/check.sh <userRegistry> <resolver> <sponsor>`.

**Live vs pending.** Live on Sepolia now:

- `re-charge.eth`
- its UserRegistry
- `spike.re-charge.eth`, made by `scripts/ens/spike.sh` with the same call sequence the API uses

The API job, the sponsor-page section and `/c/<slug>` are in the code with tests. They switch on with `ENS_ENABLED=true`
on the server. The first real campaign name appears with the next campaign registered after that deploy. `defaults.re-charge.eth`
was a spike test of record aliasing. It expires on its own, and the product does not use aliasing, because `linkToNode` swaps
whole records.

## Gas and cost (Sepolia)

| Per campaign name (what the API sends)                      | Gas                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| Resolver proxy plus 6 text records, written in `initialize` | ≈ 3.0 M (estimate; the spike's 4 records used 2.28 M)  |
| `UserRegistry.register`                                     | ≈ 0.4 M (spike: 0.39 M)                                |
| Sponsor key grants: 3 keys in one `multicall`               | ≈ 0.66 M (estimate; the spike's 1 key used 0.26 M)     |
| **Total**                                                   | **≈ 4 M**, about 0.001 ETH at this week's 0.2–0.4 gwei |

Sepolia now charges far more than mainnet does today for creating state. A transfer to a fresh account costs 207 k gas
there, so these numbers overstate what the same calls would cost elsewhere. One-time setup (`re-charge.eth` and the
UserRegistry) took 2.1 M gas. The registrar fee was 8 MockUSDC. The registrar key holds about 0.49 Sepolia ETH, enough
for hundreds of campaign names.

## Why Sepolia

ENSv2 is live on Sepolia. On mainnet the ENSv2 contracts are deployed but not active: until the v2 launch, mainnet
registration and resolution still go through ENSv1 ([deployments](https://docs.ens.domains/learn/deployments)). Recharge's
money stays on Hedera (`eip155:296`). The name only points at it, through `recharge.pool`, so the two chains never have to
agree on anything but that string.
