/** Video 03 — "Your agent paid while you slept" (SCRIPTS.md §4). 18.0 s / 540 frames, 1080 × 1920. */
import {
  NotificationCard,
  Receipt,
  SeedTag,
  ShortShell,
  TestnetStrip,
  UiScreen,
  type FootageKey,
  type ShortBaseProps,
  type Shot,
} from '../scenes';
import { seed, type ReceiptSeed } from '../seed';

export const SHORT03_FOOTAGE: readonly FootageKey[] = [
  'table',
  'agentSr',
  'hashscanSr',
  'planSr03',
  'room03',
];

export type Short03Props = ShortBaseProps & {
  /** The reseller's usage API lagged: /plan shows "simulated usage" and S4's caption says so. */
  simulated: boolean;
  receipt: ReceiptSeed;
  push: typeof seed.short03.push;
};

export const short03Defaults: Short03Props = {
  footage: {},
  simulated: false,
  receipt: seed.short03.receipt,
  push: seed.short03.push,
  endLine: 'My agent bought 100 MB at 03:12.',
  theme: 'light',
};

/** "Sat 7 Nov 03:12" from an ISO time with an offset, read in that offset (IST), not the render host's zone. */
export function receiptHeaderTime(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d, hh, mm] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  const day = date.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });
  const month = date.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
  return `${day} ${Number(d)} ${month} ${hh}:${mm}`;
}

/** S5 — RENDERED ReceiptThreeLine on a money screen (strip in frame). */
export function ReceiptThreeLine({ receipt }: { receipt: ReceiptSeed }) {
  return (
    <>
      <UiScreen>
        <div style={{ height: 54 }} />
        <TestnetStrip />
        <div style={{ padding: '96px 20px 0' }}>
          <Receipt
            mb={receipt.mb}
            when={receiptHeaderTime(receipt.at)}
            rail={receipt.rail}
            state="finalized"
            you={receipt.you}
            sponsor={receipt.sponsor}
            fee={receipt.fee}
            hash={receipt.hash}
            hcsSequence={receipt.hcsSequence}
            arkivKey={receipt.arkivKey}
          />
        </div>
      </UiScreen>
      <SeedTag />
    </>
  );
}

export function Short03AgentPaid(p: Short03Props) {
  const shots: Shot[] = [
    {
      id: 'S1',
      from: 0,
      to: 90,
      type: 'REAL OTS tabletop',
      clip: 'table',
      ownAudio: true,
      picture:
        'Dark room, phone face-up beside a cutting-chai glass, 1× lens at table height. f0–f5 almost black; f6 the screen wakes: 03:12 and the push.',
      mustSee: ['the push text', '03:12'],
      reference: (
        <div style={{ width: 360, transform: 'scale(2)', transformOrigin: 'top left' }}>
          <NotificationCard {...p.push} />
        </div>
      ),
    },
    {
      id: 'S2',
      from: 90,
      to: 180,
      type: 'REAL SR /agent',
      clip: 'agentSr',
      picture:
        'One sheet, two controls: ≤ $10 / day stepper, Pause; the policy sentence; the row 03:12 · +100 MB · $0.40 · agent uaid:hcs-14:… ↗',
      mustSee: ['the TESTNET strip', 'the policy sentence', 'uaid:hcs-14:', 'the cap and Pause'],
    },
    {
      id: 'S3',
      from: 180,
      to: 300,
      type: 'REAL SR HashScan',
      clip: 'hashscanSr',
      picture:
        'HashScan testnet transaction: 0.40 USDC agent → payTo, SUCCESS, consensus 03:12:xx; then the HCS topic message with the receipt JSON.',
      mustSee: ['testnet header', '0.40', 'the consensus timestamp', 'the topic message body'],
    },
    {
      id: 'S4',
      from: 300,
      to: 390,
      type: 'REAL SR /plan/[key]',
      clip: 'planSr03',
      picture: p.simulated
        ? 'The meter extends once; 400 MB total; the simulated usage label; Expires in 5 d 06 h.'
        : 'The meter extends once; 400 MB total; usage as of 03:12; Expires in 5 d 06 h.',
      mustSee: [p.simulated ? 'simulated usage' : 'usage as of 03:12', '400 MB total'],
    },
    {
      id: 'S5',
      from: 390,
      to: 480,
      type: 'RENDERED',
      name: 'ReceiptThreeLine',
      render: <ReceiptThreeLine receipt={p.receipt} />,
    },
  ];
  return (
    <ShortShell
      composition="Short03AgentPaid"
      shots={shots}
      endFrom={480}
      endId="S6"
      room="room03"
      flags={{ simulated: p.simulated }}
      {...p}
    />
  );
}
