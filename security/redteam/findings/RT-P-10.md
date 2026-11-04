---
id: RT-P-10
title: Wednesday fixture recording has no recorder and no blocking scan: humans redact RT-AccessCode, RT-Signature, rp_context.signature, Arkiv keys and LPAs by hand and CI never scans fixtures/
module: scripts/record-fixture.ts (missing); .github/workflows/ci.yml; docs/ONSITE-RUNBOOK.md
threat: T-86
severity: Med
likelihood: M
status: open
found_by: redteam-wave3-ops
owner: builder-ops-demo
found_at: 2026-11-04T16:10+05:30
due: 2026-11-05T20:59+05:30
attack_test: security/redteam/wave3-ops/run.sh::fixture_recorder_exists_RTFINDING; security/redteam/wave3-ops/run.sh::ci_blocking_fixture_scan_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
ls scripts/record-fixture.ts                                  # missing (the runbook says so: "redact by hand")
awk '/^  checks:/,/^  e2e-local:/' .github/workflows/ci.yml | grep scan.sh   # nothing: only the non-blocking redteam job scans
```

OP6 (recorder redaction) cannot be executed: there is no recorder. 12 fixture families (runbook table) are to be captured
on Wed 14:00 with `curl`/`tee` and edited by hand. The only scan of `fixtures/` runs in the `redteam` job, which is
`continue-on-error` and never starts anyway (RT-P-04). The forbidden-pattern list gained rules for the Arkiv access-key
path segment, `ARKIV_ACCESS_KEY=` and Swarm postage batch ids in this pass (`tools/forbidden-patterns.txt`); the current
`fixtures/ docs/ scripts/` scan is clean.

## Impact

OP6 rates an unredacted recorded value as High: one missed `RT-Signature`/`accessCode` (the account credential, T-83) or a
real `ac` LPA committed on Wednesday under time pressure is public forever (history), and nothing blocking would notice.
Med until the recorder exists, because the leak has not happened.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Write `scripts/record-fixture.ts` with the ops-brief redaction list (headers `Authorization`, `RT-AccessCode`,
`RT-Signature`; `rp_context.signature`; Arkiv RPC path key; `ac`/`lpa` → `LPA:1$redacted$…`; `iccid`; nullifiers; `?token=`)
and a vitest that round-trips synthetic secrets through it (OP6); add `bash security/redteam/tools/scan.sh fixtures docs
scripts` as a step of the blocking `checks` job; keep raw captures in `live-*.raw.json` (ignored, RT-P-03).
