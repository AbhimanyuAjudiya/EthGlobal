/**
 * Video 02 — "Scratch" (SCRIPTS.md §3). 15.0 s / 450 frames, 1080 × 1920.
 * The scratch is never rendered (a rendered scratch is the fake the object exists to refute): the paper scratch
 * is the macro shoot, and the digital one is the real /card/[serial] page recorded headlessly with the pointer
 * driven across the latex. Only the end card is RENDERED.
 */
import {
  ShortShell,
  type FootageKey,
  type ScreenKey,
  type ShortBaseProps,
  type Shot,
} from '../scenes';
import { seed } from '../seed';

export const SHORT02_FOOTAGE: readonly FootageKey[] = [
  'macro',
  'front',
  'cardSr',
  'planSr02',
  'back',
];
export const SHORT02_SCREENS: readonly ScreenKey[] = ['card', 'plan'];

export type Short02Props = ShortBaseProps & { serial: string };

export const short02Defaults: Short02Props = {
  footage: {},
  screens: {},
  serial: seed.short02.serial,
  endLine: 'The recharge coupon is back. 300 MB.',
  theme: 'light',
};

export function Short02Scratch(p: Short02Props) {
  const shots: Shot[] = [
    {
      id: 'S1',
      from: 0,
      to: 90,
      type: 'REAL macro',
      clip: 'macro',
      ownAudio: true,
      picture:
        'Top-down macro: the 34 × 12 mm silver panel, rub here · यहाँ रगड़ें readable; ₹1 coin enters f5, first contact f12; three strokes; the PIN emerges 4821 9930 1127 5064.',
      mustSee: ['rub here · यहाँ रगड़ें before it is scraped', 'the 16 digits in 4 × 4'],
    },
    {
      id: 'S2',
      from: 90,
      to: 160,
      type: 'REAL top-down',
      clip: 'front',
      ownAudio: true,
      picture:
        "Whole card front on dark wood or canteen steel: wordmark; 300 MB; Mumbai · 7 days; because you're human / क्योंकि आप इंसान हैं; QR; serial; Expires 30 Nov 2026.",
      mustSee: ['300 MB', 'the bilingual line', 'the QR', 'Expires 30 Nov 2026'],
    },
    {
      id: 'S3',
      from: 160,
      to: 250,
      type: 'REAL SR /card/<serial>',
      clip: 'cardSr',
      screen: { key: 'card', trimBefore: 120 },
      picture: `QR scanned with the phone camera; /card/${p.serial} opens the digital Coupon in lang="hi"; thumb scratches 1:1; Redeem; tap.`,
      mustSee: ['the same serial in the URL bar or header', 'the latex in Hindi', 'Redeem'],
    },
    {
      id: 'S4',
      from: 250,
      to: 340,
      type: 'REAL SR /plan/[key]',
      clip: 'planSr02',
      screen: { key: 'plan', trimBefore: 60 },
      picture:
        'Odometer 0 → 300 once; the meter fills once; usage as of 14:02; Expires in … IST; Why it expires by itself opened to show the entity key.',
      mustSee: ['usage as of', 'the Expires in … IST line', 'the entity key'],
    },
    {
      id: 'S5',
      from: 340,
      to: 400,
      type: 'REAL macro',
      clip: 'back',
      ownAudio: true,
      picture:
        'Card back: Bundle 300 MB / Paid by Hedera $0.50 / Network fee $0.00 and the To: ________ .eth line; a pen writes a teammate’s real name.',
      mustSee: ['the three receipt lines', 'the .eth write-in'],
    },
  ];
  return <ShortShell composition="Short02Scratch" shots={shots} endFrom={400} endId="S6" {...p} />;
}
