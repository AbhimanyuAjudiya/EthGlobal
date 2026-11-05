# World ID Agent Pass — the human checkpoint of the Recharge agent

_Built Thu 5 Nov 2026 (ETHGlobal Mumbai, World "Agent Pass" prize). Code: `services/api/src/world-agent-pass.ts`,
`services/api/src/routes/agent-pass.ts`, the guard in `services/api/src/routes/claim.ts`, `services/agent/src/pass.ts`,
the screen in `apps/web/components/AgentSheet.tsx`. Tests: `services/api/test/agent-pass.test.ts`,
`services/agent/test/pass.test.ts`. Status: integrated end to end against a local, labelled simulator of the World IdP;
the portal client is **not registered yet** (a human step, §6), so nothing here was run against `auth.world.org` with
a real identity._

## 1. What we built

Recharge's agent (`services/agent`) buys 100 MB top-ups for a traveller's eSIM over x402 while the traveller sleeps,
under an **agent policy** the traveller signs (EIP-712 `AgentPolicy`, `PUT /agent/policy`). The policy used to be the
whole spending authority. Now the policy's authority has to be **armed by a World ID Agent Pass**: a recent,
backend-validated World ID authentication of the traveller, obtained through the **Device Authorization Grant** of
`https://auth.world.org` (the agent is headless; no browser callback).

- **Protected action**: `GET /esim/topup` when the caller is the agent (the `X-Agent-Uaid` header, or an EVM payment
  from an `AGENT_PAYERS` wallet) and the entitlement has a policy. Without an armed pass the API answers **`403
  pass_required` before any `402`** — nothing is quoted, signed or settled. Human top-ups are untouched.
- **Checkpoint**: the agent, on `pass_required`, calls `POST /agent/policy/:key/pass/start`, prints
  `agent-pass: open <verification_uri_complete> (code <user_code>) within <expires_in>s`, journals it, writes a small
  HCS note (`t: agent-pass`, state + code, never a URL or token), and polls `POST /agent/policy/:key/pass/poll` at the
  returned interval. It resumes the buy **only on `approved`**; `denied` / `expired` journal `agent.skip
  { reason: 'pass_denied' | 'pass_expired' }` and buy nothing. `--once` exits 0 either way.
- **Backend validation** (§4) happens in the API, which is the confidential OIDC client. The agent never sees the
  device code, the ID token or the client secret; it only sees `user_code`, the verification URL and a state.
- **Screen**: `/agent` in the PWA shows the pending checkpoint as a QR of `verification_uri_complete` plus the
  `user_code`, then "armed until …", "not granted (reason)" or "expired".
- **Off by default**: without `WORLD_AGENT_PASS_CLIENT_ID` the API behaves exactly as before (no `pass_required`, no
  `pass` field in the policy view, the pass routes are 404). This is how live runs until the client exists.

## 2. The provider, as discovery reports it (fetched 2026-11-05)

`GET https://auth.world.org/.well-known/openid-configuration` (`fixtures/world/agent-pass-discovery.json`):

| Field | Value |
|---|---|
| `issuer` | `https://auth.world.org` |
| `authorization_endpoint` | `https://auth.world.org/api/v1/authorize` (browser code flow; unused here) |
| `device_authorization_endpoint` | `https://auth.world.org/api/v1/device_authorization` |
| `token_endpoint` | `https://auth.world.org/api/v1/token` |
| `jwks_uri` | `https://auth.world.org/.well-known/jwks.json` (one RSA key today, `kid xDQ0qjmm6_…`, `alg RS256`) |
| `grant_types_supported` | `authorization_code`, `urn:ietf:params:oauth:grant-type:device_code` |
| `token_endpoint_auth_methods_supported` | `client_secret_basic`, `client_secret_post`, `private_key_jwt`, `none` |
| `scopes_supported` | `openid` |
| `claims_supported` | `iss sub aud exp iat jti nonce auth_time acr amr` |
| `acr_values_supported` | `https://world.org/oidc/acr/orb`, `https://world.org/oidc/acr/orb-face` |
| `subject_types_supported` | `pairwise` · `id_token_signing_alg_values_supported` `RS256` · `claims_parameter_supported` `true` |

The sandbox (`https://sandbox.auth.world.org`) publishes the same endpoint shapes under its own issuer, plus
`refresh_token` and token-exchange grants. The sandbox needs a sandbox World ID app build (TestFlight via an
integration contact, about an hour of identity issuance) — out of reach tonight, hence the simulator.

### The exact requests we send

Start (RFC 8628 §3.1; `oidc` guide, "Device flow", "For a client registered with client_secret_post"):

