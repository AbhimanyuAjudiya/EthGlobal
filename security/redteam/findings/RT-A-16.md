---
id: RT-A-16
title: x402.org /supported lists x402Version 1 kinds under legacy names (base-sepolia) and non-string extra values; supportedKindSchema refused the whole response, so MODE=live could not boot against the default facilitator
module: packages/protocol/src/schemas/x402.ts (supportedKindSchema); packages/adapters/src/live/remote-facilitator.ts
threat: T-42
severity: Med
likelihood: H
status: fixed
found_by: orchestrator (live pre-deploy)
owner: builder-api
found_at: 2026-11-05T15:45+05:30
due: 2026-11-05T20:59+05:30
attack_test: 'packages/protocol/test/schemas.test.ts::the x402.org recording parses: v1 kinds under legacy names and non-string extra values survive [RT-A-15] and services/api/test/deps.live.test.ts::MODE=live with hedera:testnet boots against the x402.org /supported recording and pins the fee payer [RT-A-15] (both red at 1e483d4 against fixtures/facilitator/x402org/live-supported.json; the live boot itself is the original repro)'
regression_test: 'packages/protocol/test/schemas.test.ts::facilitator /supported (RT-A-15, T-42) (2 cases) + ::a Hedera accept whose feePayer is not a string in 0.0.x form is refused whatever else extra carries [RT-A-15]; packages/adapters/test/live/remote-facilitator.test.ts::x402.org live /supported (v1 kinds, nested extra) parses and feePayer reads the v2 exact Hedera kind [RT-A-15] + ::a Hedera feePayer that is not a string, or a v1 / upto kind listed first, never supplies the fee payer [RT-A-15]; services/api/test/deps.live.test.ts::MODE=live with hedera:testnet boots against the x402.org /supported recording and pins the fee payer [RT-A-15]; services/api/test/accepts.test.ts::a fee payer outside the Hedera id form never reaches accepts[] [RT-A-15]; services/agent/test/payers-hedera.test.ts::refuses: wrong network/asset, missing or non-string fee payer, validity above 180 s [RT-A-15]'
fix_commit: (uncommitted at filing; the worktree commit hash is recorded in a follow-up, as for RT-C-08)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
curl -s https://x402.org/facilitator/supported | jq -c '.kinds[] | select(.x402Version != 2) | {x402Version, network}'
# {"x402Version":1,"network":"base-sepolia"}
# {"x402Version":1,"network":"solana-devnet"}
cd packages/protocol && npx vitest run test/schemas.test.ts -t 'RT-A-15'      # red at 1e483d4
cd services/api && npx vitest run test/deps.live.test.ts -t 'RT-A-15'         # red at 1e483d4
```

Booting `services/api` on 2026-11-05 ~15:45 IST with `MODE=live`, `X402_FACILITATOR=remote`,
`X402_FACILITATOR_URL_EVM=X402_FACILITATOR_URL_HEDERA=https://x402.org/facilitator`,
`X402_NETWORKS=hedera:testnet,eip155:84532`, `X402_HEDERA_FEE_PAYER=0.0.9185802`:

```
AdapterError: payments: unexpected response shape (HTTP 200)   { adapter: 'payments', code: 'invalid_response', details: { status: 200 } }
  at RemoteFacilitator.#kind (packages/adapters/src/live/remote-facilitator.ts:249)
  at RemoteFacilitator.feePayer (remote-facilitator.ts:124)   ← services/api/src/deps.ts:306 liveWiring
```

`supportedKindSchema` required `x402Version: 2` and a CAIP-2 `network` on **every** kind of the list. The recording
`fixtures/facilitator/x402org/live-supported.json` (08:39Z; re-recorded 10:12Z with `pnpm record:fixture x402org-supported`,
scan clean) carries two `x402Version: 1` kinds named `base-sepolia` and `solana-devnet`, plus `extra` values that are
arrays, booleans and objects (`transactionVersions: [0, 1]`, `features: { smartWalletSupported: true }`, `areFeesSponsored`,
`facilitatorAddress`). zod: `kinds[9].x402Version expected 2`, `kinds[9].network caip-2`, the same for `kinds[10]`. `extra`
was already `z.record(z.string(), z.unknown())`, so the nested values were not the trigger — the v1 kinds were. The authored
`fixtures/facilitator/x402org/supported.json` lists only our two v2 kinds, so every suite stayed green while the live API
could not boot (ONSITE-RUNBOOK step 6: the recording wins, the adapter gets fixed, a finding is filed).

## Impact

No integrity property is lost — the schema failed closed — but the live API cannot start against the default (and
allow-listed, A-30) facilitator for `hedera:testnet`, and any facilitator that adds a kind we do not model (a new version, a
legacy name, an `upto` scheme, a non-string `extra` value) takes the service down at boot. A strict schema over a list we
only search is availability risk with no integrity gain: the checks that matter (v2 `exact` on our network, `extra.feePayer`
a string in `0.0.x` form, equal to the pin) live in the consumers. Med: the demo API is down until a redeploy; the fee payer
pin (T-42) is unaffected.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Read `/supported` as the vendor shape and keep the strictness where it is enforced: `supportedKindSchema` =
`@x402/core@2.29.0` `SupportedKind` (`x402Version: number`, `scheme: string`, `network: string`, `extra?: Record<string,
unknown>`) with length bounds (kinds ≤ 64, network ≤ 64, scheme ≤ 32, signers ≤ 16 × 128); `RemoteFacilitator` selects the
v2 `exact` kind on the configured network for every read; `feePayer()`, `accepts.ts` (`acceptTemplateSchema`) and the agent's
`feePayerOf` keep requiring a string in `0.0.x` form.

## Builder notes (optional)

Done as proposed. `exactKind()` in `remote-facilitator.ts` is now the one lookup for `#kind` and `createPaymentRequirement`
— the latter previously matched on `network` alone, so with v1 kinds parsing, a v1 or `upto` kind listed before the v2 `exact`
one could have supplied `extra.feePayer` (covered by the adapters regression). A kind whose `feePayer` is `123`, an object, an
array or missing is still `invalid_response` at boot, `accepts: invalid template` in the API and `fee-payer` in the agent.
`services/api/openapi.json` regenerated (the self-run `/facilitator/supported` documents the same shape). API-FACTS §1.5
records the observed payload. No limits were added to `/supported` beyond the existing ones; the 16 KiB header codec is
untouched.
