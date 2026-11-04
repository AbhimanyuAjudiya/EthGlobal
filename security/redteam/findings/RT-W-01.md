---
id: RT-W-01
title: 'The opened LPA is never deleted from IndexedDB: it outlives the install and every plan on the device keeps its own'
module: apps/web/lib/store.ts; apps/web/lib/deliver.ts; apps/web/components/InstallSteps.tsx
threat: T-76
severity: Med
likelihood: M
status: open
found_by: redteam-wave3-web
owner: builder-web
found_at: 2026-11-04T17:25+05:30
due: 2026-11-05T20:59+05:30
attack_test: apps/web/test/redteam/rt-lpa-plumbing.spec.ts::opened LPA is deleted once /me says installed_RTFINDING; apps/web/test/redteam/rt-lpa-plumbing.spec.ts::a second plan does not keep the first plan's LPA (one LPA at a time)_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd apps/web && ./node_modules/.bin/playwright test -c test/redteam/playwright.redteam.config.ts rt-lpa-plumbing -g "deleted once|one LPA at a time"
grep -rn "del(" apps/web/lib apps/web/components     # only the definition in store.ts: nothing ever deletes `lpa:<key>`
```

1. Claim a free bundle (`/` → Simulated World ID → `/plan/<key>`): IndexedDB `recharge/kv` holds `lpa:<key>` (allowed until install, T-76).
2. Make `/me/<key>` report `status: "active"` (the reseller webhook path; the test rewrites the response), open `/install` (pill reads "LTE · Recharge"), then `/plan/<key>`: `lpa:<key>` is still there. It is never deleted — no code path calls `del('lpa:…')`.
3. Redeem a scratch card on the same device: IndexedDB now holds **two** opened LPAs (THREAT-MODEL §8 accepts "one LPA at a time").
4. Aggravation: on a desktop UA (`device.os === 'other'`) `/install` prints the full activation code on load — no tap, no warning (the QR is gated, the text is not) — on exactly the shared-laptop device T-76 names.

## Impact

An opened LPA is a bearer secret: whoever installs it first owns the plan (THREAT-MODEL §6.5). T-76 accepts IndexedDB
storage only _until install is confirmed_ and only for the active install; the PWA keeps every LPA forever. Any later
script injection (RT-W-02: the CSP is no backstop), a shared airport laptop, a browser-profile backup or a stolen phone
yields every activation code this device ever received. The MB at stake is small (300 MB testnet plans today), the class
of secret is not.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

- In `InstallSteps` (and `PlanView`), when `/me` reports `status ∈ {installed, active}` — or the user taps a new
  "Installed" control — call `del('lpa:' + key)`; render "Installed · code removed from this device".
- In `deliver()`, before `saveLpa(key, lpa)`, delete every other `lpa:*` (one LPA at a time, §8).
- On `device.os === 'other'`, hide the code behind the same explicit "For another phone" tap and warning as the QR.
- Regression: `apps/web/e2e/regression/T-61-lpa-plumbing.spec.ts` (THREAT-MODEL §5.12) with both cases above.
