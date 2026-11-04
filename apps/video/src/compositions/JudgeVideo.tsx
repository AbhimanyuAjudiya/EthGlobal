/**
 * Judge / sponsor video (SCRIPTS.md §6). 1920 × 1080, 30 fps. The timestamp plan's last row ends at f5400
 * (3:00, the hard ceiling), so that is the composition length; the 2:50 target is met by trimming rows once
 * the narration take exists (calculateMetadata can then follow the take's length).
 *
 * Layout: EvidencePane is SCRIPTS.md's 1200 × 900 at x = 720, y = 90. PhoneInset keeps x = 120 and 9:16 but is
 * 540 × 960 at y = 90 instead of 608 × 1080 at y = 0: the full-height inset sat under the chapter rail, which
 * would cover a screen recording's status bar (SCRIPTS.md §1), and overlapped EvidencePane by 8 px. Type sizes are CSS px at S = 2 (a 960 px laptop viewport
 * at 2×), so the 12 px chapter rail is legible at 1080p.
 */
import { type ReactNode } from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';

import { Footage, type FootageSources, type ScreenUse } from '../components/Footage';
import { Frame } from '../components/Frame';
import { Pane } from '../components/pane';
import { SeedTag } from '../components/SeedTag';
import {
  footagePath,
  type FootageAvailability,
  type FootageKey,
  type ScreenAvailability,
  type ScreenKey,
} from '../footage/manifest';
import { EndCardLandscape } from '../scenes/EndCard';
import {
  ChapterRail,
  LinesPane,
  MechanismPanes,
  PathLabel,
  type Chapter,
  type MechanismPane,
  type PaneLine,
} from '../scenes/JudgePanes';
import { seed } from '../seed';
import { FPS } from '../theme';

export const S = 2;
export const JUDGE_FRAMES = 5400;
const PHONE = { x: 120, y: 90, width: 540, height: 960 } as const;
const EVIDENCE = { x: 720, y: 90, width: 1200, height: 900 } as const;

export const JUDGE_FOOTAGE: readonly FootageKey[] = [
  'narration',
  'arrivals',
  'lte',
  'front',
  'macro',
  'verifySr',
  'verifyLog',
  'claimHashscan',
  'curl402',
  'paySr',
  'payHashscan',
  'datadrop',
  'agentLog',
  'agentSr',
  'arkivExplorer',
  'planSrJudge',
  'nonce',
  'sponsorSc',
  'docsSc',
  'giftSr',
  'receiver',
];
export const JUDGE_SCREENS: readonly ScreenKey[] = [
  'verify',
  'receipts',
  'pay',
  'plan-topped',
  'agent',
  'plan',
  'sponsor-desktop',
  'gift',
  'gift-claim',
];

// Remotion composition props must be a type alias (an interface does not satisfy Record<string, unknown>).
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type JudgeProps = {
  footage: FootageAvailability;
  screens: ScreenAvailability;
  chapters: Chapter[];
  oneSentence: string;
  mechanism: MechanismPane[];
  continuity: string;
  claimKey: string;
  tiers: PaneLine[];
  threeReads: PaneLine[];
  threeLines: PaneLine[];
  judge: typeof seed.judge;
  theme: 'light' | 'dark';
};

