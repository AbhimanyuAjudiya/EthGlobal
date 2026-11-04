---
id: RT-A-08
title: A payment is not bound to its route or resource: a top-up PAYMENT-SIGNATURE buys a gift PIN for whoever submits it first
module: packages/octroi/src/decide.ts
threat: T-26
severity: Low
likelihood: L
status: open
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-payment.test.ts::a top-up payment for key K is refused when replayed as a gift purchase_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd services/api && npx vitest run test/redteam/rt-payment.test.ts -t "replayed as a gift"
```

Sign the payment the 402 of `GET /esim/topup?key=K&mb=100` asks for, then send that header to `POST /gift { name:
'bob.eth', mb: 100 }` ⇒ `201` with a PIN. The offer for `mb=100` is identical on both routes (network, asset, payTo, amount,
`extra.{mb, stepMb, sessionKeyRequired}`); `payload.resource` is never compared.

## Impact

Extends the recorded AP7.8 (payment not bound to `?key=`, Low): whoever holds a victim's not-yet-used payment header (a
logging proxy, a browser extension, a leaked HAR) can redirect the victim's top-up into a gift card whose PIN only the
attacker receives. Requires header capture before use, hence Low.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Put the route/purpose into the offer the payer signs: add `extra.purpose` (`topup:<sha256(key)>`, `gift`, `provision`) to the
accepts of each route and compare it in `sameRequirements`, and/or require `payload.resource.url` to equal the request's
resource (path + query).

## Builder notes (optional)

## Verification (red team)
