---
id: RT-W-12
title: 'Local-only code is runtime-gated, not compiled out: the live client bundle carries the demo-wallet transport (/api/demo-wallet), the /__local/world-proof simulator call and the __RECHARGE_TEST__ tamper hook'
module: apps/web/lib/env.ts (IS_LOCAL); apps/web/lib/wallet.ts; apps/web/lib/api.ts; apps/web/components/PaySheet.tsx
threat: T-63
severity: Low
likelihood: L
status: fixed
found_by: redteam-wave3-web
owner: builder-web
found_at: 2026-11-04T17:25+05:30
due: 2026-11-05T20:59+05:30
attack_test: security/redteam/wave3-web/run.sh::live_local_code_not_compiled_out
regression_test: 'security/redteam/wave3-web/run.sh::live client chunks: local-only code compiled out; apps/web/test/no-anvil-key-in-bundle.test.ts::live client bundle (LIVE_BUNDLE_DIR) compiles out the demo wallet, the World ID simulator call and the e2e hook'
fix_commit: (uncommitted: wave-3 web fix pass in the working tree; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
bash security/redteam/wave3-web/run.sh --live-only
grep -l -E '__local/world-proof|/api/demo-wallet|__RECHARGE_TEST__' tmp/rt-web-live/.next/static/chunks/*.js
```

`IS_LOCAL` is an exported `const` in `lib/env.ts`; across module boundaries the minifier keeps it as a binding
(`k.G ? globalThis.__RECHARGE_TEST__ : {}`), so the guarded branches stay in the live chunks. The live server side holds
(verified): `/api/demo-wallet` → 404 even with `DEMO_WALLET_MNEMONIC` exported, `/__local/*` → 404, no "Simulated World ID"
button, no key or mnemonic in `.next/static` or `.next/server`, no source maps, forbidden-pattern scan clean.

## Impact

Defence in depth only: live safety rests on one runtime boolean plus the API/route 404s. web.md §3/§8 asks for
"compiled out of the live build (+ a build test)"; the builder's `no-anvil-key-in-bundle` test checks key strings, not
code.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Read `process.env.NEXT_PUBLIC_MODE === 'local'` inline at each guard (Next inlines the literal and the minifier folds
the branch), or move `demoProvider`, `api.simulatedProof` and the test hook into a `lib/local/*` module imported only
inside `if (process.env.NEXT_PUBLIC_MODE === 'local') {{ await import('./local/…') }}`. Extend
`test/no-anvil-key-in-bundle.test.ts` to a live build grep for `/api/demo-wallet` and `__local/`.

## Builder notes

No exported `IS_LOCAL` binding any more: every guard is the literal `process.env.NEXT_PUBLIC_MODE === 'local'` (Next inlines the string, the minifier folds the branch), and the local-only code moved to `lib/local/{demo-wallet,world-sim,test-hooks}.ts`, imported only with `await import()` inside such a guard. A `NEXT_PUBLIC_MODE=live` build carries none of `/api/demo-wallet`, `__local/world-proof`, `__RECHARGE_TEST__` in `.next/static` (run.sh part 3: 18/18 ✓; `LIVE_BUNDLE_DIR=… vitest` 2/2).
