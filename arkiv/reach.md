# Reach

**Who touches Arkiv through Recharge**

- **Travellers landing in India** (the first market): every free bundle, paid plan, gift and scratch-card redemption is
  an Arkiv entity; `GET /me/:key` and the plan page read it on every visit.
- **Sponsors** — event organisers and protocols that pay for welcome data at hackathons and conferences: each campaign
  and each claim against it is an entity they can audit.
- **Agents**: the top-up agent reads remaining MB from the plan's entity on every tick and its policy is an
  `agentpolicy` entity.

**Live today** (testnet rails): https://app.recharge.ajudiya.com, API https://api.recharge.ajudiya.com, writer
`0xC3358be9F35fDF5C8e1922be7376980C93734d3c` on rabdi (7794095). Entities to date: 13 written before kickoff (claim locks,
gifts, receipts, the hello campaign, the Orb-verified claim) and the in-window plans and top-up listed in
[`before-after.md`](before-after.md).

**Where it goes next**: one sponsor campaign at an event like ETHGlobal or Devcon is hundreds to thousands of claims —
one entity each, expiring on its own; the same flow serves any country eSIM Access covers.
