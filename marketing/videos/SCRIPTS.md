# Recharge — video scripts (ETHGlobal Mumbai 2026)

**Prepared:** Tue 3 Nov 2026, video director. **Binding inputs:** `research/committee/DECISION.md` §8 (the one image, the coupon signature, the three hook moments, the screens) and §4/§6.6/§7.3 (sponsor map, honest mocks, disclosure); `research/design-references.md` (exact UI strings, states, coupon spec, Hindi strings, motion values); `research/design-foundations.md` §1 (ban list) and §7 (voice); `packages/ui/tokens.css`, `fonts.css`, `index.ts` (tokens, motion, `OnchainAction` vocabulary); `research/sponsors.md` and `research/winners.md` §4 (what async partner judges need). Eight web searches on 3 Nov 2026 (§0; sources at the end).

**Deliverables in this file:** four vertical shorts (1080 × 1920, 30 fps, 14–20 s) built on the three hook moments in DECISION §8.6 plus the ENS gift; one judge/sponsor video ≤ 3:00 (1920 × 1080) with a timestamp plan per sponsor; a 10-point anti-slop checklist; a Remotion production plan for `apps/video`; the shoot schedule. Ship order: 01, 03, 02, then 04 if Saturday allows; the judge video is mandatory.

**Owners (DECISION §6.7 roles):** Design/Producer owns capture, edit and render; Product/PWA owns the `*View` components Remotion imports; Provisioning/Agent owns the 03:12 purchase; Founder owns the narration and the sponsor asks; Integrations owns every hash on screen being real.

---

## 0. What the research says, and what we take from it

Eight searches, mostly thin on the named accounts and heavy on vendor blogs; the useful, checkable findings:

