# footage/ — where the real captures go

Drop conformed captures here under the exact names below. `scripts/render.sh` (and `pnpm studio`) index this folder and `screen/`; for every shot a composition uses, in order: the human capture when it is present, else the headless capture of the same route in `screen/` (below), else a clearly labelled **PLACEHOLDER · REAL capture missing** slate, so a render never fails for want of footage. Nothing in this folder except this README is committed (`.gitignore`).

Conform every camera file first (HEVC/VFR/HDR → H.264 CFR 30 SDR):

```sh
pnpm --filter @ethglobal/video conform IMG_0412.MOV 01-arrivals.mp4 ots     # camera phone, keeps room audio
pnpm --filter @ethglobal/video conform RPReplay_Final.mp4 01-screen.mp4 sr     # phone screen recording, no audio
pnpm --filter @ethglobal/video conform capture.mov judge-402-curl.mp4 sc        # laptop screen capture, 1920 × 1080
bash apps/video/scripts/conform.sh --audio room.m4a 01-room.wav                 # continuous room track / narration
```

Room sound: when `NN-room.wav` exists it runs under the whole short and every clip is muted; otherwise each OTS/macro clip plays its own camera-phone audio and screen recordings stay silent. Screen recordings are always captured with **Microphone off**.

Path note: SCRIPTS.md §2–§5 "Aftercare" says `apps/video/public/capture/NN/`; the pipeline reads this folder instead (served to the bundle as `public/footage/` through a symlink). Keep writing `notes.md` per video here (`NN-notes.md`) with the HashScan URL, the Arkiv entity key, the HCS sequence and the times; they replace the placeholder values in `src/seed/index.ts`.

## Headless captures of the real PWA (`screen/`)

`scripts/capture-screens.mjs` drives the production build of `apps/web` against the local stack with Playwright (Chromium, 360 × 780 CSS px, device scale 3, `isMobile`/`hasTouch`, iPhone UA; light and dark) and records each route from Chrome's screencast at 1080 × 2340 device pixels into `screen/<clip>-<theme>.webm`; `scripts/conform-screens.sh` runs each through `conform.sh` (`sr`; `sc` for the laptop-viewport clip) to `screen/<clip>-<theme>.mp4` and re-indexes. They replace every RENDERED look-alike (IssuingSequence, ReceiptThreeLine, BoardingPassCard, CouponScreen) and stand in for each subject-phone screen recording until the real one exists. Everything on them is a local-stack value (Anvil 31337, simulated World ID, demo wallet, simulated usage — all labelled by the product itself), so frames that show hashes, keys, addresses or PINs carry **SEED DATA · not a real record** until `src/seed/saturday.json` says `"provenance": "rehearsal"`.

```sh
bash scripts/e2e-local.sh --keep &                 # Anvil :8546, API :8788, demo seed
(cd apps/web && bash e2e/serve.sh) &               # production build on :3000, demo wallet on
node apps/video/scripts/capture-screens.mjs        # every clip, light + dark (≈ 10 min); --only plan,pay --themes light
bash apps/video/scripts/conform-screens.sh         # webm → CFR 30 mp4 + footage/index.json
```

| Clip              | Route            | Seed label | What                                                                                |
| ----------------- | ---------------- | ---------- | ----------------------------------------------------------------------------------- |
| `landing`         | `/`              | no         | Live coupon and both paths; tap Prove I'm human → the /verify sheet                 |
| `landing-pay`     | `/`              | no         | Tap I'll pay · $0.40 per 100 MB → the 402 Review sheet                              |
| `verify`          | `/verify`        | yes        | Simulated World ID → Checking → bundle issued, IssuingRows, the lock-screen line    |
| `plan`            | `/plan/[key]`    | yes        | Meter, usage as of, Expires in, Why it expires by itself opened to the Arkiv key    |
| `install-ios`     | `/install`       | no         | iOS 17.4+ universal link state, Didn't open? Tap again, the steps                   |
| `install-android` | `/install`       | no         | Android: Copy activation code → Copied, the Settings steps                          |
| `pay`             | `/pay?key=`      | yes        | Review → demo wallet signs → Sending · hash → Confirmed → Final (the 8-state sheet) |
| `plan-topped`     | `/plan/[key]`    | yes        | After the top-up: the meter extended once, 400 MB                                   |
| `agent`           | `/agent`         | yes        | Policy sentence, cap ≤ $5 → Saved · signed, back to ≤ $10 / day → Saved             |
| `gift`            | `/gift`          | yes        | rahul.eth resolves, 1 GB, the reclaim rule, Pay → the boarding pass                 |
| `gift-claim`      | `/gift/claim`    | yes        | Recipient (demo wallet · Anvil #9) claims by signature, no payment → /plan          |
| `card`            | `/card/[serial]` | yes        | Hindi UI: PIN typed, latex scratched to ≈ 45 %, the rest fades, Redeem → /plan      |
| `sponsor`         | `/sponsor/[id]`  | yes        | Claims, tables, slide-to-confirm pause → Paused, then Resume claims                 |
| `sponsor-desktop` | `/sponsor/[id]`  | yes        | Laptop viewport (1200 × 900, light only) for the judge video's evidence pane        |
| `receipts`        | `/receipts`      | yes        | Per-day three-line receipts: the claim, the top-up, the gift                        |

Still camera-only (slates until shot): the arrivals hall and its status bar (01 S1), No Service → LTE with the carrier and the push (01 S6), World App's own sheet and the iOS cellular sheet (01 S3/S5, the headless clips show the product's side), the macro scratch, card front and back (02 S1, S2, S5), the 03:12 tabletop and the HashScan pages (03 S1, S3), the rickshaw and the receiver's push (04 S1, S4), and every judge-video SC row (logs, curl, HashScan, DataDrop, Arkiv explorer, nonce, docs) plus the narration.

