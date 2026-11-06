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
- Direct native Hedera purchases now bind the activation session in the wallet-signed transfer memo. The API validates that binding before settlement and corroborates the signed payer, transaction identity, token, amount and memo against mirror confirmation before delivery. Exact signed-payment retries preserve the original activation session and can recover a confirmed native payment after its transaction validity expires.
- Native paid-plan cancellation uses a fresh HIP-820 wallet message bound to the original payer, network, plan hash, challenge and time. ED25519 and ECDSA account signatures are checked against the account key; unsupported key structures fail closed. The refund destination comes from the original purchase records and uses the existing durable native refund journal. Native signature maps are redacted from logs, and validation errors do not echo them.
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

- The final workspace application run passed 2,513 tests, with 20 existing skips: protocol 370, crypto 31, EIP-3009 68, adapters 375, policy/claim logic 440, API 545, agent 200, web 177, UI 175, scripts 108, and video 24. The skips are adapters 14, web three, and scripts three. This is the completed native-Hedera follow-up run, replacing the earlier combined package checkpoints.
- Solidity: 213 passing tests across 28 suites.
- Semgrep: 854 product files, zero findings and zero engine errors; the rule self-tests passed 31 positive and 24 negative cases. Slither passed the medium/high severity gate; five low-severity timestamp/interface-shadowing observations remain. Target discovery used an explicit Git file inventory after automatic discovery stalled.
- Dependency manifests and lockfile align across 13 importers. The production high/critical advisory gate passed under the repository's existing accepted exceptions; moderate/low transitive advisories remain. Duplication measured 0.41%, below the 1% gate.
- Production build, workspace type checking, source ESLint, formatting, schema/OpenAPI/ABI checks, and whitespace checks passed at their verified checkpoints. Final API validation includes all 545 tests, type checking, build, lint, formatting, and whitespace checks.
- Frontend security checks passed all 108 tests in the full run and all 26 affected tests in the final rerun. The final browser gates passed nine agent, accessibility, and screenshot checks plus one clock/expiry check. These reruns are validation checkpoints, not additional unique tests in the application-suite total.
- Native checkout and payer-cancellation browser checks passed at both 360px and 1280px. Those two checks use controlled wallet/API responses; they verify the interface and do not establish a completed live HashPack payment or refund.
- Local real-chain flow: campaign funding, World ID simulation and denied/replay cases, paid purchase/top-up, exact payment retry without a second debit, gifts by signature/PIN, scratch cards, webhook signature/replay protection, receipts, expiry, reclaim, and agent approval/denial/retry passed with Anvil and mocked inventory.
- These local tests do not spend the eSIM Access balance. The prioritized live browser test must separately verify the user's HashPack account, actual inventory delivery, cancellation status, and refund transaction.

## Boundaries that remain explicit

- World ID Agent Pass client registration is still blocked by the provider portal's `account_not_eligible` response. IDKit is a separate integration. A mocked Agent Pass journey is not evidence of a completed live OIDC flow or prize eligibility.
- Old refunds or vendor cancellations with unknown outcomes and no saved transaction identity require operator reconciliation. The repair does not guess that an uncertain transfer failed and send another one.
- Historical native-Hedera gift reclaim needs explicit recovery. New unsupported native gifts are rejected before payment.
- Native-owner autopay policy signing remains unsupported and is disabled for native paid plans in the interface. Direct native purchases, top-ups and payer cancellation do not imply that a native policy can enroll an automatic buyer. Native gift purchase and reclaim authorization are also separate from the implemented paid-plan flow.
- Previously published capabilities cannot be made secret retroactively. Existing saved plans remain usable; newly created records use the corrected privacy model. Missing legacy session keys cannot be reconstructed safely.
- Claude's unfinished automatic reclaim of unused sponsored eSIMs was reviewed and not merged. Its cancellation/refund recovery and liability retention were unsafe. A future implementation needs explicit enrollment notice, durable phases, fair retries, and validated refund reconciliation.
- A desktop browser cannot establish successful eSIM installation, radio connectivity, carrier-unlocked status, or physical World App proof completion. The requested test leaves the eSIM uninstalled.
- Browser storage cleared by the user cannot preserve local private activation keys. Service deployments must retain the sealed state file, encryption/HMAC keys, and single-writer operation.

## Deployment and live test

The audited repair release `7b253d9e049416cad9fb6e17df8b7450e81c7c02` was deployed to the existing Recharge server at 05:24 UTC on 6 November. The production build and four live client-bundle checks passed before switching releases. API, web, agent, and Caddy are active; public API health reports live mode, Hedera chain 296, and no degraded state. Configuration and sealed state were preserved with private backups and the previous code retained.

The user then prioritized direct native Hedera purchases over the remaining live Base purchase/refund test. That follow-up is implemented and has passed the workspace and native browser checks above. Its deployment is pending at this checkpoint; the earlier `7b253d9` deployment does not include it. Native gifts and native-owner autopay policy signing remain outside the purchase/cancellation scope. The live HashPack eSIM purchase/cancel/refund test is still pending; neither deployment nor automated tests establish actual inventory delivery or refund completion.
