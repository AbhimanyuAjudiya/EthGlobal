# Recharge repair and verification — 6 November 2026

This records the code audit, fixes, and validation performed in this checkout. Passing tests reduce risk; they do not establish that every external service or physical device will always work.

## Correctness and recovery

- A paid operation retains its exact signed authorization, private retry token, request, settlement, and target entitlement. Retrying or reopening a browser resumes that operation instead of paying again. The backend journals settlement before marking a payment served. Daily limits include settled operations whose accounting receipt is still being repaired.
- New eSIM provisioning records its delivery target before external writes. Delayed profiles can be retrieved only as ciphertext bound to the original session key. The browser persists that key encrypted in IndexedDB until delivery is saved.
- Recovery cannot revive a cancelled or expired entitlement after its live ledger record disappears. Delivery and boot retries check the original expiry and cancellation records before provisioning; regression tests also reject expired free, card, and gift recovery with the exact original private token and session.
- Top-ups and cancellations share an entitlement mutex. Top-ups use the latest stored capacity and an applied-operation marker, and the provider must confirm increased capacity. New quotes reject unsupported provider capacity before payment.
- Free claims journal reservation ownership before acquiring locks. Partial failures release only locks owned by that operation; restart recovery can distinguish incomplete reservations from settled claims.
- Free, card, and gift redemptions persist a private operation token and encrypted session before submission. If the first response is lost, a fresh proof, PIN, or wallet signature can recover the original result only with that operation's token and session. A public session key alone is not treated as proof of ownership.
- Refunds journal their signed transaction before broadcast and retry exactly that transaction. Confirmed transaction identities survive receipt-write failures. Pending liabilities do not expire. Expired native Hedera transactions become manual review after a mirror grace period, while their original identity remains monitored for late confirmation.
- Unjournaled EIP-3009 recovery matches both the exact nonce and transfer in one transaction. It is bounded by the actual block timestamp to 37 days, below the 38-day consumed-payment marker retention, including authorizations with far-future expiry.
- Gift entitlement capabilities use a keyed derivation; public gift IDs do not reveal them. New gift claims and agent-policy indexes avoid publishing private capabilities. Legacy policy migration retains owner, pause state, newest policy, and last purchased expiry.
- Per-network payment and refund clients use the correct RPC and token. Hedera mirror duplicate records cannot hide the original successful transaction. Agent retries preserve the original payment and do not infer success from an unrelated balance increase.
- eSIM Access status handling distinguishes depleted, installed, expired, cancelled, and unknown profiles. Depleted eligible profiles can top up; unsafe or unknown states cannot be treated as unused cancellable profiles. The provider integration follows the [official API documentation](https://docs.esimaccess.com).

## Interface and maintenance

- Responsive layouts cover purchase, verification, installation, plans, gifts, coupons, receipts, agent settings, and sponsor management. The visual direction keeps Recharge's coupon identity, clear plan terms, and a restrained typography and color system. Storefront research included [Airalo's India flow](https://www.airalo.com/india-esim), especially compatibility and coverage information before checkout.
- Payment uncertainty is explicit. Pending transactions and funded sponsor campaigns survive reloads. Rejected actions do not silently update policies. Only implemented wallet action controls are shown.
- Agent settings distinguish a draft from a saved policy. The initial action is explicitly “Save and enable policy”; signing it does not imply that the background agent is running. The interface explains that an operator must enroll the plan and fund the agent wallet before automatic top-ups can run.
- Plan validity reflects purchase time. Top-up review preserves an existing later expiry and the response updates the displayed expiry. Compatibility checks and notification copy describe actual browser capabilities.
- English, Hindi, and Marathi copy is maintained together. Device install instructions retain manual alternatives and do not promise unverified one-tap installation.
- Removed unused frontend helpers and the empty wallet subclass, consolidated LPA validation in the protocol package, and corrected demo process cleanup. Duplication checking now includes application `lib` directories instead of excluding all of them.
- Historical `.claude` worktrees are preserved and excluded from formatting. Lint no longer fails by sending Solidity-only and shell/documentation-only directories to ESLint. Alternate local browser ports receive matching CORS configuration in the end-to-end harness.

## Verified checkpoints

- Application suites: 2,452 passing tests, with 20 existing skips, combining the latest package runs across protocol, crypto, EIP-3009, adapters, policy/claim logic, API, agent, web, UI, scripts, and video. This updates the earlier workspace checkpoint of 2,434 with API 529 → 537 and web 155 → 165; it is not a claim of a new single workspace-wide run. The final web suite also has three existing skips, included in the combined skip count.
- Solidity: 213 passing tests across 28 suites.
- Semgrep: 851 product files, zero findings and zero engine errors; the rule self-tests passed 31 positive and 24 negative cases. Slither passed the medium/high severity gate; five low-severity timestamp/interface-shadowing observations remain. Target discovery used an explicit Git file inventory after automatic discovery stalled.
- Dependency manifests and lockfile align across 13 importers. The production high/critical advisory gate passed under the repository's existing accepted exceptions; moderate/low transitive advisories remain. Duplication measured 0.41%, below the 1% gate.
- Production build, workspace type checking, source ESLint, formatting, schema/OpenAPI/ABI checks, and whitespace checks passed at their verified checkpoints. Final API validation includes all 537 tests, type checking, build, lint, formatting, and whitespace checks.
- Frontend security checks passed all 108 tests in the full run and all 26 affected tests in the final rerun. The final browser gates passed nine agent, accessibility, and screenshot checks plus one clock/expiry check. These reruns are validation checkpoints, not additional unique tests in the application-suite total.
- Local real-chain flow: campaign funding, World ID simulation and denied/replay cases, paid purchase/top-up, exact payment retry without a second debit, gifts by signature/PIN, scratch cards, webhook signature/replay protection, receipts, expiry, reclaim, and agent approval/denial/retry passed with Anvil and mocked inventory.
- These local tests do not spend the eSIM Access balance. A live browser test must separately verify the requested MetaMask account, actual inventory delivery, cancellation status, and refund transaction.

## Boundaries that remain explicit

- World ID Agent Pass client registration is still blocked by the provider portal's `account_not_eligible` response. IDKit is a separate integration. A mocked Agent Pass journey is not evidence of a completed live OIDC flow or prize eligibility.
- Old refunds or vendor cancellations with unknown outcomes and no saved transaction identity require operator reconciliation. The repair does not guess that an uncertain transfer failed and send another one.
- Historical native-Hedera gift reclaim needs explicit recovery. New unsupported native gifts are rejected before payment.
- Previously published capabilities cannot be made secret retroactively. Existing saved plans remain usable; newly created records use the corrected privacy model. Missing legacy session keys cannot be reconstructed safely.
- Claude's unfinished automatic reclaim of unused sponsored eSIMs was reviewed and not merged. Its cancellation/refund recovery and liability retention were unsafe. A future implementation needs explicit enrollment notice, durable phases, fair retries, and validated refund reconciliation.
- A desktop browser cannot establish successful eSIM installation, radio connectivity, carrier-unlocked status, or physical World App proof completion. The requested test leaves the eSIM uninstalled.
- Browser storage cleared by the user cannot preserve local private activation keys. Service deployments must retain the sealed state file, encryption/HMAC keys, and single-writer operation.

## Deployment and live test

Final browser validation is complete. Deployment and the requested live MetaMask/eSIM purchase test remain pending. No source publication, eSIM purchase, or live wallet transaction is implied by the automated results above.
