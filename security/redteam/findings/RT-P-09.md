---
id: RT-P-09
title: Runbook/plan drift: `pnpm audit` runs pnpm's built-in audit not the gate, a Hedera key is passed inline, four referenced gate scripts do not exist, and the judge video still says Kaolin
module: docs/ONSITE-RUNBOOK.md; docs/BUILD-PLAN.md; apps/video/src
threat: T-63
severity: Low
likelihood: M
status: fixing
found_by: redteam-wave3-ops
owner: builder-ops-demo
found_at: 2026-11-04T16:10+05:30
due: next report (Low: opportunistic, PLAN §6.3)
attack_test: security/redteam/wave3-ops/run.sh::runbook_runs_the_audit_gate_RTFINDING; security/redteam/wave3-ops/run.sh::runbook_no_inline_secrets_RTFINDING; security/redteam/wave3-ops/run.sh::plan_scripts_exist_RTFINDING; security/redteam/wave3-ops/run.sh::judge_video_says_rabdi_RTFINDING
regression_test: scripts/test/regression/T-86-repo-hygiene.test.ts::the ops scripts the plans name exist and parse + security/redteam/wave3-ops/run.sh::runbook invokes the audit gate with pnpm run audit / runbook never puts a key on a command line / every ops script the plans and gates reference exists
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
pnpm audit --help | head -2                   # "Usage: pnpm audit [options]" — the built-in, not package.json "audit"
grep -n 'PRIVATE_KEY=…' docs/ONSITE-RUNBOOK.md
ls scripts/check-forbidden.sh scripts/check-design-bans.sh scripts/dump-ledger.ts scripts/redteam/run.ts
grep -rn 'Arkiv Kaolin' apps/video/src
```

1. Sun 06:00 "Run `pnpm audit` on a clean checkout" — pnpm built-ins win over scripts, so the README freeze runs a registry
   vulnerability audit and never the root `audit` gate (build, lint, tests, abi/openapi/schema checks, e2e, run-wave all).
2. Fri 06:00 agent command: `AGENT_HEDERA_PRIVATE_KEY=… pnpm start …` on the command line (shell history, `ps`), while §0
   says "never --private-key on a command line".
3. `scripts/check-forbidden.sh` (BUILD-PLAN §5.3), `scripts/check-design-bans.sh` (§2.4; `run-wave.sh 3` skips it silently
   when missing), `scripts/dump-ledger.ts` (§4 I-18; `run-wave.sh 2` needs `.e2e/ledger-dump.json`), `scripts/redteam/run.ts`
   (§4 I-20, OP5.3) do not exist.
4. `apps/video` JudgeVideo and the footage manifest caption "Arkiv Kaolin explorer" while DISCLOSURE (correctly) says rabdi.
   Plain `TBD` cells without owner remain in the runbook's attach-test table and CHANGELOG's generated table (acceptable:
   filled by the run itself).

Verified consistent (kept as regressions): every `TBD by human` names an owner and a time; all 13 commit hashes in
DISCLOSURE exist; the single Kaolin → rabdi correction; the LEDGER_ONLY mode slot; every other `pnpm <script>` the docs name
exists; the Hedera USDC alias `0x0000000000000000000000000000000000068cDa` is EIP-55-correct and equals long-zero(0.0.429274).

## Impact

The final pre-submission gate silently does not run; a Hedera agent key in shell history on a team laptop; gates the plan
relies on are absent; a judge video contradicting the disclosure. Low.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

`pnpm run audit`; load agent keys from the VPS env / `.env` (`--env-file`), never inline; write or de-reference the four
scripts (and make `run-wave.sh` fail when `check-design-bans.sh` is missing); "Arkiv rabdi explorer" in the video.

## Builder notes

Fixed (3 of 4): Sun 06:00 says `pnpm run audit` (and why); the Fri agent command loads `AGENT_*` from `.env` with `set -a; source …; set +a`, and §0 states the rule; the four scripts exist — `scripts/check-forbidden.sh` (wraps `security/redteam/tools/scan.sh`; default fixtures docs scripts research), `scripts/check-design-bans.sh` (runs the "design bans" suite of `packages/ui/tokens.test.ts`), `scripts/dump-ledger.ts` (reads the new MODE=local-only `GET /__local/ledger`; e2e-local writes `.e2e/<run>/ledger-dump.json` and scans it), `scripts/redteam/run.ts` (forwards to `security/redteam/run-wave.sh`). `run-wave.sh 3` now fails when check-design-bans.sh is missing; `run-wave.sh 2` scans `.e2e/*/` logs and `.e2e/latest/ledger-dump.json`. **Open: item 4** (the judge video's "Arkiv Kaolin explorer" caption, `apps/video/src/compositions/JudgeVideo.tsx:334`) belongs to the video producer, who is working concurrently; apps/video was not touched by this pass.
