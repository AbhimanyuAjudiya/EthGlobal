/** Video 03 — "Your agent paid while you slept" (SCRIPTS.md §4). 18.0 s / 540 frames, 1080 × 1920. */
import {
  ShortShell,
  type FootageKey,
  type ScreenKey,
  type ShortBaseProps,
  type Shot,
} from '../scenes';
import { seed } from '../seed';

export const SHORT03_FOOTAGE: readonly FootageKey[] = [
  'table',
  'agentSr',
  'hashscanSr',
  'planSr03',
  'room03',
];
export const SHORT03_SCREENS: readonly ScreenKey[] = ['agent', 'plan-topped', 'receipts'];

export type Short03Props = ShortBaseProps & {
  /** The reseller's usage API lagged: /plan shows "simulated usage" and S4's caption says so. */
  simulated: boolean;
};

export const short03Defaults: Short03Props = {
  footage: {},
  screens: {},
  simulated: false,
  endLine: 'My agent bought 100 MB at 03:12.',
  theme: 'light',
};

export function Short03AgentPaid(p: Short03Props) {
  // MODE=local reports "simulated usage" on /plan: while S4 is the headless capture, the caption must say so.
  const simulated = p.simulated || (!p.footage.planSr03 && Boolean(p.screens['plan-topped']));
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
      mustSee: [`the push text (${seed.short03.push})`, '03:12'],
    },
    {
      id: 'S2',
      from: 90,
      to: 180,
      type: 'REAL SR /agent',
      clip: 'agentSr',
      screen: { key: 'agent', trimBefore: 20 },
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
      screen: { key: 'plan-topped', trimBefore: 45 },
      picture: simulated
        ? 'The meter extends once; 400 MB total; the simulated usage label; Expires in 5 d 06 h.'
        : 'The meter extends once; 400 MB total; usage as of 03:12; Expires in 5 d 06 h.',
      mustSee: [simulated ? 'simulated usage' : 'usage as of 03:12', '400 MB total'],
    },
    {
      id: 'S5',
      from: 390,
      to: 480,
      // SCRIPTS.md §4 drew this as a RENDERED ReceiptThreeLine; it is now the real /receipts page.
      type: 'SCREEN',
      screen: { key: 'receipts', trimBefore: 40 },
      picture:
        '/receipts: the three-line receipt of the top-up, You · Sponsor · Network fee, Final.',
    },
  ];
  return (
    <ShortShell
      composition="Short03AgentPaid"
      shots={shots}
      endFrom={480}
      endId="S6"
      room="room03"
      flags={{ simulated }}
      {...p}
    />
  );
}
