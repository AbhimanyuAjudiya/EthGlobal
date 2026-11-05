---
id: RT-P-10
title: Wednesday fixture recording has no recorder and no blocking scan: humans redact RT-AccessCode, RT-Signature, rp_context.signature, Arkiv keys and LPAs by hand and CI never scans fixtures/
module: scripts/record-fixture.ts (missing); .github/workflows/ci.yml; docs/ONSITE-RUNBOOK.md
threat: T-86
severity: Med
likelihood: M
status: verified
found_by: redteam-wave3-ops
owner: builder-ops-demo
found_at: 2026-11-04T16:10+05:30
due: 2026-11-05T20:59+05:30
attack_test: security/redteam/wave3-ops/run.sh::fixture_recorder_exists_RTFINDING; security/redteam/wave3-ops/run.sh::ci_blocking_fixture_scan_RTFINDING
regression_test: scripts/test/regression/T-86-repo-hygiene.test.ts::the recorder redacts every known secret by schema (OP6 synthetic round-trip) + security/redteam/wave3-ops/run.sh::scripts/record-fixture.ts exists / a blocking CI job scans committed fixtures
fix_commit: (uncommitted, wave-3 ops fix pass on claude/ethglobal-mumbai-build; orchestrator commits)
verified_at: 2026-11-04 (redteam-verify, Claude)
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

## Builder notes

`scripts/record-fixture.ts <flow>` (`pnpm record:fixture`) runs a named flow (`esimaccess-plans`, `esimaccess-usage`, `x402org-supported`, `hcs-mirror-messages`, `arkiv-rpc`, generic `http`) against the live vendor through a recording fetch handed to the real adapter, redacts by schema (`scripts/lib/recorder.ts`: secret headers, query keys, the Arkiv RPC path key, JSON keys `ac`/`lpa`/`iccid`/`qrCodeUrl`/`signature`/`nullifier*`/`proof`/credentials, every LPA string; shape-preserving placeholders), and writes `fixtures/<vendor>/live-<name>.json` (`source: live`, `recordedAt`, the `Recording` format `fixtureFetch` replays). It refuses to write if any value it redacted, any env credential, or a real-format LPA remains, or if scan.sh fires. `--raw` keeps `live-<name>.raw.json` (git-ignored, 0600). Credentials come from `.env` only. CI: `checks` runs `scripts/check-forbidden.sh fixtures docs scripts` as its first step, and a new needs-free, install-free `fixture-scan` job scans `fixtures/` and refuses tracked raw captures. No live recording was made (no vendor access here).

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): VERIFIED.**

- Regression: `T-86-repo-hygiene.test.ts` recorder round-trip and `wave3-ops/run.sh` pass. (re-run 2026-11-04, green under the CI `_RTFINDING` filter).
- Variant (new, not covered by the regression): the finding's secret classes in other shapes — a body double-encoded inside a string, `signature` as an object and `proof` as an array, an LPA in free text, upper-case keys / query / Arkiv host with a port, credentials in URL userinfo, our webhook token inside a URL inside a JSON field, the access code echoed in an error message: each is either redacted or refused by the write gate (leftovers over removed + env secrets, scan.sh). Observation: an ICCID inside a NON-JSON text body is neither redacted (ICCIDs are redacted by JSON key only) nor caught by leftovers()/scan.sh; `imsi`/`msisdn`/`eid` (documented esimList fields) are not in `SECRET_KEYS`.

```sh
cd scripts && npx vitest run test/regression/verify-rt-p-10-recorder.test.ts
```
