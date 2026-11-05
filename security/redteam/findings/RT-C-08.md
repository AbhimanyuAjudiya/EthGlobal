---
id: RT-C-08
title: Foundry cannot execute Hedera system contracts, so the 296 token-mode branch of Deploy.s.sol reverts before any broadcast
module: packages/contracts/script/Deploy.s.sol (_checkUsdc, deploy hedera branch); docs/ONSITE-RUNBOOK.md step 3
threat: T-09 (and the T-08 decimals check, RT-C-04)
severity: Med
likelihood: H
status: fixed
found_by: orchestrator (live pre-deploy, Wed 14:00 slot)
owner: builder-contracts
found_at: 2026-11-05T14:20+05:30
due: before the first live DataDrop deploy on 296 (blocks runbook step 3)
attack_test: n/a (tooling): the repro below is the runbook command itself
regression_test: packages/contracts/test/regression/T09_HederaForgeSimulation.t.sol::test_Regression_RTC08_DeployHederaRunsUnderStandIns (with test_Regression_RTC08_PlainDeployRevertsOnLiveHederaCode, test_Regression_RTC08_DeployHederaRefusesOtherChains)
fix_commit: (recorded by the follow-up commit)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd packages/contracts
export HEDERA_TESTNET_RPC_URL=https://testnet.hashio.io/api PAYOUT_ADDRESS=… ATTESTOR_ADDRESS=… OWNER_ADDRESS=…
CHAIN=296 forge script script/Deploy.s.sol:Deploy --rpc-url hedera_testnet --sender <deployer>   # no --broadcast needed
#   0x…068cDa::decimals() → [InvalidFEOpcode]; Error: script failed: <empty revert data>
cast code 0x0000000000000000000000000000000000068cDa --rpc-url $HEDERA_TESTNET_RPC_URL   # 0xef0100…0167
cast code 0x0000000000000000000000000000000000000167 --rpc-url $HEDERA_TESTNET_RPC_URL   # 0xfe
cast call 0x0000000000000000000000000000000000068cDa "decimals()(uint8)" --rpc-url $HEDERA_TESTNET_RPC_URL  # 6 (relay runs HTS)
```

The HTS USDC facade is not "no code" (the `[verify Wed]` guess in `_checkUsdc`): the relay reports an EIP-7702
delegation designator to the HTS system contract `0x167`, whose reported code is the single `INVALID` opcode. Foundry's local
EVM follows the designator and executes `0xfe`, so every HTS touch in the script's local run dies the same way:
`decimals()` in `_checkUsdc`, `associateHts` (calls `0x167`), `isHtsAssociated` (calls the facade's `isAssociated()`). The
same calls succeed on the real chain (the relay executes HTS natively), so this is a simulation limit, not a facade fault.

## Impact

Runbook step 3 cannot run as written: no DataDrop on 296, so no `deploy:txs`, `acceptOwnership`, hello campaign or
`Claimed` event, and the live `hedera:testnet` sponsor-pool path has nothing to point at. The in-script T-09 assertion
("fail the broadcast unless the association is recorded and the token does not deny it", §6.1 rule 4) is unexecutable on
the only chain it exists for; whichever fix is chosen, the real check moves to a post-broadcast read from the relay
(`cast call $DD "isHtsAssociated(address)(bool)" 0x…068cDa`). `LEDGER_ONLY=true` (§6.1 rule 5) is NOT the right fallback:
the facade does not misbehave, the tooling does, and ledger-only would drop USDC custody on 296 for no on-chain reason.

## Fix (proposed; the owner decides, THREAT-MODEL T-09 and §6.1 rule 4 change wording either way)

A. Hedera-only wrapper in `script/Deploy.s.sol` (`contract DeployHedera is Deploy`): before `run()`, `vm.etch` a 15-line
   stand-in at `0x167` (`associateToken` → 22) and at the facade (`decimals` → 6, `isAssociated` → true), local run only;
   broadcast with `--skip-simulation` (forge then takes each tx's gas from the relay's `eth_estimateGas`, which runs the real
   HTS). `Deploy`, its tests and the broadcast folder (`broadcast/Deploy.s.sol/296`, so `deploy:txs` still works) stay as
   they are. Runbook adds the post-broadcast `cast call … isHtsAssociated` and `decimals()` checks as the live T-09/T-08 gate.
B. Move the HTS steps out of the script: on 296 the script deploys (owner = deployer) and calls `transferOwnership`;
   `associateHts` runs as `cast send … --account deployer` (relay-estimated gas), then the same `cast call` gate, then
   `acceptOwnership`. Touches Deploy.s.sol, Deploy.t.sol (3 cases), T09_HtsAssociation.t.sol, RT_Deploy.t.sol (2), runbook.
C. `LEDGER_ONLY=true` — documented but rejected above; needs a DISCLOSURE.md line.

Regression test to add (builder, with A or B): a fork-free test that etches `0xef0100…0167` at the facade and `0xfe` at
`0x167` on `vm.chainId(296)` and asserts the chosen path does not revert in local execution.

## Builder notes (optional)

Fix A (2026-11-05, builder-contracts). `script/Deploy.s.sol` gains `contract DeployHedera is Deploy` in the same file (so
`broadcast/Deploy.s.sol/296/run-latest.json` and `pnpm deploy:txs` are unchanged) plus two inline stand-ins,
`HtsSystemStandIn` (`associateToken` → 22) and `HtsUsdcStandIn` (`decimals()` → 6, `isAssociated()` → true), `vm.etch`ed at
`0x…0167` and at `vm.parseAddress(chain.usdc)` before the audited `Deploy.deploy` runs; it refuses any chain other than
295/296 and logs that the stand-ins serve only Foundry's local run, naming the two post-broadcast `cast call`s. The
override sits on `deploy(chain, cfg)` (now `virtual`; nothing else in `Deploy` changed) rather than on `run()`: `run()`
dispatches to it virtually, so the live command path is identical, and the regression test drives it with an explicit
`Config` instead of `vm.setEnv`, which is process-wide and would race `DeployTest` under forge's parallel runner. The
on-chain facade code is the 23-byte designator `0xef01000000000000000000000000000000000000000167` (a 21-byte spelling
elides two zero bytes and `vm.etch` rejects it); `vm.etch` parses the `ef01` prefix as EIP-7702 bytecode, which is how
the regression reproduces the failure without a fork. `--skip-simulation` is needed for a dry run as much as for the
broadcast: without it forge re-simulates the collected transactions on a fresh fork (no stand-ins) and
`0x…0167::associateToken` dies there although the local run succeeded. Verified in forge 1.5.1
`crates/script/src/broadcast.rs`: `estimate_via_rpc = has_different_gas_calc(chain) || skip_simulation`, after which
`estimate_gas` sets each transaction's gas to `provider.estimate_gas(tx) * estimate_multiplier / 100`
(`--gas-estimate-multiplier`, default 130). Dry run against testnet (no broadcast, `--sender` = the deployer's public EVM
address): `DeployHedera … --skip-simulation` exits 0 with the `DataDrop …` lines and three transactions in the dry-run
JSON (CREATE, `associateHts`, `transferOwnership`); plain `Deploy` still fails at `0x…068cDa::decimals()` with
`InvalidFEOpcode`. Runbook step 3, the README and THREAT-MODEL T-09 / §6.1 rule 4 now describe the in-script assertion
as running against stand-ins on 296, with the two `cast call`s as the live T-08/T-09 gate.
