---
id: RT-W-08
title: 'Hindi/Marathi: Devanagari renders under lang="en" on buttons, labels, review rows and receipts (121 strings), and consumer screens keep English ("Expires in", "Claim by", "Mumbai · 7 days", "Network fee", day names)'
module: apps/web/components/*.tsx; packages/ui/components (Button, Field, RuledList, Receipt, Countdown, Coupon)
threat: T-70
severity: Low
likelihood: H
status: fixed
found_by: redteam-wave3-web
owner: builder-web
found_at: 2026-11-04T17:25+05:30
due: 2026-11-05T20:59+05:30
attack_test: 'apps/web/test/redteam/rt-a11y-mobile-perf.spec.ts::hi: Devanagari text carries its lang attribute; apps/web/test/redteam/rt-a11y-mobile-perf.spec.ts::mr: Devanagari text carries its lang attribute; apps/web/test/redteam/rt-a11y-mobile-perf.spec.ts::hi: no untranslated English on consumer screens; apps/web/test/redteam/rt-a11y-mobile-perf.spec.ts::mr: no untranslated English on consumer screens'
regression_test: 'apps/web/test/redteam/rt-a11y-mobile-perf.spec.ts::hi: Devanagari text carries its lang attribute; apps/web/test/redteam/rt-a11y-mobile-perf.spec.ts::mr: Devanagari text carries its lang attribute; apps/web/test/redteam/rt-a11y-mobile-perf.spec.ts::hi: no untranslated English on consumer screens; apps/web/test/redteam/rt-a11y-mobile-perf.spec.ts::mr: no untranslated English on consumer screens; apps/web/e2e/visual.spec.ts (landing/plan/pay/card -hi baselines)'
fix_commit: (uncommitted: wave-3 web fix pass in the working tree; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd apps/web && ./node_modules/.bin/playwright test -c test/redteam/playwright.redteam.config.ts rt-a11y-mobile-perf -g "i18n"
```

1. Switch to हिं (or मरा) and walk every consumer route. Text nodes containing Devanagari whose nearest `[lang]` is the
   page's `en`: the pre-flight line on `/`, the "Simulated World ID" button, every `Button` label ("PIN जाँचें",
   "$1.20 USDC दें", "रोकें"), every `Field` label/hint, every `/pay` and `/gift` review row, receipt headers. `t()` is
   called without the `<T>` span or a `lang` prop in those components.
2. Untranslated English on hi/mr screens: `Countdown lead="Expires in"` (PlanView), `Claim by …` and
   `validity: 'Mumbai · 7 days'` (ScratchRedeem, Coupon), "Network fee" (Receipt), "usage as of" on `/pay`, "Local chain",
   and day labels ("Wed 18 Nov") inside Hindi sentences. Marathi additionally falls back to `lang="en"` for the Coupon
   and MbMeter (`lang === 'hi' ? 'hi' : 'en'`).
3. Holds (passing regressions): no raw key id renders; numerals stay Latin.

## Impact

Visible in the screenshots: Hindi on the two-line landing button and in the Chivo Mono review rows renders without the
1.6 leading fonts.css applies via `:lang(hi)` (matras touch the line above) and in a monospace fallback with wide gaps;
screen readers read Devanagari with the English voice. The design brief makes Hindi/Marathi first-class (§6); a
Hindi-speaking judge sees a half-translated product.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

- `Button`, `Field`, `RuledList`, `Receipt`, `Countdown` accept `lang` and set it on their text element; components
  pass `lang` from `useLang()` (or wrap with `<T>`).
- Move "Expires in"/"Expired", "Claim by {day}", "Mumbai · {days} days", "Network fee", "usage as of" into the string
  tables; format day names with `Intl.DateTimeFormat(lang === 'en' ? 'en-IN' : `${{lang}}-IN`, {{ weekday: 'short', day:
'numeric', month: 'short', numberingSystem: 'latn' }})`.
- Coupon/MbMeter: pass `lang` through for `mr` as well.
- Never set Devanagari in Chivo Mono: right-column review values that are sentences use the text face.

## Builder notes

`<html lang>` follows the chosen language (`LangProvider`; `?lang=hi|mr` links work), so every Devanagari node — buttons, field labels, review rows, receipts — is under `hi`/`mr`; English-only islands (wordmark, hashes, the sponsor console) carry `lang="en"`. `@ethglobal/ui` components take `lang` with `en`/`hi`/`mr` tables (`strings.ts`: Coupon, MbMeter, UsageAsOf, Receipt, Countdown units, OnchainAction status lines, Hash). New/changed keys: `plan.expiresIn` (sentence order per language), `card.claimBy`, `network.local`, `pay.*` blocked messages, `agent.capAria/capLegend`, `install.done`, `receipts.dayYou`, status-pill words in hi/mr. Day names use `Intl` `hi-IN`/`mr-IN` with Latin numerals. `RuledList` values are prose in the text face (mono only for figures), and the mono lines (TESTNET strip, settling tag, resolve line) switch to the text face under hi/mr: Devanagari is never set in Chivo Mono. The validity line "Mumbai · 7 days" is gone (see RT-W-09).
