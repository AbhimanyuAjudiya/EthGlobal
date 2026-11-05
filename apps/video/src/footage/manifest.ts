/**
 * Every real capture the compositions can use, by key. Files live in apps/video/footage/ (served to the
 * bundle as public/footage/ through a symlink) and are never committed. footage/README.md is the capture
 * checklist; test/footage.test.ts keeps that README and this manifest in step.
 *
 * Two sources: FOOTAGE is what the human team shoots on-site (camera phone, subject-phone screen recordings,
 * laptop captures); SCREENS are headless recordings of the real PWA against the local stack
 * (scripts/capture-screens.mjs → footage/screen/<key>-<theme>.mp4). A shot plays the human capture when it
 * exists, else the headless one, else a labelled placeholder slate.
 */
export type FootageKind = 'OTS' | 'SR' | 'SC' | 'macro' | 'audio';

export interface FootageSpec {
  file: string;
  video: '01' | '02' | '03' | '04' | 'judge';
  kind: FootageKind;
  /** What the clip shows, from SCRIPTS.md. */
  what: string;
}

export const FOOTAGE = {
  // Video 01 — No Service → LTE (SCRIPTS.md §2)
  arrivals: {
    file: '01-arrivals.mp4',
    video: '01',
    kind: 'OTS',
    what: 'BOM T2 arrivals hall, phone at chest height, status bar No Service / SOS',
  },
  screen01: {
    file: '01-screen.mp4',
    video: '01',
    kind: 'SR',
    what: 'Subject phone screen recording: / → /verify → World App → /plan → /install',
  },
  lte: {
    file: '01-lte.mp4',
    video: '01',
    kind: 'OTS',
    what: 'Status bar Searching… → LTE, Control Center carrier, the push',
  },
  room01: {
    file: '01-room.wav',
    video: '01',
    kind: 'audio',
    what: 'Camera-phone room track, continuous',
  },
  // Video 02 — Scratch (SCRIPTS.md §3)
  macro: {
    file: '02-macro.mp4',
    video: '02',
    kind: 'macro',
    what: 'Top-down macro: coin on latex, PIN emerges',
  },
  front: {
    file: '02-front.mp4',
    video: '02',
    kind: 'macro',
    what: 'Whole card front on dark wood or canteen steel',
  },
  cardSr: {
    file: '02-card-sr.mp4',
    video: '02',
    kind: 'SR',
    what: 'QR scan → /card/<serial>, digital scratch, Redeem',
  },
  planSr02: {
    file: '02-plan-sr.mp4',
    video: '02',
    kind: 'SR',
    what: '/plan/[key] odometer, meter, Why it expires by itself',
  },
  back: {
    file: '02-back.mp4',
    video: '02',
    kind: 'macro',
    what: 'Card back, receipt lines, pen writes a .eth name',
  },
  // Video 03 — Your agent paid while you slept (SCRIPTS.md §4)
  table: {
    file: '03-table.mp4',
    video: '03',
    kind: 'OTS',
    what: 'Dark tabletop, phone wakes at 03:12 with the push',
  },
  agentSr: {
    file: '03-agent-sr.mp4',
    video: '03',
    kind: 'SR',
    what: '/agent sheet: ≤ $10 / day, Pause, policy sentence, 03:12 row',
  },
  hashscanSr: {
    file: '03-hashscan-sr.mp4',
    video: '03',
    kind: 'SR',
    what: 'HashScan testnet transaction, then the HCS topic message',
  },
  planSr03: {
    file: '03-plan-sr.mp4',
    video: '03',
    kind: 'SR',
    what: '/plan/[key] meter extends, 400 MB total, usage as of 03:12',
  },
  room03: {
    file: '03-room.wav',
    video: '03',
    kind: 'audio',
    what: 'Room hum and the real notification tone',
  },
  // Video 04 — Gift to a name (SCRIPTS.md §5)
  rickshaw: {
    file: '04-rickshaw.mp4',
    video: '04',
    kind: 'OTS',
    what: 'Auto-rickshaw at night, /gift resolving priya.eth',
  },
  giftSr: {
    file: '04-gift-sr.mp4',
    video: '04',
    kind: 'SR',
    what: '/gift → /pay: sizes, Review, Pay, Sending, Final',
  },
  receiver: {
    file: '04-receiver.mp4',
    video: '04',
    kind: 'OTS',
    what: 'Receiver phone: push, claim with no payment, /plan reads 1 GB',
  },
  // Judge video (SCRIPTS.md §6); also reuses the shorts' captures above
  narration: {
    file: 'judge-founder-take.wav',
    video: 'judge',
    kind: 'audio',
    what: 'Founder narration, phone mic, one take, 48 kHz',
  },
  verifySr: {
    file: 'judge-verify-sr.mp4',
    video: 'judge',
    kind: 'SR',
    what: '/verify → World App (non-team Orb human) → Checking · 2 s',
  },
  verifyLog: {
    file: 'judge-verify-log.mp4',
    video: 'judge',
    kind: 'SC',
    what: 'API log line POST …/api/v4/verify/<app_id> action=recharge-welcome',
  },
  claimHashscan: {
    file: 'judge-claim-hashscan.mp4',
    video: 'judge',
    kind: 'SC',
    what: 'HashScan testnet DataDrop.claim tx with the Claimed event',
  },
  curl402: {
    file: 'judge-402-curl.mp4',
    video: 'judge',
    kind: 'SC',
    what: 'Terminal: curl /esim/topup → HTTP/1.1 402 + decoded PAYMENT-REQUIRED',
  },
  paySr: {
    file: 'judge-pay-sr.mp4',
    video: 'judge',
    kind: 'SR',
    what: "Judge's phone /pay on Hedera: Add 100 MB → Final, strip visible",
  },
  payHashscan: {
    file: 'judge-pay-hashscan.mp4',
    video: 'judge',
    kind: 'SC',
    what: 'HashScan testnet transaction of the human payment',
  },
  datadrop: {
    file: 'judge-datadrop.mp4',
    video: 'judge',
    kind: 'SC',
    what: 'DataDrop on Hedera EVM chain 296, Claimed events',
  },
  agentLog: {
    file: 'judge-agent-log.mp4',
    video: 'judge',
    kind: 'SC',
    what: 'services/agent log and the HashScan topic page with the HCS-14 UAID',
  },
  arkivExplorer: {
    file: 'judge-arkiv-explorer.mp4',
    video: 'judge',
    kind: 'SC',
    what: 'Arkiv rabdi explorer page for the entitlement entity',
  },
  planSrJudge: {
    file: 'judge-plan-sr.mp4',
    video: 'judge',
    kind: 'SR',
    what: '/plan Expires in 6 d 22 h and the entity-key disclosure',
  },
  nonce: {
    file: 'judge-nonce.mp4',
    video: 'judge',
    kind: 'SC',
    what: '120-second challenge-nonce entity queried before and after expiry',
  },
  sponsorSc: {
    file: 'judge-sponsor.mp4',
    video: 'judge',
    kind: 'SC',
    what: '/sponsor/[id] with 38 plans expire in 24 h as a query',
  },
  docsSc: {
    file: 'judge-docs.mp4',
    video: 'judge',
    kind: 'SC',
    what: 'docs/arkiv.schema.json, docs/ARKIV_FEEDBACK.md, docs/SWARM.md',
  },
} as const satisfies Record<string, FootageSpec>;