```
POST https://auth.world.org/api/v1/device_authorization
Content-Type: application/x-www-form-urlencoded

client_id=<portal client id>&client_secret=<backend secret>&scope=openid
&nonce=<32 hex, fresh per attempt>
&claims={"id_token":{"acr":{"essential":true,"values":["https://world.org/oidc/acr/orb","https://world.org/oidc/acr/selfie"]}}}
```

Poll (RFC 8628 §3.4), after `interval` seconds (+5 on `slow_down`):

```
POST https://auth.world.org/api/v1/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:device_code&client_id=<same>&client_secret=<same>&device_code=<private>
```

`private_key_jwt` is supported too (`WORLD_AGENT_PASS_PRIVATE_KEY_JWK`): `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`
and a fresh RS256 assertion per request (`iss`=`sub`=client id, `aud`=the endpoint, `exp`=`iat`+300 s, unique `jti`),
as the app-registration guide specifies. The portal method is fixed per client; register `client_secret_post` tonight.

Poll answers we handle (the guide's table): `authorization_pending` → keep polling; `slow_down` → +5 s; `expired_token`
→ **expired**; `access_denied`, `login_required`, `invalid_grant`, `unmet_authentication_requirements`, anything else →
**denied** with that reason; HTTP 503 → the attempt ends (`denied`, reason `unavailable`: "temporary unavailability,
never approval"); timeouts / 429 → wait and poll again; the attempt's own `expires_in` ends it regardless.

## 3. The journey (what the demo shows)

1. The traveller signs a policy in `/agent` (cap $5/day, 100 MB steps).
2. Usage drops below the threshold; the agent ticks, `GET /esim/topup` with `X-Agent-Uaid` → **`403 pass_required`**
   (`details.detail` = `none`). No `PAYMENT-REQUIRED` header, no signature, no settlement.
3. The agent `POST …/pass/start` → the API starts the device attempt at World and returns
   `{ verification_uri, verification_uri_complete, user_code, expires_in, interval }`. Log line:
   `agent-pass: open https://…?user_code=XXXX-XXXX (code XXXX-XXXX) within 1200s`. Journal line `pass pending`, HCS
   note `{t:"agent-pass", state:"pending", code:"XXXX-XXXX"}`. The PWA shows the QR and the code.
4. The human opens the link in World and authenticates (Orb or Selfie Check class; a passkey on a verified account
   satisfies the baseline class — see §7 item 2).
5. The agent polls `…/pass/poll`; the API redeems the device code once, **validates the ID token** (§4), binds
   `(iss, sub)` to the policy, marks the token consumed, arms the policy until `auth_time + WORLD_AGENT_PASS_VALID_S`
   and answers `{ state: "approved", passUntil }`. The PWA shows "armed until …".
6. The agent retries the buy: `402` → EIP-3009 / Hedera payment → `200`, `agent-topup` receipt on the ledger and HCS.

### Unsuccessful paths (the protected action does not occur)

- **Denied**: the human cancels, or the essential `acr` is not met → token endpoint `access_denied` →
  `{ state: "denied", reason: "access_denied" }`; the agent journals `agent.skip pass_denied`, releases its purchase
  trigger, buys nothing; the next `GET /esim/topup` is still `403` (`details.detail` = `denied`). PWA: "not granted".
- **Expired**: nobody acts within `expires_in` (World: 20 minutes) → `expired_token`, or the API's own deadline passes
  → `{ state: "expired" }`; the agent journals `agent.skip pass_expired` and `--once` exits 0. PWA: "expired".
- **Invalid result**: any validation failure of §4 → `{ state: "denied", reason: "invalid_pass" }` (the sub-reason is
  logged, never returned). A replayed token, a different World ID than the policy's first approver, a stale
  `auth_time`, the wrong `acr`, a foreign `nonce`, `alg: none`, an unknown `kid` all land here — each has a test.
- **Changed policy**: a new `PUT /agent/policy` with different terms revokes the grant ("Changes require new
  approval", step-up guide); the agent must get a new pass.

## 4. Backend validation checklist (what `poll` does before anything is armed)

The guide: "ID token: Validate signature, issuer, audience, expiry, and required auth_time, acr, and amr. Device
tokens omit nonce, even if one was sent; accept its absence for this profile." and "Atomically bind (iss, sub) to the
intended application session or grant before authorizing access."

| Check | Implementation (`verifyIdToken`, `AgentPass.poll`) |
|---|---|
| Compact JWT, header `alg` **RS256** only | `none` / HMAC never verify (`alg` failure) |
| Signature | `crypto.verify('sha256', …)` with the JWKS key for the header `kid` (any key if none); an unknown `kid` refetches the JWKS once (rotation-safe); still unknown → rejected |
| `iss` | equals `WORLD_AGENT_PASS_ISSUER` exactly (discovery `issuer` must match it too) |
| `aud` | contains `WORLD_AGENT_PASS_CLIENT_ID` |
| `exp` / `iat` | `exp` not past (60 s tolerance); `iat` not in the future |
| `nonce` | absent is accepted (device profile); present must equal the attempt's stored nonce |
| `acr` | in `WORLD_AGENT_PASS_ACR` (default orb, selfie) — "require its acr to match one of your saved acceptable values exactly" |
| `auth_time` | present; not in the future; `now − auth_time ≤ WORLD_AGENT_PASS_MAX_AGE_S` (default 300 s) |
| One use | `jti` (else sha256 of the token) stored as consumed until `exp`; a second presentation is `invalid_pass` ("Retry a consumed code… cannot be redeemed again") |
| Approver binding | the policy keeps its first `(iss, sub)`; another World ID is `invalid_pass` ("If the account already has a linked World ID, require the validated (iss, sub) to match") |
| Atomic arm | consumed + approver + grant are written in one synchronous block (no `await` between), to `deps.state` — the sealed `STATE_FILE` in live, so a restart keeps the grant (tested) |
| Nothing client-side counts | the agent and the PWA only ever receive `state`; a crafted "approved" from a client has no path to the guard |
| Secrets | `client_secret` / private JWK are `Secret`-wrapped (print `[redacted]`); the device code is stored sealed and never returned, logged or sent to the model; failed World calls log status and reason only |

Freshness note: `max_age`/`prompt` are documented as **not** request controls for the device grant ("Fresh
authentication is required regardless"), so the freshness policy is enforced on `auth_time` here, not requested.

## 5. Environment

| Variable | Meaning | Default |
|---|---|---|
| `WORLD_AGENT_PASS_ISSUER` | OIDC issuer (discovery is read from it) | `https://auth.world.org` |
| `WORLD_AGENT_PASS_CLIENT_ID` | portal client id; **unset = feature off**; `simulated` = local simulator (refused in live) | — |
| `WORLD_AGENT_PASS_CLIENT_SECRET` | `client_secret_post` secret (starts `worldidp_client_secret_`); server only | — |
| `WORLD_AGENT_PASS_PRIVATE_KEY_JWK` | private RSA JWK (JSON) for `private_key_jwt`; used instead of the secret when set | — |
| `WORLD_AGENT_PASS_MAX_AGE_S` | max age of `auth_time` at validation | `300` |
| `WORLD_AGENT_PASS_VALID_S` | how long an accepted pass arms the policy (from `auth_time`) | `86400` |
| `WORLD_AGENT_PASS_ACR` | accepted `acr` values, csv (essential claims request + backend check) | orb, selfie |

Live refuses `simulated`, requires a secret or JWK when a client id is set, and requires an `https` issuer. The agent
needs no World configuration: it talks only to the API.

### Local simulator and e2e

`MODE=local` + `WORLD_AGENT_PASS_CLIENT_ID=simulated` wires `LocalIdp`: the same four endpoints behind an in-process
fetch, a generated 2048-bit RSA key in its JWKS, ID tokens with `simulated: true`, issuer
`https://agent-pass.simulated.invalid`; every view carries `simulated: true`. The exact same client and validation
code runs against it. Controls (local-only routes): `POST /__local/agent-pass {"outcome":"approve"|"deny"|"expire"|"pending"}`
scripts the next attempt; `GET /__local/agent-pass/<user_code>?outcome=approve|deny` is the "phone page" the QR opens.
`scripts/e2e-local.sh` runs I-21: deny → `denied` + `403`, expire → `expired` + `403`, then scripts approve so the
I-10 agent pass hits `403`, runs the checkpoint, is approved at its first poll and buys once.

## 6. Registration — the human step (portal: https://auth.world.org/portal)

The portal needs a Google sign-in; OIDC dynamic client registration is not supported ("World ID authentication with
openid requires a client registered through the portal").

1. Register the application. Name: **Recharge agent**. Client authentication: **`client_secret_post`** (the method is
   fixed for the client's lifetime; the portal default is `client_secret_basic`).
2. Callback URL: `https://<domain>/agent/pass/callback` — a placeholder only. The app-registration guide: "Device-only
   clients also need a registered redirect URI, although the device grant does not use it." HTTPS, exact match.
3. Accepted accounts: Orb and Selfie Check (the essential `acr` request lists both anyway).
4. Copy the client id and the secret (shown once) into the live env as `WORLD_AGENT_PASS_CLIENT_ID` /
   `WORLD_AGENT_PASS_CLIENT_SECRET`; restart the API. Nothing else changes; the first agent buy will pause for the pass.
5. For the sandbox instead: register at the sandbox portal, set `WORLD_AGENT_PASS_ISSUER=https://sandbox.auth.world.org`.
   Sandbox identities are fake ("Proofs are using fake identities, DO NOT rely on them for production").

## 7. Integration feedback (friction and documentation gaps we actually hit)

1. **`nonce` cannot bind a device-grant result.** The oidc guide says device tokens omit `nonce` even when one was
   sent, while the step-up guide's whole binding procedure ("validate the ID token, including its nonce") assumes it.
   For headless agents the only binding left is the private device code plus `(iss, sub)`. This deserves a sentence in
   the step-up / Human-checkpoints section rather than one table row in the device profile.
2. **`acr` values disagree between discovery and the guides.** Discovery advertises only `orb` and `orb-face`; the
   step-up guide documents `selfie` and `selfie-face` as accepted essential values ("Accept Orb or Selfie Check"). It
   is unclear whether an essential request naming `selfie` fails with `unmet_authentication_requirements` or just
   never matches. We ship the guide's pair as the default and made it configurable (`WORLD_AGENT_PASS_ACR`).
3. **No device-grant example carries `claims`.** The device profile says essential `acr` is "supported through
   claims; see Face Auth", but the only full device requests shown are `scope=openid` with client auth. Combined with
   "Unknown parameters: ignored when supplied once… A successful initiation does not mean an extension was understood"
   there is no way to know a `claims` request was honoured until the token arrives — so the backend `acr` check is
   load-bearing, not a belt. One worked device example with `claims` would remove the guesswork.
4. **Freshness for the device grant is unspecified.** `max_age`/`prompt` "do not provide request controls for this
   grant. Fresh authentication is required regardless" — but how fresh, and whether a passkey on an existing session
   counts, is not stated. We enforce `auth_time` ourselves; a stated bound would let RPs pick `MAX_AGE_S` sensibly.
5. **`binding_message` / action terms are unsupported**: the human sees only the requester name and the user code on
   World's page, never "buy 100 MB for $0.40". We show the action next to the QR in our PWA, but a signed
   action-approval would be the real fix (the docs acknowledge this: "keep the operation blocked until you validate one
   through a profile that advertises support for it" — no such profile is advertised today).
6. **A redirect URI is mandatory for device-only clients.** It is documented, but a form field that is never used
   invites a fake value; "none (device only)" in the portal would be cleaner.
7. **Sandbox access is not self-serve.** The sandbox World ID app is TestFlight-by-contact and identities take about an
   hour to issue. The OAuth Playground is helpful for seeing a token, but there is no downloadable signed test vector
   (ID token + JWKS) although the testing guide recommends "local signed fixtures". We wrote our own (`LocalIdp`);
   a published vector set would let every RP test validation failures the same way.
8. **Rate limits are shaped but not sized.** "A limited start returns HTTP 429 with Retry-After: 60" is clear; the
   per-client start/poll numbers are not, so we added a 30 s start de-duplication and +5 s on `slow_down` blind.
9. **Environments differ in discovery.** The sandbox lists `refresh_token` and token-exchange grants production does
   not; a line in "Sandbox and testing" naming the deltas would save a diff.
10. **What worked well**: discovery is complete and accurate (endpoints, methods, algorithms, claims); the poll
    response table is exactly what a client needs; the secret prefix `worldidp_client_secret_` is a good idea; the
    "Check failure paths" table in the testing guide maps one-to-one onto our test names.
11. **Time to first success.** Discovery fetched from `auth.world.org` on Thu 5 Nov 2026 at about 19:00 IST
    (`fixtures/world/agent-pass-discovery.json`, `recordedAt` 13:30 UTC); the integration, with e2e I-21 (deny → 403,
    expire → 403, approve → the agent buys once), committed at 19:49 IST (`8c71246`): **about 50 minutes from the discovery fetch, against the
    local `LocalIdp` simulator**, not the real IdP. Against `auth.world.org` there is **no success yet**: the portal's
    Google sign-in answered `{error: invalid_login}` for the founder that evening, and a later attempt returned
    `account_not_eligible`, so no client id exists and live runs with the pass off (§1, §6).
12. **The one improvement with the greatest impact: self-serve client registration for the sandbox** (item 7). Every
    other item above cost us a config flag or a defensive check; this one is the only thing between a finished,
    tested integration and a live run. A sandbox portal that registers a device-only client without an eligible
    production account (or a published signed ID-token + JWKS vector set, so RPs can at least prove their validation
    offline) would have turned the simulator run into a real one the same evening.

## 8. Known limits of this integration

- An agent that strips its `X-Agent-Uaid` header **and** pays from a wallet outside `AGENT_PAYERS` (or over Hedera,
  where the payer is unknown before settlement) is treated as a human top-up and is not gated. That agent is also
  outside the policy's spend accounting, so it is misbehaving against its own owner, not escaping a security boundary.
- One pass per policy at a time; a second `start` within 30 s returns the pending attempt rather than a new code.
- The simulator's "phone page" is a `GET` with a side effect — local-only, loopback-only by `MODE=local`.
