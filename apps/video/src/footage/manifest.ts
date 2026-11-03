/**
 * Every real capture the compositions can use, by key. Files live in apps/video/footage/ (served to the
 * bundle as public/footage/ through a symlink) and are never committed. footage/README.md is the capture
 * checklist; test/footage.test.ts keeps that README and this manifest in step.
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
    what: 'API log line POST …/api/v2/verify/<app_id> action=recharge-welcome',
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
    what: 'Arkiv Kaolin explorer page for the entitlement entity',
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
