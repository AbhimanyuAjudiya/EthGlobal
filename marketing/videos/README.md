# marketing/videos

`SCRIPTS.md` is the binding shot list. The pipeline is `apps/video` (Remotion 4); renders land in `renders/` and
are git-ignored except `renders/index.json`, which `apps/video/scripts/render.sh` rewrites from its QA probe on every
run (duration, frames, resolution, codecs, loudness, true peak, size, and the footage index each render used).

## What is on screen now (Wed 4 Nov)

Every product screen in the five videos is a **real recording of the real PWA**, captured headlessly against the
local stack, not a redraw. The RENDERED look-alikes (`IssuingSequence`, `ReceiptThreeLine`, `BoardingPassCard`,
`CouponScreen`, `NotificationCard`) are deleted; each shot now plays, in order of preference:

1. the human team's capture in `apps/video/footage/` (subject-phone SR, camera OTS/macro, laptop SC), when it exists;
2. else the headless capture of the same route in `apps/video/footage/screen/<clip>-<theme>.mp4`;
3. else a dark **PLACEHOLDER · REAL capture missing** slate carrying the shot's capture checklist.

The headless captures show local-stack values (Anvil 31337, the product's own "Simulated World ID" and "demo wallet ·
Anvil #n", "simulated usage", "Local chain"), so every frame that shows a hash, key, address or PIN carries
**SEED DATA · not a real record · local-stack capture**. Short 03's S4 caption switches to `+100 MB · simulated usage`
automatically while its /plan shot is the headless one.

**The one props file the team edits on Saturday:** `apps/video/src/seed/saturday.json` (`provenance`, sponsor name,
serial, push copy, ENS names, judge endpoint/repo/disclosure). Set `"provenance": "rehearsal"` only after the
headless clips are re-captured against the live testnet stack (or replaced by the real subject-phone recordings)
and every value in that file is the real one.

## Headless captures (`apps/video/footage/screen/`, never committed)

Playwright (Chromium 1243), 360 × 780 CSS px, device scale 3, `isMobile` + `hasTouch`, iPhone UA (Android UA for
`install-android`), `Asia/Kolkata`; recorded from Chrome's screencast at 1080 × 2340 device pixels (Playwright's own
`recordVideo` encodes the 360 px CSS viewport), conformed with `conform.sh sr` to 1080 × 1920 CFR 30 H.264.

| Clip              | Route            | Light (s) | Dark (s) | Used in                                         |
| ----------------- | ---------------- | --------: | -------: | ----------------------------------------------- |
| `landing`         | `/`              |      9.77 |     9.67 | 01 S2                                           |
| `landing-pay`     | `/`              |      9.43 |     9.77 | (available)                                     |
| `verify`          | `/verify`        |     11.87 |    11.07 | 01 S3, 01 S4, judge 0:30                        |
| `plan`            | `/plan/[key]`    |     13.87 |    13.53 | 02 S4, judge 0:41, judge 2:05                   |
| `install-ios`     | `/install`       |     10.60 |    10.47 | 01 S5                                           |
| `install-android` | `/install`       |     11.63 |    11.53 | (available)                                     |
| `pay`             | `/pay?key=`      |     12.00 |    12.57 | judge 1:15                                      |
| `plan-topped`     | `/plan/[key]`    |      9.37 |     9.47 | 03 S4, judge 1:26                               |
| `agent`           | `/agent`         |     10.67 |    10.77 | 03 S2, judge 1:40                               |
| `gift`            | `/gift`          |     17.77 |    17.17 | 04 S2, 04 S3 (the pass), judge 2:25, judge 2:32 |
| `gift-claim`      | `/gift/claim`    |     10.43 |    10.43 | 04 S4, judge 2:36                               |
| `card`            | `/card/[serial]` |     19.03 |    17.40 | 02 S3 (Hindi UI, scratch to ≈ 45 %)             |
| `sponsor`         | `/sponsor/[id]`  |     24.57 |    24.00 | (available; table → pause → Paused → resume)    |
| `sponsor-desktop` | `/sponsor/[id]`  |     12.47 |        — | judge 2:15 (1200 × 900 laptop viewport, `sc`)   |
| `receipts`        | `/receipts`      |     10.33 |    10.40 | 03 S5, judge 0:54                               |

