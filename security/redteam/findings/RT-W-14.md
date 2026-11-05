---
id: RT-W-14
title: 'HashPack (Hedera) pays top-ups only: an LPA-delivering route (/esim/provision, /gift) binds the session key through the EIP-3009 nonce, a Hedera payload has no place for it, so octroi refuses the payment (session_binding_unsupported) and the PWA blocks Hedera there'
module: packages/octroi/src/decide.ts (sessionBound); apps/web/lib/hedera-wc.ts (HashPackPaySigner.choose); apps/web/components/PaySheet.tsx (hederaSessionBound)
threat: T-32
severity: Low
likelihood: H
status: open
found_by: builder-web (HashPack rail, 2026-11-06)
owner: builder-api
found_at: 2026-11-06T05:30+05:30
due:
attack_test: apps/web/test/hedera-wc.test.ts::chooses only the allow-listed Hedera offer, never an LPA (session-bound) route
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

`GET /esim/provision?mb=100` with `X-Session-Pubkey` → 402 whose Hedera entry carries `extra.sessionKeyRequired: true`.
A valid HashPack-signed `{ transaction }` for that entry reaches `paidLane` → `sessionBound()` →
`deny('invalid-payment', 'session_binding_unsupported')` before settlement (fail closed, no money moves). The web client
also refuses on its side: `fetchWithPayment` throws when `sessionPubKey` is set and the payload is not EVM exact.

## Impact

Availability only: a traveller with only a Hedera wallet cannot buy a NEW plan or a gift; top-ups (`/esim/topup`,
`sessionKeyRequired: false`) work. No integrity loss: the refusal is before settlement. The PWA now says so
(`pay.hederaTopupOnly`) instead of letting the user sign a transfer the API will reject.

## Fix (proposed)

Bind the session on Hedera through the transaction memo: the PWA sets `memo = sessionNonce(spk)` (hex) in the body it
builds (lib/hedera-wc.ts `transferBodyBytes`), octroi decodes the memo with `@hiero-ledger/proto` (already in the
lockfile, no SDK) and compares; then drop `hederaSessionBound` in PaySheet and the `sessionKeyRequired` clause in
`HashPackPaySigner.choose`. The byte test against `@x402/hedera`'s signer then needs the reference memo set too.

## Builder notes

Residuals of the HashPack rail, recorded here rather than fixed:

- The PWA does not verify the wallet's signature or pre-check the USDC balance / token association; the facilitator does
  both (`verifyPayerSignature`, `preflightTransfer`) and a failure comes back as the decoded 402 reason.
- One node account (0.0.3) per transaction: if that node is down the facilitator's submit fails and the user retries.
- Real HashPack behaviour (pairing, `hedera_signTransaction` answer shape, the `link.hashpack.app/wc` hand-off) was not
  exercised by an automated test; only the byte layout is.
