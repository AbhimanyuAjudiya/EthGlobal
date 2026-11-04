---
id: RT-G-04
title: Without AGENT_OWNER the agent spends its wallet under any policy owner — including a stranger who squatted the policy (T-73 b)
module: services/agent/src/deps.ts
threat: T-73
severity: Med
likelihood: L
status: open
found_by: redteam-wave2
owner: builder-agent
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/agent/test/redteam/rt-agent.test.ts::a watched key whose policy owner is a stranger ⇒ no purchase unless the owner is pinned_RTFINDING
regression_test:
fix_commit:
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

## Verification (red team)
