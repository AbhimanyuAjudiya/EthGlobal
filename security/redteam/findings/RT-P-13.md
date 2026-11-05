---
id: RT-P-13
title: THREAT-MODEL §5.12 has three High threats (T-08 protocol, T-33, T-34 crypto) whose package has no regression test that names the threat
module: packages/crypto/test; packages/protocol/test; docs/THREAT-MODEL.md §5.12
threat: T-33
severity: Low
likelihood: L
status: open
found_by: redteam-verify
owner: builder-octroi
found_at: 2026-11-04T22:00+05:30
due: next report (Low: opportunistic, PLAN §6.3)
attack_test: security/redteam/tools/coverage-check.sh --require packages/protocol packages/crypto (lists the three rows as "known gap — … (RT-P-13)")
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
security/redteam/tools/coverage-check.sh --require packages/contracts packages/protocol packages/crypto packages/eip3009 packages/octroi packages/adapters services/api services/agent apps/web scripts
```

This prints three `coverage: known gap … (RT-P-13)` lines. The audit (AUD-05 b) found that the 23 regression paths in
THREAT-MODEL §5.12 were never created under those names. The closing pass repointed 20 of them at the real test files
that name the threat. For three rows, no test in the owning package names the threat at all:

| Threat               | Package             | Matrix used to name                        | What exists instead (behaviour only, does not name the threat)                                                                                                                                  |
| -------------------- | ------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-08 (USDC decimals) | `packages/protocol` | `test/regression/T-08-units.test.ts`       | `packages/protocol/test/units.test.ts` (`usd6` 6-dp vectors and properties). The contracts half is `packages/contracts/test/regression/T08_Decimals.t.sol` and is fine.                         |
| T-33 (LPA AEAD)      | `packages/crypto`   | `test/regression/T-33-aead.test.ts`        | `packages/crypto/test/seal.test.ts` (round trip, wrong key or AAD, bit flips, truncation, low-order key). T-33 has no other row, so it is the only High threat with no test naming it anywhere. |
| T-34 (webhook MAC)   | `packages/crypto`   | `test/regression/T-34-webhook-mac.test.ts` | `packages/crypto/test/hash-webhook.test.ts` (`verifyWebhookSignature`, `ReplayGuard`). The API half is `services/api/test/regression/T-34-webhook-route.test.ts` and is fine.                   |

## Impact

The behaviour is tested, so there is no product risk. The cost is traceability: a refactor that drops the
`seal.test.ts` AAD case would not be seen as a T-33 regression, and the matrix cannot show that T-33 is covered.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

1. Tag the existing cases (`describe('T-33 …')` in `seal.test.ts`, `describe('T-34 …')` in `hash-webhook.test.ts`,
   `describe('T-08 …')` in `units.test.ts`), or add the three `test/regression/T-xx-*.test.ts` files.
2. Replace the three `OPEN GAP RT-P-13: …` cells in §5.12 with those paths. `coverage-check.sh` then fails if RT-P-13
   is marked `verified` while a gap cell remains, and also fails if a gap cell remains after the finding closes.
