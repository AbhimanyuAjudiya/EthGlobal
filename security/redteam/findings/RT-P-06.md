---
id: RT-P-06
title: CI supply chain: actions pinned by mutable tags, `pip install semgrep` unpinned, no least-privilege permissions block
module: .github/workflows/ci.yml
threat: T-65
severity: Low
likelihood: L
status: open
found_by: redteam-wave3-ops
owner: builder-ops-demo
found_at: 2026-11-04T16:10+05:30
due: next report (Low: opportunistic, PLAN §6.3)
attack_test: security/redteam/wave3-ops/run.sh::ci_actions_pinned_by_sha_RTFINDING; security/redteam/wave3-ops/run.sh::ci_pip_semgrep_pinned_RTFINDING; security/redteam/wave3-ops/run.sh::ci_token_permissions_readonly_RTFINDING
regression_test:
fix_commit:
verified_at:
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
