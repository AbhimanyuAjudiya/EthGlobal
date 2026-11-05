---
id: RT-P-04
title: CI cannot start: pnpm install --frozen-lockfile fails ERR_PNPM_OUTDATED_LOCKFILE (8 workspace importers missing), so no job — tests, scans, red team — runs on any push or PR
module: pnpm-lock.yaml; .github/workflows/ci.yml
threat: T-65
severity: Med
likelihood: H
status: acknowledged
found_by: redteam-wave3-ops
owner: builder-ops-demo (Founder decides the lockfile refresh)
found_at: 2026-11-04T16:10+05:30
due: 2026-11-05T20:59+05:30
attack_test: security/redteam/wave3-ops/run.sh::ci_frozen_install_succeeds_RTFINDING; security/redteam/wave3-ops/run.sh::ci_frozen_install_succeeds_dynamic_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
security/redteam/wave3-ops/run.sh   # "OP4": importer census + an offline frozen install in an isolated copy (no node_modules touched)
```

`pnpm-lock.yaml` (last changed Tue 3 Nov 01:14 UTC) has importers for `.`, `apps/web`, `packages/adapters`, `packages/ui`,
`services/api` only. `apps/video`, `packages/{contracts,crypto,eip3009,octroi,protocol}`, `services/agent` and `scripts` have
none; the isolated `pnpm install --frozen-lockfile --offline` exits 1 with `ERR_PNPM_OUTDATED_LOCKFILE` ("specifiers in the
lockfile don't match … 6 dependencies were added").

**Confirmation asked for by the lead:** yes, `--frozen-lockfile` fails today — but not only because of `minimumReleaseAge`.
The lockfile is simply stale, so CI stays red even after the 3-day window passes, until someone runs a _non-frozen_
`pnpm install` and commits the new lockfile. `minimumReleaseAge: 4320` itself is present and was not weakened.

## Impact

`checks` is the first job and every other job `needs: checks`: no vitest, forge, lint, dupcheck, e2e, Playwright or red-team
run happens on any commit. During the window the team will push dozens of commits with a permanently red CI, which trains
everyone to ignore it — exactly when the secret scan (RT-P-10) and the attack suites matter. Med: no direct exposure,
but it disables every other mitigation that "CI already" provides (T-65, T-67, T-86).

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

On a machine with registry access, once the pins clear the gate (or with explicit, reviewed `minimumReleaseAgeExclude`
entries signed off by the Founder): `pnpm install` → review the lockfile diff (one `@hiero-ledger/sdk`, banned names absent,
`deps-check.sh` green) → commit. Pin the direct ranges first (RT-P-05) so the refresh resolves exactly what was tested.

## Builder notes

Not fixable from this sandbox: `pnpm install` is rejected by `minimumReleaseAge` until ≈ 2026-11-05 08:30 UTC, and the gate is not modified. Prepared for the human: `scripts/refresh-lockfile.sh` (`pnpm install` → `pnpm install --frozen-lockfile` → `deps-check.sh` → `git add pnpm-lock.yaml`, no commit), documented in ONSITE-RUNBOOK §0 "Lockfile refresh (Thu 5 Nov, 14:00 · Integrations)" and README "Dependencies". CI keeps `pnpm install --frozen-lockfile`; on failure it prints `LOCKFILE_HELP` pointing at the runbook and the script. A new `fixture-scan` job needs no install, so the blocking secret scan runs even while this stands. RT-P-05 pinned every direct dependency first, so the refresh resolves exactly what the tests ran on. Note for the refresh review: the linked node_modules already drift from the catalog for `@arkiv-network/sdk` (1.0.0 installed vs 1.0.1 pinned, packages/adapters) and `@vitest/coverage-v8` (5.0.5 / 5.1.0-beta.1 vs 5.1.0); `T-65-supply-chain.test.ts` lists exactly these as pre-refresh drift and fails on any other.