export const judgeDefaults: JudgeProps = {
  footage: {},
  screens: {},
  chapters: [
    { label: 'World', time: '0:30', from: 900 },
    { label: 'Hedera', time: '1:00', from: 1800 },
    { label: 'Arkiv', time: '1:50', from: 3300 },
    { label: 'ENS', time: '2:25', from: 4350 },
    { label: 'Disclosure', time: '2:52', from: 5160 },
  ],
  oneSentence:
    "Recharge: prove you're human and a sponsor pays for your first 300 MB of Mumbai data; after that you — or your agent — pay per 100 MB over x402, every bundle is an Arkiv entity that expires by itself, and anyone can gift data to an ENS name.",
  mechanism: [
    { head: 'identity · World', line: 'One human, once: the proof is verified server-side.' },
    {
      head: 'money · Hedera',
      line: 'A sponsor pool on Hedera EVM; per-100 MB payments over x402.',
    },
    { head: 'entitlement · Arkiv', line: 'Every bundle is an entity that expires by itself.' },
  ],
  continuity: 'Continuity entry · tag v0-prekickoff · in-window work dated in CHANGELOG.md',
  claimKey: 'claimKey = keccak256(campaignId ‖ HMAC(secret, nullifierHash))',
  tiers: [
    { text: 'Orb · 300 MB free' },
    { text: 'Document · 150 MB free' },
    { text: 'Device · no free bundle · pays the human price' },
  ],
  threeReads: [
    {
      text: '1 · every /esim/* request reads the entitlement → serve or 402',
      path: 'packages/octroi/src/entitlement.ts',
    },
    {
      text: "2 · the agent's remaining-MB read decides the purchase",
      path: 'services/agent/',
    },
    {
      text: '3 · the gift claim reads the escrow by namehash',
      path: 'services/api/src/routes/gift.ts',
    },
  ],
  threeLines: [
    { text: 'Without World: a $0.34-per-profile sybil farm; no sponsor funds it.' },
    { text: 'Without Hedera: no one-human-one-claim with money behind it; no neutral timestamp.' },
    { text: 'Without Arkiv: Postgres and a cron job; audits only we can run.' },
  ],
  judge: seed.judge,
  theme: 'light',
};

const t = (f: number) => {
  const sec = f / FPS;
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
};

/** A Sequence on the judge timeline with absolute frame numbers from the timestamp plan. */
function At({
  from,
  to,
  children,
  name,
}: {
  from: number;
  to: number;
  children: ReactNode;
  name: string;
}) {
  return (
    <Sequence from={from} durationInFrames={to - from} name={name} layout="none">
      {children}
    </Sequence>
  );
}

function Capture({
  pane,
  clip,
  screen,
  sources,
  from,
  to,
  picture,
  ownAudio = false,
}: {
  pane: 'phone' | 'evidence';
  clip?: FootageKey;
  /** The headless capture of the same route, used until the human capture exists. */
  screen?: ScreenUse;
  sources: FootageSources & { narration: boolean };
  from: number;
  to: number;
  picture: string;
  ownAudio?: boolean;
}) {
  const box = pane === 'phone' ? PHONE : EVIDENCE;
  return (
    <At from={from} to={to} name={`${pane}: ${clip ?? `screen/${screen?.key ?? ''}`}`}>
      <Pane {...box}>
        <Footage
          {...(clip ? { clip } : {})}
          {...(screen ? { screen } : {})}
          sources={sources}
          muted={!ownAudio || sources.narration}
          info={{
            shot: `${t(from)}–${t(to)}`,
            type: clip ? (pane === 'phone' ? 'REAL SR/OTS' : 'REAL SC') : 'SCREEN',
            time: `f${from}–f${to}`,
            picture,
          }}
        />
      </Pane>
    </At>
  );
}

