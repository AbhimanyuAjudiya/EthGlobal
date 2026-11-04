---
id: RT-A-12
title: The self-run facilitator relayer has no nonce manager or send queue: concurrent settlements collide and the loser is refused; griefable through the public /facilitator/settle
module: services/api/src/deps.ts
threat: T-75
severity: Med
likelihood: M
status: open
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-anvil.test.ts::two concurrent real top-ups (two payers) on the self-run facilitator ⇒ both served_RTFINDING; services/api/test/redteam/rt-anvil.test.ts::a 1-unit /facilitator/settle racing a real top-up never makes the top-up fail_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd services/api && npx vitest run test/redteam/rt-anvil.test.ts   # spawns Anvil, deploys DataDrop + MockUSDC3009
```

1. Two payers top up one entitlement at the same time through `X402_FACILITATOR=self` ⇒ `[200, 402]`; the 402 body is
   `invalid_payment` / `settle_unavailable`; payout balance +400 000 only (the loser is not charged).
2. A stranger posts a 1-unit authorization to `POST /facilitator/settle` (our payTo/asset/network, so the T-75 guard passes) at
   the moment a real buyer pays ⇒ the buyer's top-up answers `402`. Reproduced 3/3 runs.

`selfRun()` builds `privateKeyToAccount(RELAYER_PRIVATE_KEY)` without `nonceManager` (contrast `chain.ts`, which uses one plus
a `SerialQueue`), and `createViemRelayer.submit` sends without serialisation, so both transactions get the same nonce.

## Impact

Recoverable outage, but on the demo path: locally (`scripts/e2e-local.sh`, the stage demo on Anvil) the agent's top-up and a
human payment in the same second fail one of them, and anyone can deny service to paying users for the price of 1 micro-USDC
per attempt (30/min/IP; see RT-A-10 for the IP bound). Live uses it only with `X402_FACILITATOR=self` on Base Sepolia.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Give the relayer account viem's `nonceManager` and run `relayer.submit` through a per-relayer serial queue (reuse
`SerialQueue` from `chain.ts`); consider retrying a settle once on a nonce error before answering. Add a regression with two
concurrent settlements on Anvil.

## Builder notes (optional)

## Verification (red team)
