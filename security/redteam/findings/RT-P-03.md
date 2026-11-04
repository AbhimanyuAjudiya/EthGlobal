---
id: RT-P-03
title: .gitignore does not cover apps/web/test-results/, apps/web/playwright-report/ or raw live recordings (fixtures/**/live-*.raw.json)
module: .gitignore
threat: T-86
severity: Med
likelihood: M
status: fixed
found_by: redteam-wave3-ops
owner: builder-ops-demo
found_at: 2026-11-04T16:10+05:30
due: 2026-11-05T20:59+05:30
attack_test: security/redteam/wave3-ops/run.sh::gitignore_covers_playwright_and_live_raw_RTFINDING
regression_test: scripts/test/regression/T-86-repo-hygiene.test.ts::git check-ignore (the full T-86 list) + security/redteam/wave3-ops/run.sh::ignored: Playwright traces/report and raw live recordings
fix_commit: (uncommitted, wave-3 ops fix pass on claude/ethglobal-mumbai-build; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
for p in apps/web/test-results/trace.zip apps/web/playwright-report/index.html fixtures/reseller/esimaccess/live-order.raw.json; do
  git check-ignore -q "$p" || echo "NOT IGNORED: $p"; done
```

All three print `NOT IGNORED`. `apps/web/.gitignore` ignores `/coverage`, `/.next/`, `/out/` but not Playwright output.
`run-wave.sh static` already fails its hygiene gate on the first two. (`.e2e/`, `.agent/`, `fixtures/inventory.enc`, `out/`
and the renders are correctly ignored; nothing secret-bearing is tracked; untracked `apps/web/e2e/__screenshots__/` is left to
the web run.)

## Impact

THREAT-MODEL T-86 lists exactly these paths. Playwright traces and failure screenshots of `/print/cards`, `/plan/:key` and
the gift flow carry PINs, entitlement keys and LPAs; on Thursday the print run and the live rehearsal produce real ones.
Raw live recordings (Wednesday, RT-P-10) carry `RT-AccessCode`/`RT-Signature`, `rp_context.signature`, the Arkiv access key
and a real `ac`. One `git add -A` publishes them.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Add to the root `.gitignore`: `apps/web/test-results/`, `apps/web/playwright-report/`, `apps/web/blob-report/`,
`fixtures/**/live-*.raw.json`. Regression: `scripts/test/regression/T-86-repo-hygiene.test.ts` (THREAT-MODEL §5.12) runs
`git check-ignore` over the full T-86 list.

## Builder notes

Root `.gitignore` adds `apps/web/test-results/`, `apps/web/playwright-report/`, `apps/web/blob-report/`, `fixtures/**/live-*.raw.json`. The redacted `live-*.json` stays committable (asserted). CI's `fixture-scan` job also refuses a tracked raw capture.