export function JudgeVideo(p: JudgeProps) {
  const f = {
    footage: p.footage,
    screens: p.screens,
    theme: p.theme,
    narration: Boolean(p.footage.narration),
  };
  return (
    <Frame theme={p.theme}>
      {/* 0:00–0:08 the BOM hero, pillar-boxed; right pane empty paper. */}
      <Capture
        pane="phone"
        clip="arrivals"
        sources={f}
        from={0}
        to={120}
        ownAudio
        picture="Video 01 S1: No Service in the arrivals hall."
      />
      <Capture
        pane="phone"
        clip="lte"
        sources={f}
        from={120}
        to={240}
        ownAudio
        picture="Video 01 S6: Searching… → LTE."
      />
      {/* 0:08–0:20 the push; the printed card in a hand; the one sentence as a block. */}
      <Capture
        pane="phone"
        clip="lte"
        sources={f}
        from={240}
        to={600}
        picture="The lock-screen push: 300 MB · from <sponsor> · because you're human."
      />
      <Capture
        pane="evidence"
        clip="front"
        sources={f}
        from={240}
        to={600}
        picture="The printed card in a hand."
      />
      <At from={240} to={600} name="PathLabel: one sentence">
        <PathLabel s={S}>{p.oneSentence}</PathLabel>
      </At>
      {/* 0:20–0:30 mechanism panes. */}
      <At from={600} to={900} name="MechanismPanes">
        <MechanismPanes panes={p.mechanism} strip={p.continuity} s={S} />
      </At>
      {/* 0:30–1:00 World. */}
      <Capture
        pane="phone"
        clip="verifySr"
        screen={{ key: 'verify', trimBefore: 15 }}
        sources={f}
        from={900}
        to={1240}
        picture="/verify → World App (a non-team Orb-verified human) → Checking · 2 s."
      />
      {/* Until the human take exists the headless clips continue: the issued plan, then its receipt. */}
      <Capture
        pane="phone"
        clip="verifySr"
        screen={{ key: 'plan', trimBefore: 10 }}
        sources={f}
        from={1240}
        to={1640}
        picture="/verify → World App (a non-team Orb-verified human) → Checking · 2 s."
      />
      <Capture
        pane="phone"
        clip="verifySr"
        screen={{ key: 'receipts', trimBefore: 30 }}
        sources={f}
        from={1640}
        to={1800}
        picture="/verify → World App (a non-team Orb-verified human) → Checking · 2 s."
      />
      <Capture
        pane="evidence"
        clip="verifyLog"
        sources={f}
        from={900}
        to={1200}
        picture="API log: POST developer.worldcoin.org/api/v2/verify/<app_id> action=recharge-welcome nullifier=<hashed> level=orb"
      />
      <At from={1200} to={1500} name="TierTable">
        <Pane {...EVIDENCE}>
          <LinesPane lines={p.tiers} s={S} />
        </Pane>
      </At>
      <Capture
        pane="evidence"
        clip="claimHashscan"
        sources={f}
        from={1500}
        to={1800}
        picture="HashScan testnet: DataDrop.claim tx with the Claimed event."
      />
      <At from={1500} to={1800} name="PathLabel: claimKey">
        <PathLabel s={S} mono>
          {p.claimKey}
        </PathLabel>
      </At>
      {/* 1:00–1:50 Hedera. */}
      <Capture
        pane="evidence"
        clip="curl402"
        sources={f}
        from={1800}
        to={2250}
        picture='curl -i "https://<host>/esim/topup?key=<key>&mb=100" → HTTP/1.1 402, decoded PAYMENT-REQUIRED accepts[]: Base Sepolia · USDC, Hedera testnet · USDC.'
      />
      <Capture
        pane="phone"
        clip="paySr"
        screen={{ key: 'pay', trimBefore: 0 }}
        sources={f}
        from={2250}
        to={2600}
        picture="A judge pays on Hedera from /pay: Add 100 MB · $0.40 → Pay → Approve → Sending → Final. Strip visible."
      />
      <Capture
        pane="phone"
        clip="paySr"
        screen={{ key: 'plan-topped', trimBefore: 15 }}
        sources={f}
        from={2600}
        to={2700}
        picture="A judge pays on Hedera from /pay: Add 100 MB · $0.40 → Pay → Approve → Sending → Final. Strip visible."
      />
      <Capture
        pane="evidence"
        clip="payHashscan"
        sources={f}
        from={2250}
        to={2700}
        picture="HashScan testnet transaction of that payment."
      />
      <Capture
        pane="evidence"
        clip="datadrop"
        sources={f}
        from={2700}
        to={3000}
        picture="DataDrop on Hedera EVM, chain 296: contract page, Claimed events, sponsor USDC per claim."
      />
      <At from={2700} to={3000} name="PathLabel: DataDrop.sol">
        <PathLabel s={S} mono>
          packages/contracts/src/DataDrop.sol
        </PathLabel>
      </At>
      <Capture
        pane="phone"
        clip="agentSr"
        screen={{ key: 'agent', trimBefore: 45 }}
        sources={f}
        from={3000}
        to={3300}
        picture="/agent sheet: ≤ $10 / day · Pause."
      />
      <Capture
        pane="evidence"
        clip="agentLog"
        sources={f}
        from={3000}
        to={3300}
        picture="services/agent log: ledger.get → shouldTopUp → 402 → sign → 200 → consensus.submit; HashScan topic with the HCS-14 UAID receipt."
      />
      {/* 1:50–2:25 Arkiv. */}
      <Capture
        pane="evidence"
        clip="arkivExplorer"
        sources={f}
        from={3300}
        to={3450}
        picture="Arkiv rabdi explorer (rabdi.explorer.arkiv.network): the entitlement entity, expiresAt, attributes."
      />
      <At from={3450} to={3750} name="ThreeReads">
        <LinesPane lines={p.threeReads} s={S} size={20} />
      </At>
      <Capture
        pane="phone"
        clip="planSrJudge"
        screen={{ key: 'plan', trimBefore: 120 }}
        sources={f}
        from={3750}
        to={3900}
        picture="/plan: Expires in 6 d 22 h and the entity-key disclosure."
      />
      <Capture
        pane="evidence"
        clip="nonce"
        sources={f}
        from={3900}
        to={4050}
        picture="A 120-second challenge-nonce entity queried, then queried again after expiry (gone)."
      />
      <Capture
        pane="evidence"
        clip="sponsorSc"
        screen={{ key: 'sponsor-desktop', trimBefore: 30 }}
        sources={f}
        from={4050}
        to={4200}
        picture="/sponsor/[id]: 38 plans expire in 24 h, as a query."
      />
      <Capture
        pane="evidence"
        clip="docsSc"
        sources={f}
        from={4200}
        to={4350}
        picture="docs/arkiv.schema.json, docs/ARKIV_FEEDBACK.md, docs/SWARM.md."
      />
      {/* 2:25–2:40 ENS. */}
      <Capture
        pane="phone"
        clip="giftSr"
        screen={{ key: 'gift', trimBefore: 75 }}
        sources={f}
        from={4350}
        to={4560}
        picture="/gift resolve → pay, strip visible."
      />
      {/* SCRIPTS.md §6 drew a RENDERED BoardingPassCard here; it is the real pass /gift issues. */}
      <Capture
        pane="phone"
        screen={{ key: 'gift', trimBefore: 360 }}
        sources={f}
        from={4560}
        to={4680}
        picture="The BoardingPass /gift issues: TO · FROM · size · VALID UNTIL, the PIN stub and its QR."
      />
      <Capture
        pane="phone"
        clip="receiver"
        screen={{ key: 'gift-claim', trimBefore: 75 }}
        sources={f}
        from={4680}
        to={4800}
        picture="The receiver's push and the no-payment claim."
      />
      {/* 2:40–2:52 what breaks without each, then the real scratch. */}
      <At from={4800} to={5100} name="ThreeLines">
        <LinesPane lines={p.threeLines} s={S} />
      </At>
      <Capture
        pane="phone"
        clip="macro"
        sources={f}
        from={5100}
        to={5160}
        ownAudio
        picture="The scratch card in a hand, coin on latex, two seconds."
      />
      {/* 2:52–3:00 end card with the disclosure. */}
      <At from={5160} to={JUDGE_FRAMES} name="EndCard landscape">
        <EndCardLandscape
          disclosure={p.judge.disclosure}
          endpoint={p.judge.endpoint}
          repo={p.judge.repo}
          scale={S}
        />
        <SeedTag source="endpoint from src/seed/saturday.json" />
      </At>
      <At from={240} to={5160} name="ChapterRail">
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          <ChapterRail chapters={p.chapters} s={S} />
        </AbsoluteFill>
      </At>
      {f.narration ? <Audio src={staticFile(footagePath('narration'))} /> : null}
    </Frame>
  );
}
