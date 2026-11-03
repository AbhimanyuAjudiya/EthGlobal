/** Video 01 — "No Service → LTE" (SCRIPTS.md §2). 20.0 s / 600 frames, 1080 × 1920. */
import { captionFiles, CaptionTrack } from '../captions';
import { Frame } from '../components/Frame';
import { SeedTag } from '../components/SeedTag';
import { ShotTrack, type Shot } from '../components/ShotTrack';
import { UiScreen } from '../components/UiScreen';
import { type FootageAvailability, type FootageKey } from '../footage/manifest';
import { EndCard } from '../scenes/EndCard';
import { IssuingSequence } from '../scenes/IssuingSequence';
import { NotificationCard } from '../scenes/NotificationCard';
import { seed } from '../seed';

export const SHORT01_FOOTAGE: readonly FootageKey[] = ['arrivals', 'screen01', 'lte', 'room01'];

export type Short01Props = {
  footage: FootageAvailability;
  /** S6 was cut S6a → S6b: show the Chivo Mono elapsed note (SCRIPTS.md §2 S6). */
  s6Cut: boolean;
  /** In-points (frames) of S2–S5 inside the one subject-phone screen recording. */
  screenIn: { s2: number; s3: number; s4: number; s5: number };
  seed: typeof seed.short01;
  sponsorName: string;
  endLine: string;
  theme: 'light' | 'dark';
};

export const short01Defaults: Short01Props = {
  footage: {},
  s6Cut: false,
  screenIn: { s2: 0, s3: 70, s4: 180, s5: 285 },
  seed: seed.short01,
  sponsorName: seed.sponsorName,
  endLine: "300 MB · because you're human",
  theme: 'light',
};

export function Short01NoService(p: Short01Props) {
  const shots: Shot[] = [
    {
      id: 'S1',
      from: 0,
      to: 60,
      type: 'REAL OTS',
      clip: 'arrivals',
      ownAudio: true,
      picture:
        'iPhone at chest height, lock screen, status bar No Service (or SOS), real time; BOM T2 arrivals hall soft behind. 2× lens, camera still.',
      mustSee: ['the status word', 'the clock'],
    },
    {
      id: 'S2',
      from: 60,
      to: 130,
      type: 'REAL SR /',
      clip: 'screen01',
      trimBefore: p.screenIn.s2,
      picture:
        "H1 Landing in Mumbai without data?, the unscratched Coupon with 300 MB, pre-flight iPhone · iOS 18 · eSIM ready; thumb taps Prove I'm human → 300 MB.",
      mustSee: ['the live sponsor-bundles line, or no line'],
    },
    {
      id: 'S3',
      from: 130,
      to: 240,
      type: 'REAL SR /verify → World App',
      clip: 'screen01',
      trimBefore: p.screenIn.s3,
      picture:
        "Sheet Prove you're one human; tier ledger; Open World App; World App's own verify sheet; return; Checking · 2 s.",
      mustSee: ["World App's real sheet"],
    },
    {
      id: 'S4',
      from: 240,
      to: 345,
      type: 'REAL SR /plan/[key]',
      clip: 'screen01',
      trimBefore: p.screenIn.s4,
      picture: 'Issuing rows, odometer 0 → 300, usage as of, Expires in … IST.',
      // SCRIPTS.md §2: the one REAL shot with a RENDERED fallback (IssuingSequence).
      fallback: (
        <>
          <UiScreen theme={p.theme}>
            <IssuingSequence
              entitlement={p.seed.entitlement}
              claimTx={p.seed.claimTx}
              sponsorName={p.sponsorName}
            />
          </UiScreen>
          <SeedTag />
        </>
      ),
    },
    {
      id: 'S5',
      from: 345,
      to: 420,
      type: 'REAL SR /install → iOS Settings',
      clip: 'screen01',
      trimBefore: p.screenIn.s5,
      picture:
        'Tap Install eSIM · 2 min; the system cellular sheet; Continue; back to the /install pill Searching… with the determinate ring.',
      mustSee: ['the system cellular sheet'],
    },
    {
      id: 'S6',
      from: 420,
      to: 540,
      type: 'REAL OTS',
      clip: 'lte',
      ownAudio: true,
      picture:
        'Phone held up again. Status bar Searching… → LTE (or 5G). Control Center shows the carrier; the notification shade shows the push.',
      mustSee: ['LTE / 5G', 'the carrier name', 'the push text', 'the clock on both sides of any cut'],
      reference: (
        <div style={{ width: 360, transform: 'scale(2)', transformOrigin: 'top left' }}>
          <NotificationCard {...p.seed.push} />
        </div>
      ),
    },
    {
      id: 'S7',
      from: 540,
      to: 600,
      type: 'RENDERED',
      name: 'EndCard',
      render: <EndCard line={p.endLine} />,
    },
  ];
  return (
    <Frame theme={p.theme}>
      <ShotTrack shots={shots} footage={p.footage} room="room01" />
      <CaptionTrack captions={captionFiles.Short01NoService.captions} flags={{ s6Cut: p.s6Cut }} />
    </Frame>
  );
}
