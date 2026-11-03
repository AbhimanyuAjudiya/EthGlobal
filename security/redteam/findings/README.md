# Red-team findings

One file per finding. The file is the single source of truth for that finding; the fix PR references its id. Status changes are edits to the file (keep the history in git, not in the file).

## Naming

```
findings/
  README.md
  RT-W1-001-datadrop-campaign-id-hijack.md      # RT-W<wave>-<3-digit seq>-<kebab slug>
  RT-W2-007-webhook-ms-timestamp-accepted.md
  DRILL-attestor-rotation.md                    # human live drills (Fri 6 Nov), same front matter minus repro
  INDEX.md                                      # generated: ../tools/findings-index.sh
```

- `W1`/`W2`/`W3` = the wave whose code the finding is against; `WA` = found in the full audit; `WL` = found live by the human team in-window.
- Sequence numbers are per wave and never reused. A duplicate is closed with `status: closed` and `duplicate_of:`.

## File format

YAML front matter, then free-form Markdown. Every key below is required unless marked optional. Values for `severity` follow `docs/THREAT-MODEL.md` §0.

```markdown
---
id: RT-W1-001
title: DataDrop.createCampaign overwrites an existing campaign (id hijack)
module: packages/contracts/src/DataDrop.sol          # path, or package name for cross-cutting
threat: T-04                                         # id in docs/THREAT-MODEL.md; "new" if none fits (then add a row)
severity: High                                       # Critical | High | Med | Low
likelihood: M                                        # H | M | L
status: open                                         # open | acknowledged | fixing | fixed | verified | closed | accepted-risk | disputed
found_by: redteam-contracts                          # agent or person
owner: builder-contracts                             # who fixes
found_at: 2026-11-03T18:40+05:30
due: 2026-11-03T22:40+05:30                          # from the SLA table in ../PLAN.md §6.3
attack_test: packages/contracts/test/attack/DataDropAttack.t.sol::test_Attack_CampaignIdHijack
regression_test:                                     # filled by the builder; required for status >= fixed
fix_commit:                                          # sha; required for status >= fixed
verified_at:                                         # red team; required for status >= verified
duplicate_of:                                        # optional
sign_off:                                            # required for accepted-risk: "Founder, 2026-11-04 10:12 IST, README line L123"
---

## Repro

Exact commands and steps. Deterministic. Include the seed if fuzz found it.

```sh
cd packages/contracts && forge test --match-test test_Attack_CampaignIdHijack -vvv
```

1. Sponsor A: `createCampaign(id, 500_000_000, 500_000, 100, now + 7 days)`
2. Stranger B: `createCampaign(id, 1, 1, 1, now + 1)` → succeeds; `campaigns(id).sponsor == B`

## Impact

What the attacker gets, in the product's terms (sponsor USDC, LPA, MB, a burned verification, a prize). Quantify with the drain bound where it applies.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

`revert CampaignExists()` when `campaigns[id].sponsor != address(0)`; add the error to `IDataDrop`; update `docs/INTERFACES.md`.

## Builder notes (optional)

Rebuttal, alternative fix, or why this is `accepted-risk`.

## Verification (red team)

Date, command, result. The attack test must now fail-as-expected and the regression test must pass.
```

## Rules

1. A finding is filed as soon as a failing attack test confirms it — not at the end of a run.
2. `severity` is the red-team lead's call; `likelihood` may be argued by the builder in *Builder notes*.
3. `fixed` requires `regression_test` and `fix_commit`; `verified` requires `verified_at` after the red team re-ran both the attack test and the regression test. The regression test lives at the path `docs/THREAT-MODEL.md` §5.12 names for the finding's threat (`<package>/test/regression/T-xx-<slug>.test.ts`, Foundry `test/regression/Txx_<Name>.t.sol`, Playwright `apps/web/e2e/regression/T-xx-<slug>.spec.ts`); for a `threat: new` finding the lead adds the row and the path. `run-wave.sh` fails while any Critical/High finding is not `verified`/`closed`, and while any `fixed`+ finding has an empty `regression_test:`.
4. `accepted-risk` requires `sign_off` by Founder or Chair **and** a corresponding line in `README.md` or `docs/DISCLOSURE.md` **and** a row in `docs/THREAT-MODEL.md` §8.
5. Renames and interface drift are **not** findings; they go in the wave report under "renames observed".
6. Never paste a secret, a real key, a real LPA or a real nullifier into a finding. Use the Anvil fixtures and `LPA:1$local.test$…` strings.

## Index

`../tools/findings-index.sh` regenerates `INDEX.md` (id · severity · status · module · title) from the front matter; run it before writing a wave report.
