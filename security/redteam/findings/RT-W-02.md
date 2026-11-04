---
id: RT-W-02
title: "script-src carries 'unsafe-inline': the CSP is no backstop, so any future injection reads the IndexedDB LPA and drives the wallet"
module: apps/web/next.config.ts
threat: T-58
severity: Med
likelihood: L
status: open
found_by: redteam-wave3-web
owner: builder-web
found_at: 2026-11-04T17:25+05:30
due: 2026-11-05T20:59+05:30
attack_test: apps/web/test/redteam/rt-xss.spec.ts::injected inline handler does not execute (CSP backstop)_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd apps/web && ./node_modules/.bin/playwright test -c test/redteam/playwright.redteam.config.ts rt-xss
curl -sI http://127.0.0.1:3000/ | grep -i content-security-policy   # script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'
```

1. Every rendered-string sink holds (18 green probes: a campaign name `<img src=x onerror=…>` seeded through the real
   `POST /sponsor` and rendered on `/sponsor/[id]`; 8 payloads × 11 URL-parameter routes; hostile `/plans`, `/me`,
   receipts, `/card/:serial` bodies; a hostile ENS name typed on `/gift`). **No XSS was found.**
2. The backstop does not hold: `document.body.insertAdjacentHTML('beforeend', '<img src="data:," onerror="window.__xss=1">')`
   on any route sets `window.__xss` — the inline handler runs, because `script-src` has `'unsafe-inline'`
   (documented in `next.config.ts` as the price of the static `cacheComponents` shell).

## Impact

wave3-web-ops.md W1.4 and web.md §8 require a `script-src` without `'unsafe-inline'`; T-76 names the CSP as _the
primary control_ for the LPA kept in IndexedDB. Today the only line between one future escaping bug (a new
`dangerouslySetInnerHTML`, a vulnerable dependency, a markdown renderer) and every stored LPA + the demo/injected wallet
prompt is React's escaping. Med because nothing injects today (likelihood L) and the impact compounds with RT-W-01.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Pick one and record it in `next.config.ts`:

1. **Nonces** (Next's documented path): generate a nonce in `proxy.ts` (matcher on every document route), pass it in
   `Content-Security-Policy: script-src 'self' 'nonce-…' 'strict-dynamic' 'wasm-unsafe-eval'`; accept that the
   affected routes render per request (they are client-heavy already; `/`, `/offline` can stay static with a hash).
2. **Hashes**: keep the static shell and emit `'sha256-…'` for the inline RSC/bootstrap scripts at build time (Next's
   experimental SRI); drop `'unsafe-inline'`.
   At minimum add `require-trusted-types-for 'script'` (the app has no HTML sinks — `rt-static` proves it — so it costs
   nothing) so a DOM-XSS sink cannot be introduced silently. Regression: `apps/web/e2e/regression/T-58-xss.spec.ts`.
