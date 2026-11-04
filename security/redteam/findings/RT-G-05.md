---
id: RT-G-05
title: The agent writes the Anvil mnemonic literally in src/deps.ts; the forbidden-pattern scan of services/agent fails
module: services/agent/src/deps.ts
threat: T-63
severity: Low
likelihood: H
status: fixed
found_by: redteam-wave2
owner: builder-agent
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: security/redteam/tools/scan.sh services/agent (src/deps.ts:27)
regression_test: services/agent/test/regression/T-63-no-test-mnemonic.test.ts; security/redteam/tools/scan.sh services/agent (clean)
fix_commit: (uncommitted, wave-2 agent fix pass; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
security/redteam/tools/scan.sh services/agent
# FORBIDDEN PATTERN in services/agent/src/deps.ts: 27: export const ANVIL_MNEMONIC = 'test test … junk';
```

## Impact

Live is safe (`evmPayer` returns undefined in live without `AGENT_EVM_PRIVATE_KEY`), but the scan gate fails on product
source. Note for the lead: `services/api/src/env.ts` builds the same phrase from an array of words, which keeps the scanner
quiet without changing what ships — the pattern should probably also match the derived Anvil #0 address or the scan should
be accepted with an allow-list entry, not dodged.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Import the mnemonic (or `anvilKeys[anvilRoles.agent]`) from `@ethglobal/adapters/testing` behind the local-mode branch instead
of inlining it, or add a justified `[docs-ok]`-style allow-list entry for `src/deps.ts` in `forbidden-patterns.txt`.

## Builder notes (optional)

`ANVIL_MNEMONIC` and `mnemonicToAccount` are gone from `src/deps.ts` (and `ANVIL_AGENT_INDEX` from `src/config.ts`).
Without `AGENT_EVM_PRIVATE_KEY`, and only when `config.mode === 'local'`, `evmKey()` dynamically imports
`anvilKeys[anvilRoles.agent]` from `@ethglobal/adapters/testing` — live never loads the test keys (it still has no EVM
payer without an explicit key, and `loadConfig` refuses Anvil keys in live). `test/helpers.ts` uses the same source.
Regression `T-63-no-test-mnemonic.test.ts`: no file under `src/` spells a BIP-39 test phrase or a 32-byte hex key, and
the local default payer is Anvil #4. `security/redteam/tools/scan.sh services/agent` ⇒ `scan: clean`. No allow-list
entry was added.

## Verification (red team)