Re-capture (≈ 10 min for both themes, then ≈ 3 min to conform):

```sh
bash scripts/e2e-local.sh --keep &                       # Anvil :8546, API :8788, demo seed
(cd apps/web && bash e2e/serve.sh) &                     # production build on :3000, demo wallet on
node apps/video/scripts/capture-screens.mjs              # WEB_URL / API_URL / CARDS_FILE override the stack
bash apps/video/scripts/conform-screens.sh
bash apps/video/scripts/render.sh                        # full quality, QA probe, renders/index.json
```

## Renders (Wed 4 Nov, full quality)

H.264 High, yuv420p, 30 fps CFR, bt709, CRF 16 (JPEG 95 frames), AAC 48 kHz. Loudness: every track is silent until
the room tracks and the narration exist, so `post.sh` copies the audio through instead of normalising (it reports
`input_i=-inf`); the two-pass −14 LUFS / −1 dBTP loudnorm runs as soon as a `NN-room.wav` or the founder's take is in
`footage/`.

| File                        | Composition         | Duration | Frames | Resolution  | Size (bytes) | Size (MB) | Audio             | QA  |
| --------------------------- | ------------------- | -------: | -----: | ----------- | -----------: | --------: | ----------------- | --- |
| `short-01-no-service.mp4`   | `Short01NoService`  |  20.01 s |    600 | 1080 × 1920 |    1,990,196 |       1.9 | silent (−70 LUFS) | ok  |
| `short-02-scratch.mp4`      | `Short02Scratch`    |  15.02 s |    450 | 1080 × 1920 |    1,653,147 |       1.6 | silent (−70 LUFS) | ok  |
| `short-03-agent-paid.mp4`   | `Short03AgentPaid`  |  18.01 s |    540 | 1080 × 1920 |    1,788,183 |       1.7 | silent (−70 LUFS) | ok  |
| `short-04-gift-to-name.mp4` | `Short04GiftToName` |  14.02 s |    420 | 1080 × 1920 |    1,684,006 |       1.6 | silent (−70 LUFS) | ok  |
| `judge-recharge.mp4`        | `JudgeVideo`        | 180.01 s |   5400 | 1920 × 1080 |   12,595,982 |      12.0 | silent (−70 LUFS) | ok  |

Render times on this 4-core sandbox: 01 108 s, 02 71 s, 03 89 s, 04 79 s, judge 928 s.

Sizes are small because most frames are flat UI on paper; with 4K camera footage the shorts will land near the
25–40 MB SCRIPTS.md §8 expects.

## Still needs the human camera (placeholder slates in the renders)

- **01** S1 arrivals hall with the true status bar (No Service / SOS) and clock; S6 Searching… → LTE, the carrier in
  Control Center, the real push; S3 World App's own verify sheet and S5 the iOS cellular sheet (the headless clips
  show the product's side only: "Simulated World ID", the universal-link state); room track `01-room.wav`.
- **02** S1 coin on latex (macro), S2 the printed card front, S5 the card back and the pen writing the `.eth` name.
- **03** S1 the 03:12 tabletop with the real push and tone; S3 HashScan testnet transaction + HCS topic message;
  room track `03-room.wav`.
- **04** S1 the rickshaw with `/gift` resolving; S4 the receiver's lock-screen push (the claim itself is headless).
- **Judge** the narration (`judge-founder-take.wav`), the BOM hero, the printed card, and every laptop SC row: World
  verify log, `DataDrop.claim` on HashScan, the 402 `curl`, the payment on HashScan, `DataDrop` on chain 296, the agent
  log + HCS topic, the Arkiv rabdi explorer (`rabdi.explorer.arkiv.network`), the 120-s nonce, the docs files.