1. **Airalo's creator briefs open on the pain, not the product**: roaming bill, lost connectivity, hunting for a SIM vendor at the airport; back camera, not filmed in the TikTok app, "organic, not an ad". A micro-creator campaign reported $0.23 per install ([House of Marketers](https://www.houseofmarketers.com/airalo-tiktok-influencer-case-study/), [creator brief](https://creators.usetwirl.com/project/recFWk9qpaiiGcyxB)). _Take:_ our hook is the pain state on a real device in the real hall; we out-specific them with the actual status bar.
2. **Polymarket's TikTok network got exposed**: the WSJ reviewed 1,105 videos, 778 showed bets, many with fabricated trades and replicated UI; platforms restricted the accounts ([ynetnews](https://www.ynetnews.com/tech-and-digital/article/rjhphn8gfl), [alternativeto](https://alternativeto.net/news/2026/6/polymarket-paid-creators-to-spread-deceptive-betting-videos-report-finds/)). _Take:_ nothing staged as a record. Every number on screen is a real testnet state with a hash, every mock is labelled in-frame, and we never redraw a UI we could screen-record.
3. **Zerodha's Zero1 did 600+ videos and 100M+ views, then wound down over finfluencer regulation**; Kamath admits Instagram is "complex" ([Inc42](https://inc42.com/?p=555876), [Business Today](https://businesstoday.in/amp/latest/trends/story/i-dont-know-if-i-am-too-old-zerodhas-nithin-kamath-finds-instagram-complex-467305-2025-03-09)). _Take:_ no "earn", no returns, no financial-advice framing; plain explanation travelled, hype did not.
4. **The agent-pays narrative travels**: Fireship's "AI agents are paying each other now" at 476K views; x402 explainers of 100–150 s; Coinbase ships an x402 hackathon guide ([rosetta/fireship](https://rosetta.to/u/fireship/ai-agents-are-paying-each-other-now), [CDP guide](https://docs.cdp.coinbase.com/x402/hackathon-guide)). _Take:_ the agent is shown as a receipt with a hash and a cap, never a chatbot.
5. **Hook and caption conventions (directional, unsourced numbers)**: the first 0.5–1.0 s decides; design for muted playback; one line readable in 1–2 s; captions inside the safe zone; shoot three hooks and keep the best ([CapCut](https://www.capcut.com/create/short-form-video-hooks), [Biteable](https://biteable.com/blog/best-practices-short-social-video/), [Opus](https://www.opus.pro/blog/youtube-shorts-caption-subtitle-best-practices)). _Take:_ the cadence spec in §1.
6. **ETHGlobal's own video rules**: 2–4 min (Mumbai: ≤ 3:00), do not speed the video up, do not use music in place of narration, do not record the demo on a phone, ≥ 720p; partner prizes are judged asynchronously from video + README ([ETHGlobal LFGHO](https://ethglobal.com/events/lfgho/info/details), [Cannes](https://ethglobal.com/events/cannes/info/details), [Unite](https://ethglobal.com/events/unite/info/details)). _Take:_ the judge video has a human narration (founder, phone mic, one take), proper screen captures, 1920 × 1080.
7. **Family** is praised for motion that explains where things went; its wallet sends users a generated monthly recap video ([Algo case study](https://algo.tv/family-crypto-wallet)). _Take:_ rendered motion exists only to show a state change (odometer once, meter once), then stops.
8. **Hyperliquid, Phantom, CRED short-form:** no reliable public data found; what is visible of them (Hyperliquid's dark-text-on-accent, Phantom's purple) is already in `design-foundations.md` §8 as borrow or caution. Treated as unknown, not invented.

---

## 1. Conventions that apply to every script

**Frame and time.** 1080 × 1920, 30 fps, constant frame rate. Timecodes read `s.s` and frames `fN`; 1 s = 30 frames. Cuts happen only on a state change (a tap, a hash, LTE, a reveal). No transitions except a hard cut; captions dissolve in 3 frames (100 ms, `--ease-standard`) and out in 3 frames (`--ease-exit`), opacity only. Nothing scales, slides, bounces or types itself.

**Text on screen.** Anek Devanagari for every word (hook line `wdth 100 / wght 700` at 60 px, max two lines; captions `wdth 100 / wght 500` at 48 px, one line); Chivo Mono (`tnum`, `zero`) for hashes, PINs, amounts, times and elapsed-time notes at 36 px. ≤ 6 words a line (Hindi ≤ 5), hold ≥ 27 frames and ≤ 90, `lang="hi"` on Hindi strings with leading 1.6. Two caption styles: **over-footage** = `--bg-canvas` paper-white text with a 1 px, 60 % black shadow; **over-UI** = `--text-primary` on a `--bg-sunken` strip with a `--border-subtle` hairline and 12 px padding, the same object as the product's `TESTNET · test USDC · not a sale` strip. No plates in highlighter colours, no word-by-word "karaoke", no emphasised word in a second colour.

**Safe zones.** Top 250 px and bottom 420 px are platform chrome: nothing load-bearing there. Hook line baseline at y ≈ 440–520. Lower captions at y ≈ 1380–1480. When a phone screen recording fills the frame, never cover its status bar (the top 160 px of the capture): the status bar is the hero.

**Colour.** Rendered frames sit on `--bg-canvas` (warm paper), text `--text-primary`, oxide teal `--accent` at most once per frame (a button or the meter), silver latex only on the coupon. Both themes are allowed; the coupon stays paper-light in dark mode on purpose. Hues 260–300, gradients, glass and glow are banned (CI grep in §8).

**Audio.** 48 kHz stereo. Real room sound runs continuously under every video from the camera phone's track, including under screen recordings (the camera phone keeps rolling during the whole session). Device sounds — the iOS notification tone for the push, the system's own cellular-plan notification, the coin on latex, a pen on 350 gsm paper — are captured through air by the camera phone's mic, never from a library, never foleyed. No music. No voice in the shorts. The judge video has one human voice: founder, phone mic, one take. Loudness −14 LUFS integrated, true peak ≤ −1 dBTP. The end card inherits the room tone for its two seconds, then a 4-frame fade to avoid a click.

**Legend.** **REAL** = captured by the human team on-site (over-the-shoulder footage "OTS", phone screen recording "SR", laptop screen capture "SC"). **RENDERED** = produced by Remotion from the live UI components with a seeded data state (§8). A REAL shot can have a RENDERED fallback; the fallback is used only if the live capture failed, and it is seeded with the real hashes, never invented ones.

**Perimeter (DECISION Q-SEC-Recharge-1, binding).** Zero sales during Devcon week: every money screen carries the `TESTNET · test USDC · not a sale` strip and it stays in frame; no price list anywhere; captions never contain a purchase verb (buy, get yours, order, top up now) or a link to a checkout; the free bundle is described as what it is, a sponsor's gift to arriving non-residents; nothing is addressed to Indian residents; no "for Indians" framing of any tier. Amounts appear only inside receipts and 402 sheets, as the product shows them.

**Honesty rules.** Elapsed time is carried by the status-bar clock on both sides of a cut plus a Chivo Mono note (`01:40 later`), never a time-lapse or a speed ramp. If usage telemetry is simulated the `/plan` meter shows "simulated usage" and the caption says "simulated usage". The sponsor named on screen is whatever the campaign entity says: `from Hedera` if Hedera devrel funds Thursday's testnet campaign, else `from Recharge (demo sponsor)`. Only teammates' real ENS names, and consenting judges, appear; no celebrity name, no `vitalik.eth`. Counts such as "1,214 of 2,000 sponsor bundles left" are shown only when read live, otherwise the shot is dropped. Anyone filmed signs a one-line consent (a chat message is enough); hands-and-phone-only on request.

**Exact UI strings** come from `design-references.md` §1–3 and are quoted verbatim below; the Wednesday attach test screenshots the real iOS and Android sheets and corrects any system string.

---

## 2. Video 01 — "No Service → LTE"

**File** `short-01-no-service.mp4` · **20.0 s / 600 frames** · priority 1 · the hero (DECISION §8.1, §8.6 #1).

**Sound-off / sound-on.** Muted it reads as a status-bar flip with four captions. With sound it is the arrivals hall, then one real notification tone.

### Hook (0.0–1.5 s, f0–f45)

- **Exact frame.** REAL OTS. An iPhone held at chest height in the subject's right hand, screen on, lock screen, status bar top-left reading **No Service** (or **SOS** — whichever is the device's true state; see checklist), the real time top-centre. Behind, soft: BOM Terminal 2's public arrivals hall (the white columns and the exit signage), people with trolleys. Camera at shoulder height, 2× lens (~48 mm equivalent), the phone filling the lower two-thirds of the frame, the hall the upper third. Nothing on screen but the phone and the hall.
- **Exact text.** f8–f60, over-footage, upper third: **`Landed in Mumbai. No Service.`**

### Shot list

| #   | Time      | Frames    | Type                                                         | Picture                                                                                                                                                                                                                                                                                                                                                                                                               | On-screen text                                          | Audio                                                                                          |
| --- | --------- | --------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| S1  | 0.0–2.0   | f0–f60    | REAL OTS                                                     | As the hook. Camera still; the hall moves, the phone does not.                                                                                                                                                                                                                                                                                                                                                        | `Landed in Mumbai. No Service.` (f8–f60)                | Hall: PA tone and announcement, trolley wheels, footsteps. Continuous from f0.                 |
| S2  | 2.0–4.3   | f60–f130  | REAL SR `/`                                                  | The PWA's first screen: H1 **Landing in Mumbai without data?**, the unscratched `Coupon` with **300 MB**, the live line **1,214 of 2,000 sponsor bundles left · Hedera** (drop the line if not live), pre-flight **iPhone · iOS 18 · eSIM ready**. Thumb taps **Prove I'm human → 300 MB**.                                                                                                                           | f90–f130 over-UI: `One free bundle per human`           | Hall continues under (camera-phone track).                                                     |
| S3  | 4.3–8.0   | f130–f240 | REAL SR `/verify` → World App                                | Sheet: **Prove you're one human**; tier ledger **Orb · 300 MB free / Document · 150 MB free / Device · no free bundle · $0.40 per 100 MB**; tap **Open World App**; World App's own verify sheet (real, never redrawn); return; **Checking · 2 s** with the determinate ring.                                                                                                                                         | f135–f190 over-UI: `World App · one human, once`        | Hall continues.                                                                                |
| S4  | 8.0–11.5  | f240–f345 | REAL SR `/plan/[key]` (fallback: RENDERED `IssuingSequence`) | Issuing rows turning tertiary → primary: **Verified** · **Sponsor paid · 0x1a2b…9f3e ↗ HashScan** · **Plan written to Arkiv · ent:7f3a…**; odometer 0 → 300 once; **from Hedera · because you're human**; **usage as of 14:02**; **Expires in 6 d 22 h · Sun 15 Nov 09:12 IST**.                                                                                                                                      | f252–f330 over-UI: `A sponsor paid. Because I'm human.` | Hall continues; the push tone lands here if the PWA is on the Home Screen (real, through air). |
| S5  | 11.5–14.0 | f345–f420 | REAL SR `/install` → iOS Settings                            | Tap **Install eSIM · 2 min**; the Apple universal link opens the system cellular sheet (its real words, screenshotted Wednesday); **Continue**; back to the `/install` pill **Searching…** with the 1 px determinate ring.                                                                                                                                                                                            | f352–f412 over-UI: `No QR. Same phone.`                 | Hall continues.                                                                                |
| S6  | 14.0–18.0 | f420–f540 | REAL OTS                                                     | The phone held up again. Status bar **Searching…** → **LTE** (or **5G**; whatever it says). The thumb swipes Control Center to show the carrier (**Jio** / **Airtel**), then pulls the notification shade: the push **300 MB · from Hedera** / **because you're human. Install takes 2 minutes.** If the attach took longer than the shot, cut S6a (clock 14:02) to S6b (clock 14:04) with the clock visible in both. | Only if cut: f425–f470 Chivo Mono lower: `01:40 later`  | The system's cellular-plan notification tone, real, through air; the hall.                     |
| S7  | 18.0–20.0 | f540–f600 | RENDERED `EndCard`                                           | Paper canvas. One line, Anek 64 px `wdth 110 / wght 700`: **300 MB · because you're human**. Below it the wordmark **Recharge**. Nothing else.                                                                                                                                                                                                                                                                        | —                                                       | Room tone continues; 4-frame fade at f596.                                                     |

### Capture checklist (REAL shots)

- **When / where.** Fri 6 Nov 16:00–18:30 IST, after the 06:00 gate has passed (live rails real); backup Sat 7 Nov 06:30–08:30 before the 09:00 rehearsal. BOM Terminal 2, the public meeters-and-greeters arrivals hall (outside customs) or the arrivals exit under the T2 canopy. Phone only, no tripod, no lights, no crew; never point a camera at immigration, customs, security or CISF posts; stop if asked. Subject: a teammate landing with a foreign SIM, or a consenting attendee from the Telegram welcome campaign (hands and phone only if they prefer).
- **Camera phone.** iPhone 15/16 Pro or Pixel 8/9 Pro. 4K, 30 fps, portrait, orientation locked. SDR: HDR Video off (iPhone: Settings → Camera → Record Video → HDR Video off), no Cinematic, no enhanced stabilisation (it crops). Blackmagic Camera (free) or the native app with AE/AF lock: shutter 1/60, ISO locked, white balance locked ≈ 4300 K for T2's daylight-plus-LED mix. Expose for the phone screen (screen at ~70 % fixed), let the hall fall where it falls. 2× lens for S1 and S6, both hands, elbows in. **Keep rolling for the whole session** so the room track is continuous under the screen recordings.
- **Subject phone.** iPhone on iOS 17.4+ (the Apple universal link). Recharge PWA added to the Home Screen (so the push exists). Focus mode allowing only Recharge and World App. Brightness fixed ~70 %, auto-brightness off, True Tone off, Night Shift off. Battery ≥ 50 % (no yellow battery). Ringer on, volume ~70 %. Home SIM present with Data Roaming off so the status bar truthfully reads **No Service** or **SOS**; **never Airplane Mode** — the airplane glyph is a tell. World App installed with an Orb-verified ID (for the judge video, a non-team human).
- **Screen recording on the subject phone.** Control Center → Screen Recording, **Microphone off** (room sound comes from the camera phone). Start before tapping **Prove I'm human**, stop after the pill reads **LTE · Jio**. It records at native resolution with a variable frame rate; §8 conforms it to 30 fps.
- **Must be visible.** S1: the status word and the clock. S2: the live sponsor-bundles line or no line. S3: World App's real sheet. S4: the HashScan hash row, the Arkiv `ent:…` row, **usage as of HH:MM**, the **Expires in … IST** line. S5: the system cellular sheet. S6: **LTE**/**5G**, the carrier name in Control Center, the push text, and the clock on both sides of any cut.
- **Sound to capture.** The hall; the push tone; the cellular-plan notification tone. Nothing added later.
- **Aftercare.** Upload the OTS take and the screen recording to `apps/video/public/capture/01/` within the hour; write the HashScan URL, the Arkiv entity key and the attach time into `capture/01/notes.md` (they feed the README timestamps and the fallback seed).

### Rendered shots

- `EndCard` — `apps/video/src/compositions/EndCard.tsx`, props `{ line: '300 MB · because you're human', wordmark: 'Recharge', theme: 'light' }`.
- Fallback `IssuingSequence` — `apps/video/src/compositions/IssuingSequence.tsx` renders `PlanView` (`apps/web/components/PlanView.tsx`, the presentational half of `/plan/[key]`) at 360 × 640 CSS px scaled 3×, seeded with `Entitlement { key: '<real ent key>', tier: 'orb', mbTotal: 300, mbUsed: 0, usageAsOf: <real ms>, expiresAt: <real ms from the Arkiv entity> }`, `claimTx: '<real HashScan hash>'`, `sponsorName: '<campaign.name>'`, and the stage timeline `Verified f0 → Sponsor paid f24 → Arkiv f48 → odometer f60–f72 → meter f63–f72`, then static.

### Ending

`300 MB · because you're human` / **Recharge**.

### Captions

- **X (≤ 280):** `Landed in Mumbai with no data. Proved I'm one human. A sponsor paid for my first 300 MB. Fourteen seconds later: LTE. Recharge.`
- **Farcaster (≤ 320 chars; post with the video, no link in the cast body):** `Landed in Mumbai, no data. Proved I'm one human with World ID; a sponsor's pool paid for 300 MB on Hedera; the plan is an Arkiv entity that expires on its own. eSIM installed on the same phone, no QR. Testnet this week. Recharge.`
- **Instagram (hook in the first 125 chars; ≤ 3 hashtags at the end; alt text filled):** `Landed in Mumbai with no data. Proved I'm one human. A sponsor paid for my first 300 MB.` ⏎ `Shot in one session at BOM T2 on a phone. The status bar is real and the clock carries the wait. Testnet, test USDC, not a sale.` ⏎ `#devcon #mumbai #esim` · Alt: `A hand holds a phone in Mumbai airport's arrivals hall; the status bar changes from No Service to LTE and a notification reads 300 MB from Hedera because you're human.`

### Why this can travel

Arrival anxiety is the one travel pain everyone has had, and Airalo's own briefs open on it (§0.1). The before/after is legible in a single frame — a status bar — so it survives muted autoplay. "A sponsor paid because I'm human" is a contestable claim in the World ID discourse, so both camps quote it. In Devcon week ten thousand people are literally arriving; the hall is theirs, and the natural reply is to tag the friend landing tomorrow. The honest clock note invites the "wait, that's real?" reply, which is the thread we want.

---

## 3. Video 02 — "Scratch"

**File** `short-02-scratch.mp4` · **15.0 s / 450 frames** · priority 3 · the signature (DECISION §8.2, §8.6 #2).

**Sound-off / sound-on.** Muted it is a macro reveal of a coupon and four captions. With sound it is ASMR: a coin on latex, paper, a pen.

### Hook (0.0–1.5 s, f0–f45)

- **Exact frame.** REAL macro, top-down. The 34 × 12 mm silver scratch panel fills ~70 % of the frame width, the printed **rub here · यहाँ रगड़ें** (Baloo 2) readable on the latex, warm 350 gsm paper grain visible, a raking light from the left. At f5 a ₹1 coin enters from the right; first contact at f12 (0.4 s); the first stroke clears a 4 mm strip and the digits `4821` start to show.
- **Exact text.** None until f30 (the sound and the object carry the first second). f30–f105, over-footage: **`The 2004 recharge coupon.`**

### Shot list

| #   | Time      | Frames    | Type                     | Picture                                                                                                                                                                                                                                                                 | On-screen text                                          | Audio                                                                                                        |
| --- | --------- | --------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| S1  | 0.0–3.0   | f0–f90    | REAL macro               | Three strokes; flakes of latex; the PIN emerges group by group in Chivo Mono: `4821` `9930` `1127` `5064`.                                                                                                                                                              | `The 2004 recharge coupon.` (f30–f105)                  | Coin on latex, close; paper; no room tone louder than the scrape.                                            |
| S2  | 3.0–5.3   | f90–f160  | REAL top-down, wider     | The whole card front on a dark-wood or canteen-steel table: wordmark; **300 MB**; **Mumbai · 7 days**; **because you're human** / **क्योंकि आप इंसान हैं**; the 22 mm QR; serial; **Expires 30 Nov 2026**.                                                              | f110–f160 over-footage: `Same scratch. Same 16 digits.` | Room (venue hum) at low level.                                                                               |
| S3  | 5.3–8.3   | f160–f250 | REAL SR `/card/<serial>` | The QR is scanned with the phone camera (iOS's own QR chip, real); `/card/<serial>` opens the digital `Coupon` with its canvas latex, UI in `lang="hi"` so the latex reads **यहाँ रगड़ें**; the thumb scratches 1:1; at ≥ 45 % the rest fades; **Redeem** enables; tap. | f170–f240 over-UI: `Now it's 300 MB of Mumbai data`     | Room continues; no scratch sound here — the digital scratch is silent by spec (`design-references.md` §5.3). |
| S4  | 8.3–11.3  | f250–f340 | REAL SR `/plan/[key]`    | Odometer 0 → 300 once; the meter fills once; **usage as of 14:02**; **Expires in 6 d 22 h · Sun 15 Nov 09:12 IST**; the disclosure **Why it expires by itself** opened to show the Arkiv entity key.                                                                    | f262–f332 over-UI: `Expires by itself · Arkiv`          | Room continues.                                                                                              |
| S5  | 11.3–13.3 | f340–f400 | REAL macro               | The card's back: **Bundle 300 MB / Paid by Hedera $0.50 / Network fee $0.00** and **To: ________ .eth — write a name to gift this card, or redeem at /card**. A pen writes a teammate's real name, e.g. `priya.eth`.                                                    | f346–f400 over-footage: `Or write a name. Gift it.`     | Pen on 350 gsm paper, real.                                                                                  |
| S6  | 13.3–15.0 | f400–f450 | RENDERED `EndCard`       | One line: **The recharge coupon is back. 300 MB.** Wordmark **Recharge**.                                                                                                                                                                                               | —                                                       | Room tone, 4-frame fade at f446.                                                                             |

### Capture checklist (REAL shots)

- **When / where.** Cards print Thu 5 Nov 09:00 (Dhanteras printers; proof checked Wed 19:00 against `oklch(0.52 0.085 195)`). Shoot Sat 7 Nov 12:00–14:00 at the venue by a window, or Fri evening with one LED panel. Test-scratch one card first: the ink under the latex must be dry and legible and the latex must be real rub-off latex, not a sticker.
- **Props.** A ₹1 coin (the ₹ symbol coin) or a ₹5 coin — the ₹5 is heavier and scrapes lower; choose by ear. A dark-wood or canteen-steel table, never a white sweep. A ballpoint for S5.
- **Camera phone.** iPhone Pro in macro mode (or a ₹300 clip-on macro lens on the 1× for less distortion), 4K 30 fps, portrait locked, SDR, AE/AF **locked** (macro hunts), white balance locked. Light: one source at 45° raking from the left to catch flakes and grain; a white card as bounce on the right; no ring light. Top-down, phone parallel to the table.
- **Sound.** A lav or USB-C mic 5–10 cm from the card, or the camera phone's own mic at macro distance. Fans and AC off for the three takes. Three takes of S1 on three cards; keep the best scrape.
- **Serial discipline.** Record the serial of the scratched card; S3 opens `/card/<that serial>` so the paper and the digital object match; the PIN is then redeemed and burned.
- **Screen recording.** Microphone off; `lang="hi"` toggled on for S3 only; the `TESTNET` strip is not expected here (no money moves on redeem).
- **Must be visible.** S1: the printed **rub here · यहाँ रगड़ें** before it is scraped, the 16 digits in 4 × 4. S2: **300 MB**, **because you're human / क्योंकि आप इंसान हैं**, the QR, **Expires 30 Nov 2026**. S3: the same serial in the URL bar or header, the latex in Hindi, **Redeem**. S4: **usage as of**, the **Expires in … IST** line, the entity key. S5: the three receipt lines and the `.eth` write-in.

### Rendered shots

- `EndCard` with `line: 'The recharge coupon is back. 300 MB.'`.
- Not rendered on purpose: the scratch. A rendered scratch is exactly the kind of fake this product's object exists to refute. (The judge video may use `CouponScreen` — the `Coupon` component in its `screen` variant seeded with the same serial and PIN — as a still insert, not as a scratch.)

### Ending

`The recharge coupon is back. 300 MB.` / **Recharge**.

### Captions

- **X:** `The 2004 recharge coupon, except it's 300 MB of Mumbai data. Scratch it, redeem it, or write a friend's .eth on the back. It expires on Arkiv by itself. Recharge.`
- **Farcaster:** `We printed the coupon: 350 gsm paper, silver latex, a 16-digit PIN in Chivo Mono with a Verhoeff check digit, Hindi on the panel. Scratch, redeem, or write a name on the back. The balance is an Arkiv entity with expiresIn set to the plan's validity; nothing runs a cron. Recharge.`
- **Instagram:** `The 2004 recharge coupon is back. Except it's 300 MB of Mumbai data and it expires by itself.` ⏎ `Real card, real latex, one-rupee coin. The PIN opens the same screen on the phone.` ⏎ `#devcon #mumbai #recharge` · Alt: `Close-up of a coin scratching silver latex off a paper recharge coupon to reveal a 16-digit PIN; the card reads 300 MB, because you're human, in English and Hindi.`

### Why this can travel

Every Indian over twenty-five has made exactly this motion (Airtel's all-India coupon dates to 2003; the `*123*PIN#` idiom is in `design-references.md` §0), so the nostalgia is physical, not referenced. ASMR rewards sound-on; the object survives sound-off. "They printed it" is a novelty in a category of screenshots, and the Hindi line widens who shares it. The pen writing a name on the back is a tag-a-friend trigger without asking for one.

---

## 4. Video 03 — "Your agent paid while you slept"

**File** `short-03-agent-paid.mp4` · **18.0 s / 540 frames** · priority 2 · the agent-economy hook (DECISION §8.6 #3).

**Sound-off / sound-on.** Muted: a phone lights up at 03:12 and a receipt follows. With sound: one real notification tone in a dark room, then nothing but the room.

### Hook (0.0–1.5 s, f0–f45)

- **Exact frame.** REAL OTS, tabletop. A dark room — the venue's quiet corner, a hostel room — a phone face-up on a table, a half-finished cutting-chai glass beside it, camera at table height 30 cm away on the 1× lens. f0–f5 the frame is almost black (table edge, glass). At f6 the screen wakes and lights the table: lock-screen clock **03:12**, the push **+100 MB · paid by your agent · $0.40 · 03:12**.
- **Exact text.** f14–f44, over-footage, upper third: **`I'm asleep.`** then f46–f90: **`My plan hit 18%.`**

### Shot list

| #   | Time      | Frames    | Type                        | Picture                                                                                                                                                                                                                                                                                                                | On-screen text                                                                                               | Audio                                                            |
| --- | --------- | --------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| S1  | 0.0–3.0   | f0–f90    | REAL OTS tabletop           | As the hook; the screen stays lit; the camera does not move.                                                                                                                                                                                                                                                           | `I'm asleep.` (f14–f44) · `My plan hit 18%.` (f46–f90)                                                       | The phone's notification tone, real, through air; room hum (AC). |
| S2  | 3.0–6.0   | f90–f180  | REAL SR `/agent`            | One sheet, two controls: **≤ $10 / day** stepper, **Pause**; the policy sentence **When your plan drops below 20 % or expires, your agent buys 100 MB for $0.40 on Hedera, up to $10 a day.**; the row **03:12 · +100 MB · $0.40 · agent uaid:hcs-14:… ↗**; the **TESTNET · test USDC · not a sale** strip at the top. | f96–f170 over-UI: `The rule I set: ≤ $10 a day` (amount in Chivo Mono)                                       | Room continues.                                                  |
| S3  | 6.0–10.0  | f180–f300 | REAL SR HashScan            | Tap ↗: HashScan **testnet** transaction — 0.40 USDC from the agent account to `payTo`, SUCCESS, consensus timestamp 03:12:xx; then the HCS topic message: the receipt JSON with `uaid:hcs-14:…`, the entitlement key, `mb: 100`.                                                                                       | f190–f245 over-UI: `Settled on Hedera · 0.40 USDC` · f250–f300: `Receipt on HCS · agent id hcs-14`           | Room continues.                                                  |
| S4  | 10.0–13.0 | f300–f390 | REAL SR `/plan/[key]`       | The meter extends once; **400 MB total**; **usage as of 03:12** (or the **simulated usage** label if the reseller's usage API lagged — then the caption must say so); **Expires in 5 d 06 h · …**.                                                                                                                     | f306–f380 over-UI: `+100 MB · 400 MB total` (numerals Chivo Mono); if simulated: `+100 MB · simulated usage` | Room continues.                                                  |
| S5  | 13.0–16.0 | f390–f480 | RENDERED `ReceiptThreeLine` | Header **+100 MB · Sat 7 Nov 03:12 · Hedera · Final**; three ruled lines **You · $0.40** / **Sponsor · —** / **Network fee · $0.00**; disclosure row: hash · HCS sequence · Arkiv key, all real. Enters once (`translateY 24 → 0`, 260 ms), then still.                                                                | —                                                                                                            | Room continues.                                                  |
| S6  | 16.0–18.0 | f480–f540 | RENDERED `EndCard`          | One line: **My agent bought 100 MB at 03:12.** Wordmark **Recharge**.                                                                                                                                                                                                                                                  | —                                                                                                            | Room tone, 4-frame fade at f536.                                 |

### Capture checklist (REAL shots)

- **The trigger must be real.** Plan expiry or the real usage webhook crossing 20 % remaining (`TopUpPolicy { maxUsdPerDay: 10, thresholdMb: 60, stepMb: 100, paused: false, topUpOnExpiry: true }`); the agent is the Hedera Agent Kit wallet with its HCS-14 UAID, funded with test USDC. Schedule the capture for when it fires — Sat 7 Nov ≈ 03:00 (the team is awake) or Fri night. If usage is simulated because the reseller API lags, the `/plan` meter must show **simulated usage** and S4's caption changes as above. No exceptions, no edits to the clock.
- **Camera phone.** On a folded jacket or a ₹200 mini-tripod at table height, 1× lens, 4K 30 fps, portrait, SDR, exposure locked for the lit screen (the room going black is intended; grain is fine, no denoise), white balance locked ≈ 3200 K. Roll from one minute before the expected fire.
- **Subject phone.** PWA on the Home Screen; notifications allowed for Recharge only; ringer on at ~60 %; brightness fixed; lock-screen wallpaper a plain dark photo so the push text reads.
- **Screen recordings** (Microphone off) of `/agent`, the HashScan transaction and topic pages, `/plan`.
- **Must be visible.** S1: the push text and **03:12**. S2: the strip, the policy sentence, the row with `uaid:hcs-14:`, the cap and Pause. S3: HashScan's **testnet** header, the amount **0.40**, the consensus timestamp, the topic message body. S4: **usage as of 03:12** or **simulated usage**, **400 MB total**.
- **Aftercare.** HashScan transaction URL, topic URL, sequence number and the entitlement key into `capture/03/notes.md`; they seed `ReceiptThreeLine` and the README's Hedera section.

### Rendered shots

- `ReceiptThreeLine` — `apps/video/src/compositions/ReceiptThreeLine.tsx` wraps the receipt row from `apps/web/components/ReceiptsView.tsx`, props `{ mb: 100, at: '2026-11-07T03:12:00+05:30', rail: 'Hedera', state: 'finalized', you: '$0.40', sponsor: '—', fee: '$0.00', hash: '<real>', hcsSequence: <real>, arkivKey: '<real>' }`. State vocabulary from `onchainActionStates` (`finalized` renders **Final**).
- `EndCard` with `line: 'My agent bought 100 MB at 03:12.'`.

### Ending

`My agent bought 100 MB at 03:12.` / **Recharge**.

### Captions

- **X:** `An AI agent bought me 100 MB on Hedera for 40 cents at 03:12 because my plan hit 20%. Cap: $10 a day, pause anytime. Testnet, test USDC, real receipt on HCS. Recharge.`
- **Farcaster:** `At 03:12 my top-up agent — a Hedera Agent Kit wallet with an HCS-14 id — read my plan on Arkiv, saw 18%, paid a 402 with 0.40 test USDC and wrote the receipt to an HCS topic. The policy is code, not a prompt: ≤ $10/day, threshold 20%, pause. Recharge.`
- **Instagram:** `My agent bought me 100 MB at 03:12 while I slept. It is allowed $10 a day. Here is the receipt.` ⏎ `Testnet, test USDC. The time is real, the hash is real, the receipt is on Hedera Consensus Service.` ⏎ `#devcon #hedera #agents` · Alt: `A phone lights up on a dark table at 03:12 with a notification: plus 100 MB, paid by your agent, 40 cents; then a receipt with a transaction hash.`

### Why this can travel

"It spent my money while I slept" is the tension of the quarter, and the visible cap turns it into the agent-permissions argument people want to have; the explainer that carried this idea did 476K views (§0.4). A receipt with a hash at 03:12 is proof, and proof is scarce in a feed that just watched staged wins get exposed (§0.2). Every builder in the x402 scene reposts an agent that is a receipt instead of a chatbot. The three-line receipt is a screenshot.

---

## 5. Video 04 — "Gift to a name"

**File** `short-04-gift-to-name.mp4` · **14.0 s / 420 frames** · priority 4 (ship if Saturday allows) · the ENS clause of the one sentence.

**Sound-off / sound-on.** Muted: a name resolves, a boarding pass, a push. With sound: an auto-rickshaw at night, then the venue.

### Hook (0.0–1.5 s, f0–f45)

- **Exact frame.** REAL OTS. The back seat of an auto-rickshaw at night, the city moving in the open side, the phone in hand showing `/gift` with the field **Who gets it?** and the keyboard up; the sender types `priya.eth`; at f30 the resolution line appears **priya.eth → 0x1a2b…9f3e · Ethereum mainnet**. Handheld; the rickshaw's vibration is the texture.
- **Exact text.** f8–f70, over-footage, upper third: **`My friend lands at 06:40.`**

### Shot list

| #   | Time      | Frames    | Type                        | Picture                                                                                                                                                                                                                                                                                                                    | On-screen text                                        | Audio                                                                |
| --- | --------- | --------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| S1  | 0.0–3.0   | f0–f90    | REAL OTS                    | As the hook.                                                                                                                                                                                                                                                                                                               | `My friend lands at 06:40.` (f8–f70)                  | Rickshaw engine, horns, wind; real.                                  |
| S2  | 3.0–6.7   | f90–f200  | REAL SR `/gift` → `/pay`    | Size row **300 MB · 1 GB · 3 GB** at **$1.20 · $4.00 · $12.00**; button **Gift 1 GB to priya.eth · $4.00**; Review (**Valid … until Sun 15 Nov 09:12**, **Network fee $0.00 — paid by the facilitator**, the **TESTNET** strip); **Pay $4.00 USDC**; **Approve in MetaMask…**; **Sending · 0x1a2b…9f3e · 4 s**; **Final**. | f100–f170 over-UI: `No number. No QR. Just the name.` | Rickshaw continues under.                                            |
| S3  | 6.7–9.7   | f200–f290 | RENDERED `BoardingPassCard` | The `BoardingPass`: landscape card, perforation, 11 px labels **TO priya.eth · FROM rahul.eth · 1 GB · MUMBAI · VALID UNTIL Sun 15 Nov 09:12**; the stub with the PIN 4 × 4 in Chivo Mono and the QR of `/card/<serial>`. Enters once (`translateY 24 → 0`, 260 ms), then still.                                           | —                                                     | Rickshaw continues.                                                  |
| S4  | 9.7–12.3  | f290–f370 | REAL OTS, receiver          | The receiver's phone at the venue: lock screen push **rahul.eth sent you 1 GB**; tap; **Approve in your wallet to claim — no payment**; approve; `/plan` reads **1 GB**.                                                                                                                                                   | f300–f365 over-UI: `Claim with a wallet. Or the PIN.` | Venue room tone (hard cut from the rickshaw on the push tone, real). |
| S5  | 12.3–14.0 | f370–f420 | RENDERED `EndCard`          | One line: **Data, addressed to a name.** Wordmark **Recharge**.                                                                                                                                                                                                                                                            | —                                                     | Room tone, 4-frame fade at f416.                                     |

### Capture checklist (REAL shots)

- **People.** Two teammates with real ENS names resolving to their own addresses on mainnet (`EnsResolver` reads mainnet). No celebrity names. Driver's face never in frame; ask before filming in the rickshaw.
- **When.** Fri 6 Nov 21:00–22:00, a 15-minute ride BKC → Bandra; ten minutes of footage is enough. The receiver's capture the same night at the venue so the push time matches.
- **Money.** The gift is paid on testnet (Base Sepolia or Hedera testnet test USDC) and the strip stays in frame; the escrow is the Arkiv entity `gift:<namehash>`; the receiver claims by signature from the resolved address, and the **no payment** line must be on screen.
- **Camera phone.** 1× lens, 4K 30 fps, portrait, SDR, exposure locked for the screen, stabilisation off; hold the phone-in-hand low so streetlight does not flare the screen. Screen recordings with Microphone off.
- **Must be visible.** S1: the resolution line with the address and **Ethereum mainnet**. S2: the strip, the fee line, the hash, **Final**. S4: the push text, the **no payment** claim line, the resulting plan.
- **Before posting.** Fill the unclaimed-gift sentence from `packages/octroi` (**If unclaimed, the USDC returns to you** or **the gift lapses**) — the Farcaster caption carries it and the copy must say what the escrow entity does (`design-references.md` §1f).

### Rendered shots

- `BoardingPassCard` — `apps/video/src/compositions/BoardingPassCard.tsx` renders `BoardingPass` from `packages/ui`, props `{ to: 'priya.eth', from: 'rahul.eth', size: '1 GB', city: 'MUMBAI', validUntil: 'Sun 15 Nov 09:12', pin: '<real 16 digits>', serial: '<real>', cardUrl: 'https://<host>/card/<serial>' }`.
- `EndCard` with `line: 'Data, addressed to a name.'`.

### Ending

`Data, addressed to a name.` / **Recharge**.

### Captions

- **X:** `Gave a friend 1 GB of Mumbai data before she landed. No number, no QR, just her ENS name. She claims with her wallet, or with the PIN on the stub. Testnet this week. Recharge.`
- **Farcaster:** `Gifting data to an ENS name: resolve → pay a 402 (test USDC) → the escrow is an Arkiv entity keyed by namehash, expiresIn = the claim window → she claims with a signature from the resolved address, or the PIN. If unclaimed, [the USDC returns to you / the gift lapses — from octroi]. Recharge.`
- **Instagram:** `My friend lands at 06:40. I sent 1 GB of Mumbai data to her name before she did.` ⏎ `Her ENS name, a boarding pass with a PIN on the stub, a claim with no payment. Testnet, test USDC.` ⏎ `#devcon #ens #mumbai` · Alt: `In an auto-rickshaw at night a phone resolves the name priya.eth; a boarding-pass card addressed to that name appears; another phone shows the notification rahul.eth sent you 1 GB.`

### Why this can travel

"Send data to a name" is understood in one line and demonstrated in one frame. The reply is a tag ("who lands tomorrow?"), and Devcon week is the one week that question is literally true for thousands. ENS users repost real utility for names, and the boarding pass is a card people save. The rickshaw is the only location footage in the set that is unmistakably Mumbai without being a landmark.

---

## 6. Judge / sponsor video — ≤ 3:00

**File** `judge-recharge.mp4` · **1920 × 1080, 30 fps, target 2:50 (5100 frames), hard ceiling 3:00** · one video serves ETHGlobal, Hedera, World and Arkiv (DECISION §4 "Submission mechanics"). Landscape because judges watch on laptops and ETHGlobal rejects < 720p and asks that the demo not be recorded on a phone; the phone footage sits inside the frame beside its evidence.

**Order (winners.md §4.6 #5, Q-JUDGE-RECHARGE-3):** sensory WOW in the first ten seconds, the one sentence verbatim, the mechanism sentence, then identity → money → entitlement with an on-chain artifact for each, ENS, "what breaks without each", disclosure. No price list; amounts appear only inside a 402 sheet or a receipt.

**Narration.** Founder, phone mic (Voice Memos, 48 kHz, 15 cm from the mouth), one take in a quiet room Sat 7 Nov ≈ 19:00; stumble → restart the take; no splices inside a sentence; room tone kept; no music (ETHGlobal rule and ours). ≈ 330 words. The video is cut to the voice, not the voice to the video.

### Timestamp plan

| Time      | Frames      | On screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Sponsor                         | Narration (verbatim)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | README anchor                                                                                                                                                                                                                                        |
| --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:08 | f0–f240     | REAL: the BOM hero (Video 01 S1 + S6, pillar-boxed at 1080 high, x = 120) with its own room sound; right pane empty paper. Chapter rail (Chivo Mono 12 px) along the top from 0:08: `World 0:30 · Hedera 1:00 · Arkiv 1:50 · ENS 2:25 · Disclosure 2:52`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | —                               | (silence to 0:03) "This phone just landed in Mumbai. No Service."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | —                                                                                                                                                                                                                                                    |
| 0:08–0:20 | f240–f600   | REAL: lock-screen push; the printed card in a hand. Lower third (RENDERED `PathLabel`): the one sentence, set in Anek, revealed as a block, not typed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | —                               | "Recharge: prove you're human and a sponsor pays for your first 300 MB of Mumbai data; after that you — or your agent — pay per 100 MB over x402, every bundle is an Arkiv entity that expires by itself, and anyone can gift data to an ENS name."                                                                                                                                                                                                                                                                                                                                                                                                             | README line 1                                                                                                                                                                                                                                        |
| 0:20–0:30 | f600–f900   | RENDERED `MechanismPanes`: three paper panes **identity · World** → **money · Hedera** → **entitlement · Arkiv**, one line each; a 12 px strip: `Continuity entry · tag v0-prekickoff · in-window work dated in CHANGELOG.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | all                             | "Glassbox402 priced humans and agents differently; Recharge is the gate that proves which is which, and sells them a good people want on day one. Identity is World, money is Hedera, entitlement is Arkiv. We entered Continuity: the scaffold is tagged v0-prekickoff; everything you are about to see was wired in the window."                                                                                                                                                                                                                                                                                                                              | "Continuity disclosure" (§7.3)                                                                                                                                                                                                                       |
| 0:30–1:00 | f900–f1800  | REAL SR: `/verify` → World App (a non-team Orb-verified human) → **Checking · 2 s**. REAL SC: the API log line `POST developer.worldcoin.org/api/v4/verify/<app_id> action=recharge-welcome nullifier=<hashed> level=orb`. RENDERED `TierTable`: **Orb · 300 MB free / Document · 150 MB free / Device · no free bundle · pays the human price**. REAL SC: HashScan testnet — `DataDrop.claim` tx with the **Claimed** event; `PathLabel`: `claimKey = keccak256(campaignId ‖ HMAC(secret, nullifierHash))`.                                                                                                                                                                                                                                                                                                       | **World**                       | "She opens World App. We verify the proof server-side against World's cloud verifier, action recharge-welcome. The credential level is pricing: Orb and Document get a free bundle sized by rule; Device gets no gift and pays the human price. The nullifier is what releases sponsor money: DataDrop.claim on Hedera records an HMAC of it, so the chain never sees the nullifier and nobody can link two campaigns."                                                                                                                                                                                                                                         | "Where World lives in the code": `packages/adapters/src/live/WorldCloudPersonhood.ts`, `packages/octroi/src/quotaKey.ts`, `services/api/src/routes/claim.ts`; app_id, action, hashed-nullifier log                                                   |
| 1:00–1:15 | f1800–f2250 | REAL SC terminal (16 pt mono, light theme): `curl -i "https://<host>/esim/topup?key=<key>&mb=100"` → `HTTP/1.1 402` and the decoded `PAYMENT-REQUIRED` with `accepts[]`: **Base Sepolia · USDC** and **Hedera testnet · USDC**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **Hedera**                      | "The endpoint is live. Ask for 100 MB without paying and you get a 402 with two ways to pay: USDC on Base Sepolia or USDC on Hedera testnet."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | "Where Hedera lives in the code": `services/api/src/routes/esim.ts`; live endpoint URL; facilitator used                                                                                                                                             |
| 1:15–1:30 | f2250–f2700 | REAL SR + OTS: a judge or non-team attendee pays on Hedera from `/pay`: **Add 100 MB · $0.40** → **Pay $0.40 USDC** → **Approve in …** → **Sending · 0x… · 4 s** → **Final**. REAL SC: the HashScan testnet transaction. Strip visible.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **Hedera**                      | "Here a judge pays on Hedera from her own wallet: review, approve, hash in a second, final." (Fallback, said plainly: "Here a team wallet pays on Hedera, tapped by a judge — our own test USDC.")                                                                                                                                                                                                                                                                                                                                                                                                                                                              | human settlement tx                                                                                                                                                                                                                                  |
| 1:30–1:40 | f2700–f3000 | REAL SC: `DataDrop` on Hedera EVM, chain 296 — contract page, the `Claimed` event list, sponsor USDC moving per claim; `PathLabel`: `packages/contracts/src/DataDrop.sol`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **Hedera**                      | "The sponsor pool is a contract on Hedera EVM; every verified claim moves sponsor USDC on Hedera."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `DataDrop` address; `Claimed` tx                                                                                                                                                                                                                     |
| 1:40–1:50 | f3000–f3300 | REAL SC: `services/agent` log — `ledger.get → shouldTopUp{threshold} → GET /esim/topup → 402 → sign (Hedera Agent Kit) → 200 → consensus.submit`; HashScan topic page with the HCS-14 UAID receipt; the `/agent` sheet with **≤ $10 / day · Pause**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **Hedera**                      | "And at 03:12 last night the top-up agent — a Hedera Agent Kit wallet with an HCS-14 identity — read the plan, saw eighteen percent, paid the 402 and wrote the receipt to an HCS topic. The policy is code: ten dollars a day, pause anytime."                                                                                                                                                                                                                                                                                                                                                                                                                 | agent settlement tx; HCS topic id; UAID; `services/agent/`                                                                                                                                                                                           |
| 1:50–2:25 | f3300–f4350 | REAL SC: the Arkiv rabdi explorer page (`rabdi.explorer.arkiv.network`, chain 7794095) for the entitlement entity (`expiresAt`, attributes); RENDERED `ThreeReads` — three lines with file paths: **1 · every `/esim/*` request reads the entitlement → serve or 402** · **2 · the agent's remaining-MB read decides the purchase** · **3 · the gift claim reads the escrow by namehash**; REAL SR: `/plan` **Expires in 6 d 22 h** and the disclosure showing the entity key; REAL SC: a 120-second challenge-nonce entity queried, then queried again after expiry (gone); REAL SC: `/sponsor/[id]` with **38 plans expire in 24 h** as a query; REAL SC: `docs/arkiv.schema.json`, `docs/ARKIV_FEEDBACK.md` (Wednesday's latency table), `docs/SWARM.md` (entity key ↔ Swarm reference of the sealed LPA blob). | **Arkiv** (+ Swarm bonus)       | "Every bundle is an Arkiv entity with expiresIn set to the plan's validity. Three reads decide things: every eSIM request reads the entitlement and serves or returns 402; the agent's read decides whether to buy; a gift claim reads the escrow by namehash. The countdown on the plan is the entity's expiresAt, not a cron. Challenge nonces are entities that live a hundred and twenty seconds, and the check fails closed if the ledger is unreachable. The sponsor's dashboard is a query, not our database. Schema and feedback files are in docs, with Wednesday's measured latency; the sealed eSIM blob sits on Swarm, referenced from the entity." | "Where Arkiv lives in the code": `packages/adapters/src/live/ArkivLedger.ts`, `packages/octroi/src/entitlement.ts`, `services/api/src/routes/me.ts`; entity keys; query strings; `docs/arkiv.schema.json`, `docs/ARKIV_FEEDBACK.md`, `docs/SWARM.md` |
| 2:25–2:40 | f4350–f4800 | REAL SR: `/gift` resolve → pay (strip visible) → RENDERED `BoardingPassCard` → REAL: the receiver's push and the **no payment** claim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **ENS** (integrated, unclaimed) | "Gifting: type a name, pay the 402, the escrow is keyed by namehash, and she claims with a signature from the resolved address — or the PIN on the stub."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | "ENS" section: `packages/adapters/src/live/EnsResolver.ts`, `services/api/src/routes/gift.ts`                                                                                                                                                        |
| 2:40–2:52 | f4800–f5160 | RENDERED `ThreeLines` on paper: **Without World: a $0.34-per-profile sybil farm; no sponsor funds it.** / **Without Hedera: no one-human-one-claim with money behind it; no neutral timestamp.** / **Without Arkiv: Postgres and a cron job; audits only we can run.** Then REAL: the scratch card in a hand, coin on latex, two seconds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | all                             | "Remove World and the free tier is a sybil farm nobody funds. Remove Hedera there is no one-human-one-claim with money behind it, and no neutral timestamp. Remove Arkiv and it's Postgres and a cron job. We also printed it."                                                                                                                                                                                                                                                                                                                                                                                                                                 | "What breaks without each"                                                                                                                                                                                                                           |
| 2:52–3:00 | f5160–f5400 | RENDERED `EndCard` (landscape): the disclosure line in 14 px — `Continuity · v0-prekickoff 5 Nov 20:59 IST · in-window commits by the named team · AI assisted tests, fixtures and docs · keys generated on-site` — the live endpoint URL and the repo in Chivo Mono, and **Recharge**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | all                             | "Recharge. Endpoint, addresses and hashes are in the README, one section per sponsor, with the timestamps you just watched."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | §7.3 text                                                                                                                                                                                                                                            |

**Capture notes for the judge video.** Laptop screen captures at 1920 × 1080 with QuickTime or OBS, browser at 125 % zoom, system cursor visible, no cursor highlighting plugin, no mouse-trail; the terminal in a light theme with a 16 pt mono so it reads at 1080p; HashScan and the Arkiv explorer pages captured live, scrolled slowly, URL bar visible so the network (**testnet**) is on screen. The phone material is the same footage as the shorts (one capture, two edits). The human Hedera payment is captured on the judge's phone (screen recording, Microphone off) with a second phone over the shoulder; the judge is named on screen only with consent, otherwise "a judge".

**README timestamp table (to paste in each sponsor section):** World 0:30–1:00 · Hedera 1:00–1:50 (402 at 1:00, human settlement 1:15, `DataDrop` 1:30, agent + HCS 1:40) · Arkiv 1:50–2:25 (three reads at 1:55, expiry at 2:05, nonce at 2:10, sponsor query at 2:15, schema/feedback/Swarm at 2:20) · ENS 2:25–2:40 · disclosure 2:52.

---

## 7. Anti-slop checklist — ten points, specific to these videos

Fail any one and the cut goes back.

1. **First frame is the problem state on a real device.** A status bar, a dark table, a latex panel. Never a logo, a title card, a "POV:" line, "In today's world", "Imagine", or a face saying "so".
2. **No voice in the shorts; no synthetic voice anywhere.** Room sound and device sounds through air. The judge video's only voice is the founder on a phone mic in one take. No music bed, no sound logo, no whoosh on cuts.
3. **Every number was read from a real state.** HashScan hash, `usage as of HH:MM`, entity key, the clock. Nothing typed into post. A simulated thing says "simulated usage" in-frame and in the caption. A count that is not live is cut, not estimated.
4. **Text is Anek Devanagari and Chivo Mono, nothing else.** ≤ 6 words a line, ≥ 0.9 s hold, 100 ms opacity dissolve. No word-by-word captions, no pop-in scale, no bounce, no emoji, no highlighted keyword, no plate in a highlighter colour.
5. **No b-roll that is not the product in use.** No Gateway of India, no drone over Marine Drive, no stock crowd, no "India" montage, no stock hands on a laptop. Locations are the arrivals hall, a table, a venue corner, a rickshaw seat.
6. **The palette is the product's.** Paper neutrals, oxide teal once per frame, silver latex. No gradient, no hue 260–300, no glass, no glow, no confetti, no "Success!", no green tick after World.
7. **No speed ramps, time-lapses, punch-ins or transition presets.** Hard cuts on state changes; the status-bar clock plus a Chivo Mono note carries elapsed time.
8. **No fabricated people or records.** Teammates' real ENS names, consenting judges, real testnet transactions. No `vitalik.eth`, no staged "win", no redrawn UI where a screen recording exists.
9. **The ending is one line and the name.** No "link in bio", no "follow for more", no arrow to the caption, no subscribe animation, no logo sting, no end-screen grid.
10. **The perimeter holds in every frame and caption.** `TESTNET · test USDC · not a sale` visible on every money screen; no price list; no purchase verb; the free bundle described as a sponsor's gift to arriving non-residents; nothing addressed to Indian residents.

Also enforced by the §8 grep: no `backdrop-filter`, no banned font family, no emoji codepoints, no accent hue outside 195 in `apps/video/src`.

---

## 8. Remotion production plan (`apps/video`)

**Principle.** Rendered shots are the live UI with seeded props, not re-creations. The web routes split into a thin data page and a presentational `*View` component (`PlanView`, `PayView`, `InstallView`, `GiftView`, `AgentView`, `ReceiptsView`, `SponsorTable`) that takes typed props from `packages/octroi`; Remotion imports the Views and `packages/ui` components (`Coupon`, `MbMeter`, `UsageAsOf`, `BoardingPass`, `OnchainAction`) directly. Real captures are composited as video layers under rendered captions. Nothing fetches at render time; seeds are JSON written from the Saturday rehearsal.

### Package

```
apps/video/
  package.json            @ethglobal/video — remotion 4.0.540, @remotion/cli, @remotion/media-utils,
                          @remotion/tailwind-v4 (all 4.0.540); @fontsource-variable/anek-devanagari 5.3.0,
                          @fontsource-variable/chivo-mono 5.3.0, @fontsource/baloo-2 5.3.0;
                          workspace: @ethglobal/ui, @ethglobal/octroi, @ethglobal/web (Views)
  remotion.config.ts      Config.setVideoImageFormat('png'); Config.setOverwriteOutput(true);
                          Config.setBrowserExecutable(process.env.REMOTION_BROWSER ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome');
                          Config.overrideWebpackConfig(enableTailwind)   // @remotion/tailwind-v4
  src/index.ts            registerRoot(Root)
  src/Root.tsx            <Composition> per id below; calculateMetadata per composition
  src/styles/fonts.video.css  local @font-face (see Fonts); same variable names as fonts.css
  src/styles/index.css    @import './fonts.video.css'; @import 'tailwindcss'; @import '@ethglobal/ui/tokens.css'; @import '@ethglobal/ui/tailwind.css';
  src/compositions/       Short01NoService, Short02Scratch, Short03AgentPaid, Short04GiftToName, JudgeVideo
  src/components/         Frame, CaptionTrack, EndCard, IssuingSequence, ReceiptThreeLine, BoardingPassCard,
                          CouponScreen, MechanismPanes, TierTable, ThreeReads, ThreeLines, PathLabel, ChapterRail,
                          PhoneInset, EvidencePane
  public/capture/<01..04>/*.mp4   conformed real footage (never committed; .gitignore; synced from the shoot)
  public/seed/*.json      real hashes, keys, timestamps per shot (committed after the rehearsal)
  public/captions/*.json  caption tracks per composition
  public/fonts/*.woff2    copied from the fontsource packages by `pnpm prepare`
  scripts/conform.sh      ffmpeg conform (below); scripts/post.sh loudnorm + faststart; scripts/check.sh greps
```

### Compositions

| id                  | Size        | fps | Frames                                         | Props (seeded)                                                                                                                    |
| ------------------- | ----------- | --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Short01NoService`  | 1080 × 1920 | 30  | 600 (or `calculateMetadata` from the LTE take) | `captures.{hall,screen,lte}`, `captions`, `seed.entitlement`, `seed.claimTx`, `seed.sponsorName`, `endLine`                       |
| `Short02Scratch`    | 1080 × 1920 | 30  | 450                                            | `captures.{macro,front,card,plan,back}`, `captions`, `seed.serial`, `endLine`                                                     |
| `Short03AgentPaid`  | 1080 × 1920 | 30  | 540                                            | `captures.{table,agent,hashscan,plan}`, `captions`, `seed.receipt{hash,hcsSequence,arkivKey,at}`, `simulated: boolean`, `endLine` |
| `Short04GiftToName` | 1080 × 1920 | 30  | 420                                            | `captures.{rickshaw,gift,receiver}`, `captions`, `seed.pass{to,from,size,validUntil,pin,serial}`, `endLine`                       |
| `JudgeVideo`        | 1920 × 1080 | 30  | 5100 (≤ 5400)                                  | `narration: 'audio/founder-take.wav'`, `chapters[]` (frame offsets), `captures.*`, `seeds.*`, `disclosure`                        |

Every composition wraps its tree in `Frame` (`<div data-type="bazaar" data-theme={theme} lang="en" style={{ width, height, background: 'var(--bg-canvas)', color: 'var(--text-primary)', colorScheme: theme }}>`), so tokens, fonts and `light-dark()` resolve exactly as in the PWA.

### Scaling the UI

Views render at **360 × 640 CSS px** inside a `transform: scale(3)` container, so 1080 × 1920 is an integer multiple of the PWA's narrowest layout and text stays crisp. No bezel, no notch, no device mockup (`design-references.md` §7 #11): a rendered screen is full-bleed, the same way a screen recording is. The judge video's `PhoneInset` places a 9:16 capture at 608 × 1080 with x = 120 on the paper canvas, and `EvidencePane` places a 1200 × 900 capture at x = 720, y = 90.

### Fonts (self-hosted; the sandbox cannot reach Google Fonts)

`@ethglobal/ui/fonts.css` begins with a Google Fonts `@import`; a headless render that cannot fetch it falls back to a system face and nobody notices until the file is posted. The video package therefore does **not** import `fonts.css`. `fonts.video.css` declares the same three variables with local faces:

```css
@font-face {
  font-family: 'Anek Devanagari';
  font-style: normal;
  font-weight: 100 800;
  font-stretch: 75% 125%;
  font-display: block;
  src: url('/fonts/anek-devanagari-devanagari-wdth-normal.woff2') format('woff2');
  unicode-range:
    U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+20A8, U+20B9, U+25CC, U+A830-A839, U+A8E0-A8FF;
}
@font-face {
  font-family: 'Anek Devanagari';
  font-style: normal;
  font-weight: 100 800;
  font-stretch: 75% 125%;
  font-display: block;
  src: url('/fonts/anek-devanagari-latin-wdth-normal.woff2') format('woff2');
  unicode-range:
    U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074,
    U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: 'Chivo Mono';
  font-weight: 100 900;
  font-display: block;
  src: url('/fonts/chivo-mono-latin-wght-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'Baloo 2';
  font-weight: 700;
  font-display: block;
  src: url('/fonts/baloo-2-latin-700-normal.woff2') format('woff2');
}
[data-type='bazaar'] {
  --font-display: 'Anek Devanagari';
  --font-text: 'Anek Devanagari';
  --font-mono: 'Chivo Mono';
}
html {
  font-variant-numeric: tabular-nums;
}
.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums slashed-zero;
}
```

The woff2 files come from `node_modules/@fontsource-variable/anek-devanagari/files/` (the `*-wdth-normal.woff2` per subset carries both axes), `@fontsource-variable/chivo-mono/files/`, `@fontsource/baloo-2/files/`; `pnpm prepare` copies them to `public/fonts/`. The family names stay `'Anek Devanagari'` and `'Chivo Mono'` (fontsource's own CSS registers `… Variable` names, which would miss the ui tokens). `Frame` calls `delayRender('fonts')` and `continueRender` after `document.fonts.load('700 16px "Anek Devanagari"')`, `document.fonts.load('400 16px "Chivo Mono"')` and `document.fonts.ready` resolve, and throws if `document.fonts.check` fails, so a missing face fails the render instead of degrading it. Headlines set `font-variation-settings: 'wdth' 110, 'wght' 700`; body `'wdth' 100, 'wght' 500`; `font-feature-settings: 'tnum', 'zero'` on every number; `lang="hi"` on Hindi spans.

### Captions

`public/captions/<composition>.json`: `[{ "from": 8, "to": 60, "text": "Landed in Mumbai. No Service.", "style": "hook" | "footage" | "ui", "lang": "en" | "hi", "mono": false }]`. `CaptionTrack` maps each entry to a `<Sequence from={from} durationInFrames={to - from}>` whose opacity is `interpolate(frame, [0, 3], [0, 1])` in and `[dur - 3, dur]` out with `Easing.bezier(0.2, 0, 0, 1)` / `Easing.bezier(0.3, 0, 1, 1)` (the token easings); position by style (`hook` y 440, `footage`/`ui` y 1380), x 64, max-width 952. The `ui` style draws the `--bg-sunken` strip with the `--border-subtle` hairline. A lint in `scripts/check.sh` fails a track with > 6 words a line, a hold < 27 frames, an emoji codepoint, or a purchase verb.

### Real footage: conform, then composite

Conform every capture before it enters `public/capture/` (iPhone files are HEVC, variable frame rate, sometimes HDR):

```
# SDR capture, VFR → CFR 30, H.264 for OffthreadVideo
ffmpeg -i IMG_0412.MOV -fps_mode cfr -r 30 -c:v libx264 -crf 16 -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 -c:a aac -b:a 320k -ar 48000 01-hall.mp4
# if HDR Video was accidentally on (Dolby Vision / HLG), tone-map first
ffmpeg -i IMG_0412.MOV -vf "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable,zscale=t=bt709:m=bt709:r=tv,format=yuv420p" -fps_mode cfr -r 30 -c:v libx264 -crf 16 -c:a aac -b:a 320k 01-hall.mp4
# screen recordings: same, plus scale to the frame
ffmpeg -i RPReplay_Final.mp4 -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" -fps_mode cfr -r 30 -c:v libx264 -crf 16 -pix_fmt yuv420p -an 01-screen.mp4
```

In the composition: `<OffthreadVideo src={staticFile('capture/01/01-screen.mp4')} trimBefore={inFrame} trimAfter={outFrame} style={{ width: 1080, height: 1920, objectFit: 'cover' }} />` (Remotion ≥ 4.0.319 names; `startFrom`/`endAt` on older versions). The camera phone's continuous room track is a separate `<Audio src={staticFile('capture/01/01-room.wav')} volume={(f) => interpolate(f, [...], [...])} />` under every shot, so screen recordings never go silent; screen-recording tracks are muted (`muted`) unless they carry an app sound we want. `calculateMetadata` reads `getVideoMetadata(staticFile(...)).durationInSeconds` from `@remotion/media-utils` so Short01's length follows the real LTE take.

### Motion

Only what the product does: the odometer 0 → 300 over 12 frames (`--duration-odometer` 400 ms) once; the meter fill over 9 frames starting 3 frames later, once; sheet/card entry `translateY 24 → 0` + opacity over 8 frames (260 ms) with the standard easing; row colour tertiary → primary over 5 frames. After a change, nothing moves. No `spring()` on anything but a finger-tracked gesture, and nothing here tracks a finger. `prefers-reduced-motion` is irrelevant to a render but the values are the same ones `tokens.css` carries, imported from `motion` in `@ethglobal/ui`.

### Render

```
pnpm --filter @ethglobal/video exec remotion render src/index.ts Short01NoService out/short-01-no-service.mp4 \
  --codec h264 --crf 16 --pixel-format yuv420p --color-space bt709 --audio-codec aac --audio-bitrate 320k \
  --image-format png --concurrency 4 --browser-executable /opt/pw-browsers/chromium-1243/chrome-linux64/chrome
# judge video: --crf 18 --image-format jpeg --jpeg-quality 95 (5100 frames; keep the render under an hour)
# cover frames (the hook frame is the cover on every platform): remotion still ... --frame 8 out/short-01-cover.png
```

Post (`scripts/post.sh`): two-pass `loudnorm` to −14 LUFS / −1 dBTP (`-af loudnorm=I=-14:TP=-1:LRA=11:print_format=json`, then the measured values), `-movflags +faststart`, video stream copied. Expected sizes: shorts 25–40 MB; judge video ≈ 150–250 MB (well under X's 512 MB and ETHGlobal's upload). Delivery: H.264 High, yuv420p, 30 fps CFR, bt709-tagged, AAC-LC 48 kHz 320 kbps; upload the 9:16 file as-is to X, Farcaster (Warpcast transcodes to HLS, so captions are burned in, which they are) and Instagram Reels (set the cover to the hook frame; fill alt text).

### QA before any post

1. Play each short muted on a phone at arm's length: the hook line reads inside one second; every caption is inside the safe zone; the status bar of every screen recording is uncovered.
2. `scripts/check.sh`: the `design-foundations.md` §1 grep over `apps/video/src` (`backdrop-filter`, hue 260–300, Inter/Geist/Poppins/DM Sans, emoji ranges) plus the caption lint.
3. Fonts: the `delayRender` guard passed (no fallback face); spot-check a Devanagari frame and a Chivo Mono zero (slashed).
4. Every hash on screen resolves on HashScan testnet or the Arkiv explorer from `seed/*.json`; every "simulated" shot is labelled in-frame and in the caption.
5. The perimeter: the strip is visible on every money frame; no price list; captions carry no purchase verb; sponsor name matches the campaign entity.
6. Loudness report within ±1 LU of −14; true peak ≤ −1 dBTP; no click at the end card.
7. Judge video: ≤ 3:00, 1920 × 1080, narration intelligible on laptop speakers, every chapter time matches the README table, no speed change anywhere.

### Licence

Remotion's free licence covers individuals and small companies; a five-person hackathon team should confirm the current terms on remotion.dev before the Saturday render, or use the free tier under one teammate's name if that is what the terms allow.

---

## 9. Shoot and render schedule (IST)

| When                  | What                                                                                                                                                | Owner                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Wed 4 Nov 18:00       | Attach gate passes (trigger a) — screenshots of the real iOS and Android cellular sheets go to `capture/system/`; system strings in §2 S5 corrected | Integrations                            |
| Wed 4 Nov 19:00       | Card proof against the teal; copy review signs the Hindi strings                                                                                    | Design/Producer                         |
| Thu 5 Nov 09:00       | Cards printed; one test-scratched                                                                                                                   | Design/Producer                         |
| Fri 6 Nov 06:00       | Gate: live 402 → pay → 200 on Hedera testnet and a `Claimed` event exist; captures may begin                                                        | Integrations                            |
| Fri 6 Nov 16:00–18:30 | Video 01 session at BOM T2 (backup Sat 06:30)                                                                                                       | Producer + a landing teammate           |
| Fri 6 Nov 21:00–22:00 | Video 04 rickshaw + receiver at the venue                                                                                                           | Producer + two teammates with ENS names |
| Sat 7 Nov ≈ 03:00     | Video 03 agent purchase, tabletop capture, screen recordings                                                                                        | Provisioning/Agent + Producer           |
| Sat 7 Nov 09:00–11:00 | Three-device rehearsal → final-design screen recordings for 01–04 and the judge video; human Hedera payment captured                                | Product/PWA + Producer                  |
| Sat 7 Nov 12:00–14:00 | Video 02 macro session                                                                                                                              | Producer                                |
| Sat 7 Nov 14:00–17:00 | `seed/*.json`, `captions/*.json`, conform, first renders of 01–04; QA                                                                               | Producer + Product/PWA                  |
| Sat 7 Nov 18:00       | Partner selection locked → judge video chapter list final                                                                                           | Sponsor lead                            |
| Sat 7 Nov 19:00       | Narration, one take                                                                                                                                 | Founder                                 |
| Sat 7 Nov 19:30–22:30 | Judge video assembly and render; shorts posted as they pass QA (01 and 03 first)                                                                    | Producer                                |
| Sat 7 Nov 23:00       | QA pass on everything; README timestamp table written                                                                                               | Producer + Integrations                 |
| Sun 8 Nov 06:00       | README freeze; video uploaded                                                                                                                       | Producer                                |
| Sun 8 Nov 08:00       | Submit                                                                                                                                              | Founder                                 |

---

## Sources (3 Nov 2026)

- [House of Marketers — Airalo TikTok case study](https://www.houseofmarketers.com/airalo-tiktok-influencer-case-study/) · [Airalo creator brief (Twirl)](https://creators.usetwirl.com/project/recFWk9qpaiiGcyxB) · [Influencer Marketing Factory — Airalo LATAM](https://theinfluencermarketingfactory.com/airalo-latam-influencers/)
- [ynetnews — WSJ on Polymarket's paid creators](https://www.ynetnews.com/tech-and-digital/article/rjhphn8gfl) · [AlternativeTo — Polymarket creators report](https://alternativeto.net/news/2026/6/polymarket-paid-creators-to-spread-deceptive-betting-videos-report-finds/) · [TechBriefly](https://techbriefly.com/2026/06/22/polymarket-accused-paying-influencers-misleading-tiktok-bets/)
- [Inc42 — Zerodha winds down Zero1](https://inc42.com/?p=555876) · [Business Today — Kamath on Instagram](https://businesstoday.in/amp/latest/trends/story/i-dont-know-if-i-am-too-old-zerodhas-nithin-kamath-finds-instagram-complex-467305-2025-03-09) · [Entrepreneur — Meta on financial products in India](https://www.entrepreneur.com/en-in/news-and-trends/meta-platforms-reshape-financial-product-buying-in-india/495648)
- [Fireship — AI agents are paying each other now (summary)](https://rosetta.to/u/fireship/ai-agents-are-paying-each-other-now) · [Coinbase CDP — x402 hackathon guide](https://docs.cdp.coinbase.com/x402/hackathon-guide) · [Nader Dabit thread](https://threadreaderapp.com/thread/1982483131979735078.html)
- [CapCut — hook formulas](https://www.capcut.com/create/short-form-video-hooks) · [Biteable — short social video practices](https://biteable.com/blog/best-practices-short-social-video/) · [Opus — Shorts captions 2026](https://www.opus.pro/blog/youtube-shorts-caption-subtitle-best-practices) · [Cursa — hook engineering](https://cursa.app/en/page/hook-engineering-in-the-first-second)
- [ETHGlobal LFGHO details](https://ethglobal.com/events/lfgho/info/details) · [ETHGlobal Cannes details](https://ethglobal.com/events/cannes/info/details) · [ETHGlobal Unite details](https://ethglobal.com/events/unite/info/details) · [ETHGlobal Superhack details](https://ethglobal.com/events/superhack/info/details)
- [Algo — Family wallet recap video](https://algo.tv/family-crypto-wallet) · [The Block — Benji Taylor to X](https://www.theblock.co/news/business/2026-03-26-elon-musk-taps-benji-taylor-395222)
- [Enhencer — Reels vs TikTok 2025](https://enhencer.com/blog/2025-instagram-reels-vs-tiktok-ads-which-offers-better-roi) (unsourced figures, directional only)
