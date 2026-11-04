---
id: RT-P-05
title: 23 direct dependencies use ^ ranges, including hono, @hono/node-server and pino in the key-holding API; a lockfile refresh (RT-P-04) or the runbook's plain `pnpm install` re-resolves them
module: package.json; services/api/package.json; services/agent/package.json; apps/web/package.json; packages/ui/package.json; apps/video/package.json
threat: T-65
severity: Med
likelihood: L
status: verified
found_by: redteam-wave3-ops
owner: builder-ops-demo
found_at: 2026-11-04T16:10+05:30
due: 2026-11-05T20:59+05:30
attack_test: security/redteam/wave3-ops/run.sh::every_direct_dependency_pinned_exact_RTFINDING
regression_test: scripts/test/regression/T-65-supply-chain.test.ts (no ^/~/*/latest in any workspace package.json; catalog exact; installed == pinned) + security/redteam/wave3-ops/run.sh::no ^/~/latest range in any package.json
fix_commit: (uncommitted, wave-3 ops fix pass on claude/ethglobal-mumbai-build; orchestrator commits)
verified_at: 2026-11-04 (redteam-verify, Claude)
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

## Builder notes

All 25 ranged specifiers (root devDependencies, services/api, services/agent, apps/web, packages/ui, apps/video's `@types/react` only) now say `catalog:`; 21 new exact catalog entries were added at the versions the installed node_modules and the lockfile already had (no version changed: eslint 10.14.0, prettier 3.9.10, hono 4.13.16, @hono/node-server 2.1.6, pino 10.4.0, pino-pretty 13.2.0, react/react-dom/@types/react(-dom) 19.3.0, tailwindcss + @tailwindcss/turbopack 4.3.4, …). peerDependencies stay ranges by design. ONSITE-RUNBOOK §0 and README now say `pnpm install --frozen-lockfile`.

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): VERIFIED.**

- Regression: `T-65-supply-chain.test.ts` and `wave3-ops/run.sh` pass. (re-run 2026-11-04, green under the CI `_RTFINDING` filter).
- Variant (new, not covered by the regression): EVERY tracked package.json (incl. the non-workspace `apps/web/e2e`, `apps/web/test/redteam`) pins exactly — no range, tag, git/url/file/link spec; no `pnpm.overrides` / `resolutions` range; no ranged named catalog.

```sh
cd scripts && npx vitest run test/regression/verify-rt-p-03-05-06-07-static.test.ts -t RT-P-05
```
