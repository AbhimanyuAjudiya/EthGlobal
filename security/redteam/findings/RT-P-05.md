---
id: RT-P-05
title: 23 direct dependencies use ^ ranges, including hono, @hono/node-server and pino in the key-holding API; a lockfile refresh (RT-P-04) or the runbook's plain `pnpm install` re-resolves them
module: package.json; services/api/package.json; services/agent/package.json; apps/web/package.json; packages/ui/package.json; apps/video/package.json
threat: T-65
severity: Med
likelihood: L
status: open
found_by: redteam-wave3-ops
owner: builder-ops-demo
found_at: 2026-11-04T16:10+05:30
due: 2026-11-05T20:59+05:30
attack_test: security/redteam/wave3-ops/run.sh::every_direct_dependency_pinned_exact_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
security/redteam/wave3-ops/run.sh   # "OP4": lists every non-workspace, non-catalog, non-exact specifier
```

Root devDependencies (eslint, prettier, jscpd, typescript-eslint, …), `services/api` and `services/agent`
(`hono@^4.13.16`, `@hono/node-server@^2.1.6`, `pino@^10.4.0`, `pino-pretty@^13.2.0`), `apps/web` (tailwind, types),
`packages/ui` (`react@^19.3.0`). The catalog itself is exact (good), `onlyBuiltDependencies` is `[esbuild]` (good).

## Impact

Exact versions exist only in a lockfile that is stale (RT-P-04). The ONSITE-RUNBOOK §0 tells every human to run
`pnpm install` (not `--frozen-lockfile`) on a fresh clone, and the VPS will do the same: each machine resolves the newest
release ≥ 3 days old in each range. The API process holds the attestor, relayer, treasury, Arkiv and World RP keys; a
malicious or broken `hono`/`pino` minor that survived 3 days lands there untested. `minimumReleaseAge` limits but does not
remove this. Med (impact High, likelihood L).

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Move every third-party direct dependency to an exact `catalog:` entry (versions = what the link scripts installed and the
tests ran on); change the runbook to `pnpm install --frozen-lockfile` once RT-P-04 is fixed. Regression:
`scripts/test/regression/T-65-supply-chain.test.ts` asserts no `^`/`~`/`latest`/`*` in any package.json.
