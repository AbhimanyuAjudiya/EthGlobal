---
id: RT-P-12
title: pnpm deploy:txs trusts chains.json and the RPC: an unvalidated slug rewrites files outside deploy/, and owner/pendingOwner are recorded from any RPC without a chain-id check
module: packages/contracts/script/fill-deploy-txs.mjs; packages/contracts/script/Deploy.s.sol
threat: T-10
severity: Low
likelihood: L
status: open
found_by: redteam-wave3-ops
owner: builder-contracts
found_at: 2026-11-04T16:10+05:30
due: next report (Low: opportunistic, PLAN §6.3)
attack_test: security/redteam/wave3-ops/run.sh::deploy_txs_confines_writes_to_deploy_RTFINDING; security/redteam/wave3-ops/run.sh::deploy_txs_checks_rpc_chain_RTFINDING
regression_test: scripts/test/regression/T-10-deploy-txs.test.ts (escaping/odd slugs, non-key CHAIN, wrong eth_chainId, non-address owner refused; happy path) + security/redteam/wave3-ops/run.sh::fill-deploy-txs.mjs refuses a slug that escapes deploy/ / deploy:txs checks RPC_URL's chain id
fix_commit: (uncommitted, wave-3 ops fix pass on claude/ethglobal-mumbai-build; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
security/redteam/wave3-ops/run.sh   # "deploy": a copy of fill-deploy-txs.mjs in $RT_OUT with chains.json {"31337":{"slug":"x/../../../escaped"}}
```

The script joins `deploy/addresses.${slug}.json` without validation and rewrote `$RT_OUT/escaped.json` (outside the copy's
`deploy/`), adding `txs`. Forge's `fs_permissions` confine `Deploy.s.sol` to `./deploy`, but `_writeAddresses` still
interpolates `chain.usdcHts`/`slug` unescaped into JSON (a quote in chains.json injects keys). `CHAIN=296 RPC_URL=<anything>
pnpm deploy:txs` writes `owner`/`pendingOwner` from whatever that RPC answers, without `eth_chainId == CHAIN`, so a wrong or
hostile RPC can make the committed file claim the cold owner accepted (the property RT-C-05 introduced).

Verified (kept as regressions): RT-C-04/05 regression suites green (`T08_Decimals`, `T10_DeployOwnerRecord`); every
chains.json entry has exactly the 7 alphabetical keys, safe slugs, EIP-55 `usdc`; 296's alias equals long-zero(0.0.429274);
Base Sepolia's equals API-FACTS; the addresses key order equals INTERFACES §6.3; DISCLOSURE keeps the LEDGER_ONLY slot.

## Impact

Needs a malicious/typo chains.json (a PR) or a wrong RPC URL on Wednesday. The addresses file is what `/healthz` and the
drill trust for "rotation key in place". Low.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

In fill-deploy-txs: `if (!/^[a-z0-9_]+$/.test(chain.slug)) throw`; check `cast chain-id --rpc-url $RPC_URL == CHAIN` before the
owner reads and validate both outputs as addresses. In Deploy.s.sol, `require` the same slug charset and reject `"`/`\` in
`usdcHts`.

## Builder notes

`fill-deploy-txs.mjs`: CHAIN must be decimal and an own key of chains.json; the slug must match `^[a-z0-9_]+$`; the resolved addresses path must sit directly in `deploy/`; with `RPC_URL`, `cast chain-id` must equal CHAIN before `owner()`/`pendingOwner()` are read, and both answers must be addresses. Not done here: the `Deploy.s.sol` slug/`usdcHts` `require`s (builder-contracts; they would change gas snapshots and forge tests outside this pass). The committed chains.json is already safe (run.sh checks every slug and usdcHts).

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): REOPENED (Low).** The named regression passes, and so do the spelling variants in
`scripts/test/regression/verify-rt-p-12-deploy-txs.test.ts` (CHAIN `031337` / `+31337` / `0x7a69` / padded, and hex or
concatenated `eth_chainId` answers are all refused). The "writes only inside deploy/" property fails through a symlink.

### Repro (verification variant)

```sh
cd scripts && npx vitest run test/regression/verify-rt-p-12-deploy-txs.test.ts -t symlinked
```

1. chains.json is clean (`31337 → slug "anvil"`); `deploy/addresses.anvil.json` is a **symlink** to a JSON file outside
   `deploy/` (a symlink is ordinary repo content — git stores it — exactly like the slug the original finding abused).
2. `CHAIN=31337 node script/fill-deploy-txs.mjs` passes the path check (the path string sits directly in `deploy/`), reads the
   target through the link and **rewrites the outside file** (txs merged, reformatted).

Failing test (marked `// RT-FINDING`, suffixed `_RTFINDING`):
`scripts/test/regression/verify-rt-p-12-deploy-txs.test.ts::deploy/addresses.<slug>.json symlinked outside deploy/ ⇒ refused or the outside file untouched_RTFINDING`.

Suggested fix: `lstat` the addresses path and refuse a symlink (or compare `realpath(file)`'s directory with
`realpath(deploy/)`), and write via a temp file in `deploy/` + `rename` (which replaces the link rather than following it).
