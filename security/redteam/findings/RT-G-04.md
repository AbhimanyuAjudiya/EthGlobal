---
id: RT-G-04
title: Without AGENT_OWNER the agent spends its wallet under any policy owner — including a stranger who squatted the policy (T-73 b)
module: services/agent/src/deps.ts
threat: T-73
severity: Med
likelihood: L
status: fixed
found_by: redteam-wave2
owner: builder-agent
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/agent/test/redteam/rt-agent.test.ts::a watched key whose policy owner is a stranger ⇒ no purchase unless the owner is pinned_RTFINDING
regression_test: services/agent/test/redteam/verify-rt-g-02-03-04.test.ts::live with AGENT_OWNER = any public Anvil/Hardhat account ⇒ refused [RT-G-04] (+ services/agent/test/config.test.ts::live refuses public Anvil keys, missing RPC, … (now also every public Anvil/Hardhat owner); packages/adapters/test/testing/testing.test.ts::publicDevAccounts = the 20 accounts Anvil/Hardhat derive from the public mnemonic (RT-G-04)); earlier regressions (still green): services/agent/test/redteam/rt-agent.test.ts::a watched key whose policy owner is a stranger ⇒ no purchase unless the owner is pinned; services/agent/test/config.test.ts::live refuses public Anvil keys, missing RPC, missing HCS topic, Arkiv or the Hedera wallet
fix_commit: (uncommitted, verification fix pass 2026-11-04; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd services/agent && npx vitest run test/redteam/rt-agent.test.ts -t "policy owner is a stranger"
```

`AGENT_WATCH_KEYS=<key>`, no `AGENT_OWNER` (the documented local setup; allowed in live). The key's policy is owned by the
stranger with `maxUsd6PerDay: 1 000 000 000` ⇒ the agent buys. With `AGENT_OWNER` pinned the policy is skipped `not-mine`
(control passes).

## Impact

With T-73 b open (first owner of a free entitlement's policy wins, and RT-O-01 publishes free keys), a stranger who registers
the policy first decides the threshold, step and daily cap the agent's own wallet pays under (up to the wallet balance, the
physical cap). Money goes to our payout, the victim gets data, the agent owner loses the funds. Med/L.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

In live, require `AGENT_OWNER` (or a per-key owner in `AGENT_WATCH_KEYS=<key>@<owner>`) and skip any policy whose owner is
not pinned; keep the local default but log a warning when no owner is pinned.

## Builder notes (optional)

- **Live requires `AGENT_OWNER`** (`loadConfig` ConfigError); any policy whose owner is not the pinned one is skipped
  `not-mine` (unchanged).
- **Local without `AGENT_OWNER`**: the policy is followed only if its owner equals the entitlement's payer, else
  `owner-unverified` (fail closed). `LedgerReads` has `payer` from the entity; `ApiReads` (`/me` has no payer) takes it
  from the paid key we asked for (`paid:<payer>:<nonce>`, `paidKeyPayer`). Free/gift entitlements carry no payer, so
  locally they need `AGENT_OWNER`. `buildAgent` logs a `degraded / owner` warning when no owner is pinned.
- **Policy signature**: checked `@ethglobal/protocol` at fix time — the concurrent T-73 work adds `sessionPubKey` to
  the `PUT /agent/policy` body only; neither `agentPolicySchema` (entity) nor `agentPolicyViewSchema` carries an
  owner signature the agent could verify. So the agent fails closed on the owner instead (pinned owner live, payer
  match local). When a signed field lands on the stored policy, verify it in `tick` before `policyFromWire`.

The `_RTFINDING` test was renamed in place and passes; the control test is unchanged.

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): REOPENED.** The named regressions pass (stranger-owned policy ⇒ no purchase without a
pinned owner; live refuses a missing `AGENT_OWNER`). The pin itself accepts a key everyone has.

### Repro (verification variant)

```sh
cd services/agent && npx vitest run test/redteam/verify-rt-g-02-03-04.test.ts -t 'RT-G-04|AGENT_OWNER'
```

`loadConfig({ ...liveEnv, AGENT_OWNER: <any of the ten public Anvil accounts> })` **boots MODE=live** (the builder's own live
fixture in `test/config.test.ts` pins Anvil #5, `0x9965…A4dc`). `loadConfig` refuses a public Anvil key as the agent's PAYER
(`isAnvilKey`) but has no such check for the OWNER. Whoever holds the published Anvil key signs `PUT /agent/policy` as "the
owner" — `tick` then sees `policy.owner == deps.owner` and pays under the stranger's policy: the T-73 b squat this finding
closes, back through configuration.

Failing test (marked `// RT-FINDING`, suffixed `_RTFINDING`):
`services/agent/test/redteam/verify-rt-g-02-03-04.test.ts::live with AGENT_OWNER = any public Anvil account ⇒ refused_RTFINDING`.

Impact: needs an operator to copy a local value into live (the shipped fixture does exactly that), then the original RT-G-04
impact (the agent's wallet spent under a squatted policy, bounded by the policy's daily cap).

Suggested fix: in `loadConfig`, refuse `AGENT_OWNER` that is one of `anvilAccounts` when `MODE=live` (as for
`AGENT_EVM_PRIVATE_KEY`), and move the live fixture to a non-public address.

## Builder notes (verification fix pass)

`loadConfig` refuses, in live, an `AGENT_OWNER` that `isPublicDevAccount` (any case) — imported from `@ethglobal/adapters/testing`, which now exports `publicDevAccounts` (Anvil #0–#9 + Hardhat #10–#19, derived from the public mnemonic in its test) and `hardhatExtraAccounts`. The live fixture in `test/config.test.ts` uses a non-public owner. Local mode still accepts a public owner (documented in the agent README).