## Files

| File                       | Video | Kind  | What                                                                       |
| -------------------------- | ----- | ----- | -------------------------------------------------------------------------- |
| `01-arrivals.mp4`          | 01    | OTS   | BOM T2 arrivals hall, phone at chest height, status bar No Service / SOS   |
| `01-screen.mp4`            | 01    | SR    | Subject phone screen recording: / → /verify → World App → /plan → /install |
| `01-lte.mp4`               | 01    | OTS   | Status bar Searching… → LTE, Control Center carrier, the push              |
| `01-room.wav`              | 01    | audio | Camera-phone room track, continuous                                        |
| `02-macro.mp4`             | 02    | macro | Top-down macro: coin on latex, PIN emerges                                 |
| `02-front.mp4`             | 02    | macro | Whole card front on dark wood or canteen steel                             |
| `02-card-sr.mp4`           | 02    | SR    | QR scan → /card/<serial>, digital scratch, Redeem                          |
| `02-plan-sr.mp4`           | 02    | SR    | /plan/[key] odometer, meter, Why it expires by itself                      |
| `02-back.mp4`              | 02    | macro | Card back, receipt lines, pen writes a .eth name                           |
| `03-table.mp4`             | 03    | OTS   | Dark tabletop, phone wakes at 03:12 with the push                          |
| `03-agent-sr.mp4`          | 03    | SR    | /agent sheet: ≤ $10 / day, Pause, policy sentence, 03:12 row               |
| `03-hashscan-sr.mp4`       | 03    | SR    | HashScan testnet transaction, then the HCS topic message                   |
| `03-plan-sr.mp4`           | 03    | SR    | /plan/[key] meter extends, 400 MB total, usage as of 03:12                 |
| `03-room.wav`              | 03    | audio | Room hum and the real notification tone                                    |
| `04-rickshaw.mp4`          | 04    | OTS   | Auto-rickshaw at night, /gift resolving priya.eth                          |
| `04-gift-sr.mp4`           | 04    | SR    | /gift → /pay: sizes, Review, Pay, Sending, Final                           |
| `04-receiver.mp4`          | 04    | OTS   | Receiver phone: push, claim with no payment, /plan reads 1 GB              |
| `judge-founder-take.wav`   | judge | audio | Founder narration, phone mic, one take, 48 kHz                             |
| `judge-verify-sr.mp4`      | judge | SR    | /verify → World App (non-team Orb human) → Checking · 2 s                  |
| `judge-verify-log.mp4`     | judge | SC    | API log line POST …/api/v2/verify/<app_id> action=recharge-welcome         |
| `judge-claim-hashscan.mp4` | judge | SC    | HashScan testnet DataDrop.claim tx with the Claimed event                  |
| `judge-402-curl.mp4`       | judge | SC    | Terminal: curl /esim/topup → HTTP/1.1 402 + decoded PAYMENT-REQUIRED       |
| `judge-pay-sr.mp4`         | judge | SR    | Judge's phone /pay on Hedera: Add 100 MB → Final, strip visible            |
| `judge-pay-hashscan.mp4`   | judge | SC    | HashScan testnet transaction of the human payment                          |
| `judge-datadrop.mp4`       | judge | SC    | DataDrop on Hedera EVM chain 296, Claimed events                           |
| `judge-agent-log.mp4`      | judge | SC    | services/agent log and the HashScan topic page with the HCS-14 UAID        |
| `judge-arkiv-explorer.mp4` | judge | SC    | Arkiv rabdi explorer page for the entitlement entity                       |
| `judge-plan-sr.mp4`        | judge | SR    | /plan Expires in 6 d 22 h and the entity-key disclosure                    |
| `judge-nonce.mp4`          | judge | SC    | 120-second challenge-nonce entity queried before and after expiry          |
| `judge-sponsor.mp4`        | judge | SC    | /sponsor/[id] with 38 plans expire in 24 h as a query                      |
| `judge-docs.mp4`           | judge | SC    | docs/arkiv.schema.json, docs/ARKIV_FEEDBACK.md, docs/SWARM.md              |

