---
id: RT-P-11
title: Seed and print secrets hygiene: .e2e PINs/keys/audit key written 0644, demo-seed --reset wipes state and spends Anvil txs before checking the API is local, PRINT_TOKEN length unchecked
module: scripts/demo-seed.ts; scripts/print-cards.ts
threat: T-64
severity: Low
likelihood: L
status: open
found_by: redteam-wave3-ops
owner: builder-ops-demo
found_at: 2026-11-04T16:10+05:30
due: next report (Low: opportunistic, PLAN §6.3)
attack_test: security/redteam/wave3-ops/run.sh::seed_secrets_written_0600_RTFINDING; security/redteam/wave3-ops/run.sh::seed_checks_target_is_local_RTFINDING; security/redteam/wave3-ops/run.sh::print_token_length_checked_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
stat -c '%a %n' .e2e/cards.json .e2e/keys.json .e2e/audit-key.txt     # 644 (the web agent's .e2e/web-print-cards.json is 600)
API_URL=<a MODE=live API> RPC_URL=<anvil> tsx scripts/demo-seed.ts --reset   # deletes .e2e/{state,keys,gift,cards}.json, approve + createCampaign, then fails
```

1. `writeFileSync` without `mode` ⇒ PINs, entitlement keys and the sponsor audit key are world-readable on a shared box.
2. `--reset` runs `rmSync` on the seed files and broadcasts two Anvil txs before the first API call reveals the target is
   not MODE=local (the live run ends at `POST /__local/clock → 404`; it never mints anything — OP2 holds).
3. `print-cards.ts` forwards any `PRINT_TOKEN` (T-64 asks ≥ 32 random bytes); its local fallback is 12 bytes. If the script
   is SIGKILLed, `finally` does not run: the 0600 PIN file stays in its 0700 tmp dir, the `next` child keeps serving
   `/print/cards`, and the token is not redacted from `.e2e/web.log`.

Verified (kept as regressions): the manifest is exactly `{ serial, mb }`; PINs are 15 CSPRNG digits by rejection sampling +
Verhoeff (20 000 draws: all valid, distinct, χ² = 6 on 9 dof); the serial is `giftId[2:10]` of an independent random
`giftId`, so serials do not predict PINs and the Verhoeff digit gives only a checksum; dry-run (`--count`) serials are
sequential `d0…` but carry fresh random PINs that redeem nothing.

## Impact

Local, synthetic in MODE=local; on Thursday the same script handles the 200 live PINs (`--input /secure/cards.json`). Low.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

`{ mode: 0o600 }` on every `.e2e` secret file (and `chmod 700 .e2e`); call `GET /healthz` and refuse unless `mode === 'local'`
before `--reset`; in print-cards refuse `PRINT_TOKEN` shorter than 43 base64url chars and use 32 random bytes for the
fallback; `stopWithParent` already exists — also remove the secret dir from the watchdog path.
