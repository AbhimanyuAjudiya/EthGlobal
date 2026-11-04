---
id: RT-W-11
title: idkit-core's rp_context signer (signRequest / signingKeyHex) ships in a client chunk of both the local and the live build; run-wave.sh 3's live-bundle grep fails on it
module: apps/web/components/VerifySheet.tsx (import('@worldcoin/idkit-core'))
threat: T-81
severity: Low
likelihood: H
status: open
found_by: redteam-wave3-web
owner: builder-web
found_at: 2026-11-04T17:25+05:30
due: 2026-11-05T20:59+05:30
attack_test: apps/web/test/redteam/rt-static.spec.ts::no rp_context signer code (signRequest / signingKeyHex) in client chunks_RTFINDING; security/redteam/wave3-web/run.sh::live_client_rp_signer_code_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
bash security/redteam/wave3-web/run.sh --live-only
grep -l 'signingKeyHex' apps/web/.next/static/chunks/*.js     # the dynamic idkit-core chunk
```

`VerifySheet` dynamically imports the package root `@worldcoin/idkit-core`; its `index` re-exports `./signing` and the
package declares no `sideEffects: false`, so Turbopack keeps `signRequest({ signingKeyHex, action, ttl })` in the client
chunk. No key is present (the RP key never reaches the web), but wave3-web-ops W2.2 requires the browser bundle to carry
no signer, and `security/redteam/run-wave.sh 3` greps the live build for `signingKeyHex|idkit-core/signing` — that gate
fails today.

## Impact

No key leaks. The risk is a future "just sign it client-side for the demo" shortcut being one import away, and a
wave-3 gate that cannot go green.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Import only what the browser needs (`IDKit`, `documentLegacy`) from a subpath that excludes signing if idkit-core
exposes one, or add `experimental.optimizePackageImports: ['@worldcoin/idkit-core']`/a `sideEffects` override so the
unused export is dropped; re-run the grep. If neither works, the lead may narrow the run-wave 3 pattern to key values and
accept this as Low with a THREAT-MODEL §8 line.