## Capture checklists (copied verbatim from marketing/videos/SCRIPTS.md)

### Video 01 — "No Service → LTE"

- **When / where.** Fri 6 Nov 16:00–18:30 IST, after the 06:00 gate has passed (live rails real); backup Sat 7 Nov 06:30–08:30 before the 09:00 rehearsal. BOM Terminal 2, the public meeters-and-greeters arrivals hall (outside customs) or the arrivals exit under the T2 canopy. Phone only, no tripod, no lights, no crew; never point a camera at immigration, customs, security or CISF posts; stop if asked. Subject: a teammate landing with a foreign SIM, or a consenting attendee from the Telegram welcome campaign (hands and phone only if they prefer).
- **Camera phone.** iPhone 15/16 Pro or Pixel 8/9 Pro. 4K, 30 fps, portrait, orientation locked. SDR: HDR Video off (iPhone: Settings → Camera → Record Video → HDR Video off), no Cinematic, no enhanced stabilisation (it crops). Blackmagic Camera (free) or the native app with AE/AF lock: shutter 1/60, ISO locked, white balance locked ≈ 4300 K for T2's daylight-plus-LED mix. Expose for the phone screen (screen at ~70 % fixed), let the hall fall where it falls. 2× lens for S1 and S6, both hands, elbows in. **Keep rolling for the whole session** so the room track is continuous under the screen recordings.
- **Subject phone.** iPhone on iOS 17.4+ (the Apple universal link). Recharge PWA added to the Home Screen (so the push exists). Focus mode allowing only Recharge and World App. Brightness fixed ~70 %, auto-brightness off, True Tone off, Night Shift off. Battery ≥ 50 % (no yellow battery). Ringer on, volume ~70 %. Home SIM present with Data Roaming off so the status bar truthfully reads **No Service** or **SOS**; **never Airplane Mode** — the airplane glyph is a tell. World App installed with an Orb-verified ID (for the judge video, a non-team human).
- **Screen recording on the subject phone.** Control Center → Screen Recording, **Microphone off** (room sound comes from the camera phone). Start before tapping **Prove I'm human**, stop after the pill reads **LTE · Jio**. It records at native resolution with a variable frame rate; §8 conforms it to 30 fps.
- **Must be visible.** S1: the status word and the clock. S2: the live sponsor-bundles line or no line. S3: World App's real sheet. S4: the HashScan hash row, the Arkiv `ent:…` row, **usage as of HH:MM**, the **Expires in … IST** line. S5: the system cellular sheet. S6: **LTE**/**5G**, the carrier name in Control Center, the push text, and the clock on both sides of any cut.
- **Sound to capture.** The hall; the push tone; the cellular-plan notification tone. Nothing added later.
- **Aftercare.** Upload the OTS take and the screen recording to `apps/video/public/capture/01/` within the hour; write the HashScan URL, the Arkiv entity key and the attach time into `capture/01/notes.md` (they feed the README timestamps and the fallback seed).

### Video 02 — "Scratch"

- **When / where.** Cards print Thu 5 Nov 09:00 (Dhanteras printers; proof checked Wed 19:00 against `oklch(0.52 0.085 195)`). Shoot Sat 7 Nov 12:00–14:00 at the venue by a window, or Fri evening with one LED panel. Test-scratch one card first: the ink under the latex must be dry and legible and the latex must be real rub-off latex, not a sticker.
- **Props.** A ₹1 coin (the ₹ symbol coin) or a ₹5 coin — the ₹5 is heavier and scrapes lower; choose by ear. A dark-wood or canteen-steel table, never a white sweep. A ballpoint for S5.
- **Camera phone.** iPhone Pro in macro mode (or a ₹300 clip-on macro lens on the 1× for less distortion), 4K 30 fps, portrait locked, SDR, AE/AF **locked** (macro hunts), white balance locked. Light: one source at 45° raking from the left to catch flakes and grain; a white card as bounce on the right; no ring light. Top-down, phone parallel to the table.
- **Sound.** A lav or USB-C mic 5–10 cm from the card, or the camera phone's own mic at macro distance. Fans and AC off for the three takes. Three takes of S1 on three cards; keep the best scrape.
- **Serial discipline.** Record the serial of the scratched card; S3 opens `/card/<that serial>` so the paper and the digital object match; the PIN is then redeemed and burned.
- **Screen recording.** Microphone off; `lang="hi"` toggled on for S3 only; the `TESTNET` strip is not expected here (no money moves on redeem).
- **Must be visible.** S1: the printed **rub here · यहाँ रगड़ें** before it is scraped, the 16 digits in 4 × 4. S2: **300 MB**, **because you're human / क्योंकि आप इंसान हैं**, the QR, **Expires 30 Nov 2026**. S3: the same serial in the URL bar or header, the latex in Hindi, **Redeem**. S4: **usage as of**, the **Expires in … IST** line, the entity key. S5: the three receipt lines and the `.eth` write-in.

