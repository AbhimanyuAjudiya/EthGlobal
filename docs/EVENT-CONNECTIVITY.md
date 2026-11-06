# Event connectivity

Recharge helps event organizers prepare connectivity for international attendees before they travel. It is not tied to one conference, country, or ticket vendor.

## Organizer journey

1. Choose the destination, event dates and a supported provider package. Activation timing and installation deadlines must cover the journey; a package's service validity is not its pre-installation lifetime.
2. Fund a campaign with USDC. The claim price must cover the selected provider package. The funded budget and maximum claim count bound ticket issuance.
3. Use confirmed ticket references to issue private, single-use data-pass links. Deliver these through the organizer's existing ticketing channel. This release does not connect directly to Pretix, ETHGlobal, Devcon, or TOKEN2049 ticket APIs.
4. Read claims and refund progress in the campaign dashboard. After the claim window closes, withdraw unclaimed budget through the original campaign contract.

Only the sponsor can issue passes, using a signature over the exact batch. The dashboard read signature cannot issue passes. Reissuing an existing ticket reference recovers the same pass. Ticket references and pass material stay off the public ledger. Passes are bearer credentials before use, so organizers must distribute them privately; this is not a physical attendance or named-person check.

## Attendee journey

Open the private pass link while online, review the event's terms, and verify with World ID. The private pass grants event eligibility; World ID supplies personhood and one-human-per-campaign protection. An attendee needs neither a crypto wallet nor an on-site check-in to claim.

Save and install the eSIM according to the selected package's activation instructions before departure. First-network packages can be installed without starting service; installation-start packages need additional care. Radio connectivity still depends on a compatible, unlocked device and provider coverage.

Each ticket and each verified person may claim once per campaign. A claim from another event does not consume this event's benefit. The same private browser recovery identity can recover an interrupted operation without paying for a second allocation.

## Two distinct returns

- **Unclaimed budget:** USDC never spent by the campaign stays in DataDrop and is withdrawn by its sponsor under the contract's expiry/pause rules.
- **Claimed, eligible unused allocations:** only newly disclosed, opted-in event campaigns enroll in scheduled reconciliation. After the disclosed event deadline, the API checks the exact provider allocation. Installed profiles, used profiles, and profiles with paid top-ups are excluded. Positive provider cancellation evidence is required before reimbursing the sponsor's original claim price through the operator's USDC treasury.

Provider cancellation credits the reseller account; it does not transfer USDC to the sponsor. The operator treasury funds the separate USDC reimbursement, so the operator bears credit timing and price differences. A global reseller balance change is not itemized refund evidence. Ambiguous cancellations or transfers remain durable pending/manual liabilities and never trigger a blind second payment. Reimbursement does not reopen campaign capacity or decrement on-chain spent amounts.

A confirmed on-chain claim that provably never started a provider order can also be reimbursed after the deadline. This requires an explicit durable pre-order checkpoint; missing historical records do not prove that an order never happened. The audit receipt distinguishes an unallocated claim from a cancelled eSIM.

Legacy profiles have no new cancellation consent and are never automatically enrolled. Legacy public campaign links cannot issue new live ticket benefits. Already-settled operations retain exact recovery; no historical identity locks are reset.

## Release boundary

New event packages initially do not offer paid or automatic top-ups until the provider's exact compatible package, price, and resulting service validity can be quoted together. Existing supported paid-plan top-ups remain separate. Native HashPack policy signing and official Agent Pass client access remain separate integration constraints.

The user owns functional testing of this update. Compilation and source review do not establish completed live ticket claim, provider cancellation, or USDC reimbursement.
