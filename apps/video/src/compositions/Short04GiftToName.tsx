/** Video 04 — "Gift to a name" (SCRIPTS.md §5). 14.0 s / 420 frames, 1080 × 1920. */
import {
  BoardingPass,
  SeedTag,
  ShortShell,
  UiScreen,
  type FootageKey,
  type ShortBaseProps,
  type Shot,
} from '../scenes';
import { seed, type PassSeed } from '../seed';

export const SHORT04_FOOTAGE: readonly FootageKey[] = ['rickshaw', 'giftSr', 'receiver'];

export type Short04Props = ShortBaseProps & { pass: PassSeed };

export const short04Defaults: Short04Props = {
  footage: {},
  pass: seed.short04.pass,
  endLine: 'Data, addressed to a name.',
  theme: 'light',
};

/** S3 — RENDERED BoardingPassCard: enters once (translateY 24 → 0, 260 ms), then still. */
export function BoardingPassCard({ pass }: { pass: PassSeed }) {
  return (
    <>
      <UiScreen>
        <div style={{ padding: '200px 12px 0' }}>
          <BoardingPass pass={pass} />
        </div>
      </UiScreen>
      <SeedTag />
    </>
  );
}

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
      picture: `Size row; Gift ${p.pass.size} to ${p.pass.to}; Review (Valid … until ${p.pass.validUntil}, Network fee $0.00 — paid by the facilitator); Pay; Approve in MetaMask…; Sending; Final.`,
      mustSee: ['the TESTNET strip', 'the fee line', 'the hash', 'Final'],
    },
    {
      id: 'S3',
      from: 200,
      to: 290,
      type: 'RENDERED',
      name: 'BoardingPassCard',
      render: <BoardingPassCard pass={p.pass} />,
    },
    {
      id: 'S4',
      from: 290,
      to: 370,
      type: 'REAL OTS, receiver',
      clip: 'receiver',
      ownAudio: true,
      picture: `The receiver's phone at the venue: push ${p.pass.from} sent you ${p.pass.size}; tap; Approve in your wallet to claim — no payment; /plan reads ${p.pass.size}.`,
      mustSee: ['the push text', 'the no payment claim line', 'the resulting plan'],
    },
  ];
  return <ShortShell composition="Short04GiftToName" shots={shots} endFrom={370} endId="S5" {...p} />;
}
