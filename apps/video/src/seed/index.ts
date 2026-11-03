/**
 * Seed state for every RENDERED shot. SCRIPTS.md §1: a rendered shot is seeded with the real hashes, keys and
 * timestamps from the Saturday rehearsal (capture/<nn>/notes.md), never invented ones. Until then these are
 * the display strings SCRIPTS.md itself quotes, and `provenance: 'placeholder'` puts a SeedTag in every frame
 * that shows them. Flip to 'rehearsal' only after every value below is replaced with a real one.
 *
 * PINs are stored as four groups, never as one 16-digit string (security/redteam/tools/forbidden-patterns.txt).
 */
export type Provenance = 'placeholder' | 'rehearsal';

export interface EntitlementSeed {
  /** Arkiv entity key, display form. */
  key: string;
  tier: 'orb' | 'document' | 'device';
  mbTotal: number;
  mbUsed: number;
  /** "usage as of HH:MM" (IST). */
  usageAsOf: string;
  /** "6 d 22 h". */
  expiresIn: string;
  /** "Sun 15 Nov 09:12 IST". */
  expiresAt: string;
}

export interface ReceiptSeed {
  mb: number;
  /** ISO time with the IST offset. */
  at: string;
  rail: 'Hedera' | 'Base Sepolia';
  you: string;
  sponsor: string;
  fee: string;
  hash: string;
  hcsSequence: number;
  arkivKey: string;
}

export interface PassSeed {
  to: string;
  from: string;
  size: string;
  city: string;
  validUntil: string;
  pinGroups: readonly [string, string, string, string];
  serial: string;
  cardUrl: string;
}

export interface CouponSeed {
  mb: number;
  city: string;
  days: number;
  pinGroups: readonly [string, string, string, string];
  serial: string;
  expires: string;
  cardUrl: string;
}

export const seed = {
  provenance: 'placeholder' as Provenance,
  /** `from <sponsor>`: whatever the campaign entity says (SCRIPTS.md §1 "Honesty rules"). */
  sponsorName: 'Hedera',
  short01: {
    entitlement: {
      key: 'ent:7f3a…',
      tier: 'orb',
      mbTotal: 300,
      mbUsed: 0,
      usageAsOf: '14:02',
      expiresIn: '6 d 22 h',
      expiresAt: 'Sun 15 Nov 09:12 IST',
    } satisfies EntitlementSeed,
    claimTx: '0x1a2b…9f3e',
    push: {
      title: '300 MB · from Hedera',
      body: "because you're human. Install takes 2 minutes.",
      time: '14:02',
    },
  },
  short02: {
    coupon: {
      mb: 300,
      city: 'Mumbai',
      days: 7,
      pinGroups: ['4821', '9930', '1127', '5064'],
      serial: 'RC-0001',
      expires: 'Expires 30 Nov 2026',
      cardUrl: 'https://recharge.example/card/RC-0001',
    } satisfies CouponSeed,
  },
  short03: {
    receipt: {
      mb: 100,
      at: '2026-11-07T03:12:00+05:30',
      rail: 'Hedera',
      you: '$0.40',
      sponsor: '—',
      fee: '$0.00',
      hash: '0x1a2b…9f3e',
      hcsSequence: 0,
      arkivKey: 'ent:7f3a…',
    } satisfies ReceiptSeed,
    push: { title: '+100 MB · paid by your agent', body: '$0.40 · 03:12', time: '03:12' },
  },
  short04: {
    pass: {
      to: 'priya.eth',
      from: 'rahul.eth',
      size: '1 GB',
      city: 'MUMBAI',
      validUntil: 'Sun 15 Nov 09:12',
      pinGroups: ['4821', '9930', '1127', '5064'],
      serial: 'RC-0002',
      cardUrl: 'https://recharge.example/card/RC-0002',
    } satisfies PassSeed,
  },
  judge: {
    endpoint: 'https://recharge.example',
    repo: 'github.com/AbhimanyuAjudiya/EthGlobal',
    disclosure:
      'Continuity · v0-prekickoff 5 Nov 20:59 IST · in-window commits by the named team · AI assisted tests, fixtures and docs · keys generated on-site',
  },
} as const;
