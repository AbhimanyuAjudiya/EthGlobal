/** Video 04 — "Gift to a name" (SCRIPTS.md §5). 14.0 s / 420 frames, 1080 × 1920. */
import {
  ShortShell,
  type FootageKey,
  type ScreenKey,
  type ShortBaseProps,
  type Shot,
} from '../scenes';
import { seed, type SaturdaySeed } from '../seed';

export const SHORT04_FOOTAGE: readonly FootageKey[] = ['rickshaw', 'giftSr', 'receiver'];
export const SHORT04_SCREENS: readonly ScreenKey[] = ['gift', 'gift-claim'];

export type Short04Props = ShortBaseProps & { pass: SaturdaySeed['short04'] };

export const short04Defaults: Short04Props = {
  footage: {},
  screens: {},
  pass: seed.short04,
  endLine: 'Data, addressed to a name.',
  theme: 'light',
};

export function Short04GiftToName(p: Short04Props) {
  const shots: Shot[] = [
    {
      id: 'S1',
      from: 0,
      to: 90,
      type: 'REAL OTS',
      clip: 'rickshaw',
      ownAudio: true,
      picture: `Back seat of an auto-rickshaw at night; /gift with Who gets it?; the sender types ${p.pass.to}; at f30 the resolution line → 0x… · Ethereum mainnet.`,
      mustSee: ['the resolution line with the address and Ethereum mainnet'],
    },
    {
      id: 'S2',
      from: 90,
      to: 200,
      type: 'REAL SR /gift → /pay',
      clip: 'giftSr',
      screen: { key: 'gift', trimBefore: 180 },
      picture: `Size row; Gift ${p.pass.size} to ${p.pass.to}; Review (Valid … until ${p.pass.validUntil}, Network fee $0.00 — paid by the facilitator); Pay; Approve in MetaMask…; Sending; Final.`,
      mustSee: ['the TESTNET strip', 'the fee line', 'the hash', 'Final'],
    },
    {
      id: 'S3',
      from: 200,
      to: 290,
      // SCRIPTS.md §5 drew this as a RENDERED BoardingPassCard; it is now the real pass /gift issues.
      type: 'SCREEN',
      screen: { key: 'gift', trimBefore: 360 },
      picture:
        'The BoardingPass /gift issues: TO · FROM · size · MUMBAI · VALID UNTIL, the PIN stub and its QR.',
    },
    {
      id: 'S4',
      from: 290,
      to: 370,
      type: 'REAL OTS, receiver',
      clip: 'receiver',
      ownAudio: true,
      // The push needs the camera; the claim itself is the real /gift/claim page.
      screen: { key: 'gift-claim', trimBefore: 75 },
      picture: `The receiver's phone at the venue: push ${p.pass.from} sent you ${p.pass.size}; tap; Approve in your wallet to claim — no payment; /plan reads ${p.pass.size}.`,
      mustSee: ['the push text', 'the no payment claim line', 'the resulting plan'],
    },
  ];
  return (
    <ShortShell composition="Short04GiftToName" shots={shots} endFrom={370} endId="S5" {...p} />
  );
}