### Video 03 — "Your agent paid while you slept"

- **The trigger must be real.** Plan expiry or the real usage webhook crossing 20 % remaining (`TopUpPolicy { maxUsdPerDay: 10, thresholdMb: 60, stepMb: 100, paused: false, topUpOnExpiry: true }`); the agent is the Hedera Agent Kit wallet with its HCS-14 UAID, funded with test USDC. Schedule the capture for when it fires — Sat 7 Nov ≈ 03:00 (the team is awake) or Fri night. If usage is simulated because the reseller API lags, the `/plan` meter must show **simulated usage** and S4's caption changes as above. No exceptions, no edits to the clock.
- **Camera phone.** On a folded jacket or a ₹200 mini-tripod at table height, 1× lens, 4K 30 fps, portrait, SDR, exposure locked for the lit screen (the room going black is intended; grain is fine, no denoise), white balance locked ≈ 3200 K. Roll from one minute before the expected fire.
- **Subject phone.** PWA on the Home Screen; notifications allowed for Recharge only; ringer on at ~60 %; brightness fixed; lock-screen wallpaper a plain dark photo so the push text reads.
- **Screen recordings** (Microphone off) of `/agent`, the HashScan transaction and topic pages, `/plan`.
- **Must be visible.** S1: the push text and **03:12**. S2: the strip, the policy sentence, the row with `uaid:hcs-14:`, the cap and Pause. S3: HashScan's **testnet** header, the amount **0.40**, the consensus timestamp, the topic message body. S4: **usage as of 03:12** or **simulated usage**, **400 MB total**.
- **Aftercare.** HashScan transaction URL, topic URL, sequence number and the entitlement key into `capture/03/notes.md`; they seed `ReceiptThreeLine` and the README's Hedera section.

### Video 04 — "Gift to a name"

- **People.** Two teammates with real ENS names resolving to their own addresses on mainnet (`EnsResolver` reads mainnet). No celebrity names. Driver's face never in frame; ask before filming in the rickshaw.
- **When.** Fri 6 Nov 21:00–22:00, a 15-minute ride BKC → Bandra; ten minutes of footage is enough. The receiver's capture the same night at the venue so the push time matches.
- **Money.** The gift is paid on testnet (Base Sepolia or Hedera testnet test USDC) and the strip stays in frame; the escrow is the Arkiv entity `gift:<namehash>`; the receiver claims by signature from the resolved address, and the **no payment** line must be on screen.
- **Camera phone.** 1× lens, 4K 30 fps, portrait, SDR, exposure locked for the screen, stabilisation off; hold the phone-in-hand low so streetlight does not flare the screen. Screen recordings with Microphone off.
- **Must be visible.** S1: the resolution line with the address and **Ethereum mainnet**. S2: the strip, the fee line, the hash, **Final**. S4: the push text, the **no payment** claim line, the resulting plan.
- **Before posting.** Fill the unclaimed-gift sentence from `packages/octroi` (**If unclaimed, the USDC returns to you** or **the gift lapses**) — the Farcaster caption carries it and the copy must say what the escrow entity does (`design-references.md` §1f).

### Judge / sponsor video

**Capture notes for the judge video.** Laptop screen captures at 1920 × 1080 with QuickTime or OBS, browser at 125 % zoom, system cursor visible, no cursor highlighting plugin, no mouse-trail; the terminal in a light theme with a 16 pt mono so it reads at 1080p; HashScan and the Arkiv explorer pages captured live, scrolled slowly, URL bar visible so the network (**testnet**) is on screen. The phone material is the same footage as the shorts (one capture, two edits). The human Hedera payment is captured on the judge's phone (screen recording, Microphone off) with a second phone over the shoulder; the judge is named on screen only with consent, otherwise "a judge".
