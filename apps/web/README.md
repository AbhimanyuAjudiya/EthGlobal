# @ethglobal/web

The Recharge consumer PWA, the sponsor console and the print route (Next 16 App Router, React 19, Tailwind v4).
Binding specs: `docs/build-briefs/web.md`, `research/design-references.md`, `docs/INTERFACES.md` §7/§1.6/§1.8.
Imports `@ethglobal/protocol`, `crypto`, `eip3009`, `ui`, `contracts/abi` only (eslint zone); never adapters,
octroi or services.

## Routes

| Route                                    | Dominant element                                                                     | Notes                                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                      | the live `Coupon` ("1,214 of 2,000 sponsor bundles left · Hedera" from `GET /plans`) | two paths (Prove I'm human → 300 MB / I'll pay · $0.40 per 100 MB), quiet rows, UA pre-flight; exhausted → "Pay $1.20 for 300 MB"                                                             |
| `/verify`                                | "World checks you're one human…"                                                     | `POST /challenge` (session key made here) → `POST /world/rp-context` → IDKit 4.6 (live) / API simulator (local) → `POST /claim` with the result unchanged; tier ledger from `/plans`          |
| `/plan`, `/plan/[key]`                   | the MB number (the in-app `Coupon`)                                                  | IssuingRows, `MbMeter` + "usage as of" (`usageAsOf`), expiry from `expiresAt` (`Countdown`), Arkiv-key disclosure, three-line receipt, Install, AddToHomeScreen → NotificationAsk after issue |
| `/install`                               | the OS's words as a status pill                                                      | iOS 17.4+ universal link + "Didn't open? Tap again"; Android copy-code + Settings steps + `intent:` link labelled unverified; QR only behind "For another phone" (60 s); no URL parameters    |
| `/pay` (`?key=` top-up, `?mb=` new plan) | the `OnchainAction` sheet                                                            | 402 Review → demo/injected wallet signs EIP-3009 → `fetchWithPayment` → hash → Final; Hedera accepts shown as an instruction panel                                                            |
| `/agent`                                 | the policy as a sentence                                                             | cap stepper + Pause; EIP-712 `AgentPolicy` → `PUT /agent/policy` (with the claim session's public key on the first save, A-35)                                                                |
| `/gift`, `/gift/claim`                   | "Who gets it?" → `BoardingPass`                                                      | reclaim rule stated before paying; claim by `GiftClaim` signature or PIN; reclaim after claimBy                                                                                               |
| `/card`, `/card/[serial]`                | the coupon                                                                           | read-only preview, Verhoeff check on device, `ScratchCard` (45 %) or "Reveal PIN", `POST /card/redeem`                                                                                        |
| `/receipts`                              | per-day three-line receipts                                                          | CSV download                                                                                                                                                                                  |
| `/sponsor`, `/sponsor/[id]`              | "1,214 claims" beside spend · cap · rate                                             | approve + createCampaign from the sponsor's wallet → `POST /sponsor` → audit key once; tables; slide-to-confirm pause; refund after expiry                                                    |
| `/print/cards?token=`                    | the print sheet                                                                      | 404 without `PRINT_TOKEN` (`proxy.ts`); PINs only from the server-side `PRINT_CARDS_FILE`; N pages + 1 keyline                                                                                |
| `/offline`                               | —                                                                                    | service-worker fallback; offline `/plan/<key>` is served the precached `/plan` shell, which renders the IndexedDB snapshot                                                                    |
| `/ui`, `/ui/print`, `/ui/tokens`         | tooling (noindex)                                                                    | component gallery, print sheet, token sheet — **MODE=local only** (404 in live, RT-W-10); fixture PINs fail Verhoeff on purpose                                                               |

## Environment

Public (inlined at build time): `NEXT_PUBLIC_MODE` (`local` compiles in the demo wallet and the simulated World ID),
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_ANVIL_RPC_URL`, `NEXT_PUBLIC_WORLD_APP_ID|ACTION|ENVIRONMENT`,
`NEXT_PUBLIC_EXPLORER_EVM|HEDERA`, `NEXT_PUBLIC_ARKIV_EXPLORER`, `NEXT_PUBLIC_DATADROP_ADDRESS` (live; in local
next.config.ts fills it from `deploy/addresses.anvil.json` once `pnpm dev:chain` has written it), `NEXT_PUBLIC_CHAIN_ID`,
`NEXT_PUBLIC_ATTACH_MEDIAN_S`, `NEXT_PUBLIC_PUBLIC_ORIGIN`
(the host printed QR codes encode; required outside local). Server-only: `DEMO_WALLET_MNEMONIC` (local only),
`PRINT_TOKEN` (≥ 16 chars), `PRINT_CARDS_FILE`.

## Security headers and local-only code

- **CSP with per-request nonces** (`proxy.ts` + `lib/csp.ts`, RT-W-02): `script-src 'self' 'nonce-…' 'strict-dynamic'`,
  no `'unsafe-inline'`. Every document therefore renders per request (`cacheComponents` is off, the root layout is
  `force-dynamic`). `proxy.ts` also 404s `/print/*` without the token and redirects `/install?…` to bare `/install`.
- **Fonts** are the bazaar faces only, self-hosted from `packages/ui/fonts` (Latin + Devanagari subsets, `swap`).
- **Local-only code is compiled out of live builds** (RT-W-12): guard with the literal
  `process.env.NEXT_PUBLIC_MODE === 'local'` and put the code in `lib/local/*`, imported with `await import()` inside
  the guard. There is no exported `IS_LOCAL` constant on purpose. `LIVE_BUNDLE_DIR=<live dist> pnpm --filter
@ethglobal/web test` greps a live build for `/api/demo-wallet`, `__local/world-proof`, `__RECHARGE_TEST__` and the
  idkit signer (`@worldcoin/idkit-server` is aliased to a throwing stand-in for the browser, RT-W-11).
- **The plan pointer** (`currentKey`) only names a plan this device claimed, bought or explicitly kept (RT-W-03); the
  opened LPA is one-at-a-time and deleted once `/me` says `installed`/`active` (RT-W-01).

## The demo wallet (MODE=local only)

`lib/wallet.ts` `demoProvider(role)` is an EIP-1193 transport to `app/api/demo-wallet` (404 unless
`NEXT_PUBLIC_MODE=local` and `DEMO_WALLET_MNEMONIC` is set). The route derives Anvil #5 (human), #3 (sponsor) and #9
(rahul.eth) from the mnemonic on the server, so no key is in the bundle (`test/no-anvil-key-in-bundle.test.ts`). The
route answers same-origin JSON only and allow-lists read methods (no `anvil_*`/`evm_*`, RT-W-05).
Every screen shows "demo wallet · Anvil #n". Injected wallets (EIP-6963) use the same code path.

## Tests

```sh
pnpm --filter @ethglobal/web test        # vitest: reducer, lpa-links, i18n, format, device, pay402, session key, ActionView, bundle grep
bash scripts/e2e-local.sh --web          # Anvil + API + seed + flow, then Playwright (e2e/serve.sh builds and serves this app)
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 pnpm --filter @ethglobal/web e2e   # against an already-running app
```

Playwright expects the API on `PLAYWRIGHT_API_URL` (default `:8788`) and Anvil on `PLAYWRIGHT_RPC_URL`/`RPC_URL`
(`:8546`). `e2e/global-setup.ts` registers a campaign and seeds three cards (`E2E_STATE_FILE` / `PRINT_CARDS_FILE`
move its outputs); `zz-clock.spec.ts` moves the API and chain clocks and runs last. Screenshots:
`e2e/__screenshots__/<name>-<light|dark>-360.png` — every route, `*-hi` (Hindi via `?lang=hi`), `error-*`,
`sponsor-campaign`, `install-ios` / `install-android`, captured on a phone as tall as the page.

A second build beside a served `.next`: `NEXT_DIST_DIR=.next-fix next build` (and `next start`, `e2e/serve.sh`, the
red-team static checks all honour it). The API must list that origin in `CORS_ORIGINS`.
Icons: `pnpm --filter @ethglobal/web icons` (generated, no stock art).

## `[screenshot Wed]` strings the human team must confirm on real devices

iOS steps `install.ios.1–5` (Continue · label the line · default line · cellular data · Data Roaming), the
"Didn't open? Tap again" behaviour, Android steps `install.android.1–4` and whether the `intent:` settings link opens
anything in Chrome, the status-pill words ("No Service" / "Searching…" / "LTE · …"), and the IDKit 4 bridge hosts
for `connect-src` (`*.worldcoin.org`, `*.world.org` today).