export type FootageKey = keyof typeof FOOTAGE;
export type FootageAvailability = Partial<Record<FootageKey, boolean>>;

export const footageKeys = Object.keys(FOOTAGE) as FootageKey[];

export function footagePath(key: FootageKey): string {
  return `footage/${FOOTAGE[key].file}`;
}

export type ScreenTheme = 'light' | 'dark';

export interface ScreenSpec {
  /** The route as the product names it. */
  route: string;
  what: string;
  /** Hashes, keys, addresses, PINs or local-chain records are on screen: the SEED DATA label goes on the frame. */
  showsSeed: boolean;
  /** Recorded at a laptop viewport (1200 × 900, conformed to 1920 × 1080) instead of 360 × 780 @3×. */
  desktop?: true;
  /** Recorded in this theme only. */
  only?: ScreenTheme;
}

/** Headless captures of apps/web (scripts/capture-screens.mjs); one file per theme. */
export const SCREENS = {
  landing: {
    route: '/',
    what: "Live coupon and both paths; tap Prove I'm human → the /verify sheet",
    showsSeed: false,
  },
  'landing-pay': {
    route: '/',
    what: "Tap I'll pay · $0.40 per 100 MB → the 402 Review sheet",
    showsSeed: false,
  },
  verify: {
    route: '/verify',
    what: 'Simulated World ID → Checking → bundle issued, IssuingRows, the lock-screen line',
    showsSeed: true,
  },
  plan: {
    route: '/plan/[key]',
    what: 'Meter, usage as of, Expires in, Why it expires by itself opened to the Arkiv key',
    showsSeed: true,
  },
  'install-ios': {
    route: '/install',
    what: "iOS 17.4+ universal link state, Didn't open? Tap again, the steps",
    showsSeed: false,
  },
  'install-android': {
    route: '/install',
    what: 'Android: Copy activation code → Copied, the Settings steps',
    showsSeed: false,
  },
  pay: {
    route: '/pay?key=',
    what: 'Add 100 MB · $0.40: Review → demo wallet signs → Sending · hash → Confirmed → Final',
    showsSeed: true,
  },
  'plan-topped': {
    route: '/plan/[key]',
    what: 'After the top-up: the meter extended once, 400 MB',
    showsSeed: true,
  },
  agent: {
    route: '/agent',
    what: 'Policy sentence, cap ≤ $5 → Saved · signed, back to ≤ $10 / day → Saved',
    showsSeed: true,
  },
  gift: {
    route: '/gift',
    what: 'Who gets it? rahul.eth resolves, 1 GB, the reclaim rule, Pay → the boarding pass',
    showsSeed: true,
  },
  'gift-claim': {
    route: '/gift/claim',
    what: 'Recipient (demo wallet · Anvil #9) claims by signature, no payment → /plan',
    showsSeed: true,
  },
  card: {
    route: '/card/[serial]',
    what: 'Hindi UI: PIN typed, latex scratched to ≈ 45 %, the rest fades, Redeem → /plan',
    showsSeed: true,
  },
  sponsor: {
    route: '/sponsor/[id]',
    what: 'Claims, tables, slide-to-confirm pause → Paused, then Resume claims',
    showsSeed: true,
  },
  'sponsor-desktop': {
    route: '/sponsor/[id]',
    what: 'The sponsor console at a laptop viewport: hero, tables',
    showsSeed: true,
    desktop: true,
    only: 'light',
  },
  receipts: {
    route: '/receipts',
    what: 'Per-day three-line receipts: the claim, the top-up, the gift',
    showsSeed: true,
  },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenKey = keyof typeof SCREENS;
export type ScreenAvailability = Partial<Record<ScreenKey, boolean>>;

export const screenKeys = Object.keys(SCREENS) as ScreenKey[];

/** footage/screen/<key>-<theme>.mp4; a single-theme capture is used in either theme. */
export function screenFile(key: ScreenKey, theme: ScreenTheme): string {
  const spec: ScreenSpec = SCREENS[key];
  return `screen/${key}-${spec.only ?? theme}.mp4`;
}

export function screenPath(key: ScreenKey, theme: ScreenTheme): string {
  return `footage/${screenFile(key, theme)}`;
}
