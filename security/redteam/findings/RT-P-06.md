---
id: RT-P-06
title: CI supply chain: actions pinned by mutable tags, `pip install semgrep` unpinned, no least-privilege permissions block
module: .github/workflows/ci.yml
threat: T-65
severity: Low
likelihood: L
status: verified
found_by: redteam-wave3-ops
owner: builder-ops-demo
found_at: 2026-11-04T16:10+05:30
due: next report (Low: opportunistic, PLAN §6.3)
attack_test: security/redteam/wave3-ops/run.sh::ci_actions_pinned_by_sha_RTFINDING; security/redteam/wave3-ops/run.sh::ci_pip_semgrep_pinned_RTFINDING; security/redteam/wave3-ops/run.sh::ci_token_permissions_readonly_RTFINDING
regression_test: scripts/test/regression/T-65-supply-chain.test.ts::CI (SHA pins, pip ==, permissions: contents: read, no secrets) + security/redteam/wave3-ops/run.sh::every action pinned to a commit SHA / pip deps pinned / least-privilege permissions
fix_commit: (uncommitted, wave-3 ops fix pass on claude/ethglobal-mumbai-build; orchestrator commits)
verified_at: 2026-11-04 (redteam-verify, Claude)
duplicate_of:
sign_off:
---

## Repro

```sh
grep -nE 'uses: |pip install|^permissions' .github/workflows/ci.yml
```

`actions/checkout@v5`, `pnpm/action-setup@v4`, `actions/setup-node@v5`, `foundry-rs/foundry-toolchain@v1`,
`actions/upload-artifact@v4`, `actions/setup-python@v5` (tags, movable by the action owner); `pip install
slither-analyzer==0.11.6 semgrep` (semgrep floats); no top-level `permissions:` (GITHUB_TOKEN gets the repository default,
which may be write on `push`).

What holds (kept as regressions in run.sh): no `secrets.*` anywhere, no `pull_request_target`/`workflow_run`, `MODE=local`
everywhere, the out-of-repo `link-*.sh` scripts are not referenced, no `curl | sh`.

## Impact

A compromised third-party action or semgrep release runs with the token and can push to the branch on `push` events (it
cannot reach a vendor secret: there are none). Low.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Pin each action to a full commit SHA (with the tag in a comment); `semgrep==<x.y.z>`; add `permissions: { contents: read }`
at the top level.

## Builder notes

Every `uses:` is a 40-hex commit SHA with the tag in a comment. SHAs resolved with `git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag>` (the sandbox's `gh api` is not enabled for these repos), peeled for annotated tags: checkout v5 `fbc6f399…`, pnpm/action-setup v4 `b906affc…` (peeled), setup-node v5 `a0853c24…`, foundry-toolchain v1 `dba66c27…`, upload-artifact v4 `ea165f8d…`, setup-python v5 `a26af69b…`. `pip install slither-analyzer==0.11.6 semgrep==1.183.0`. Top-level `permissions: { contents: read }`.

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): VERIFIED.**

- Regression: `T-65-supply-chain.test.ts` CI cases and `wave3-ops/run.sh` pass. (re-run 2026-11-04, green under the CI `_RTFINDING` filter).
- Variant (new, not covered by the regression): no job-level `permissions` grants write; no `run:` pipes a download into a shell, uses `@latest` or `npx`/`dlx` an unpinned package; every foundry-toolchain step pins `vX.Y.Z` and setup-python pins a version.

```sh
cd scripts && npx vitest run test/regression/verify-rt-p-03-05-06-07-static.test.ts -t RT-P-06
```
