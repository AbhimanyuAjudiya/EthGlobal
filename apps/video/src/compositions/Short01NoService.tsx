/** Video 01 — "No Service → LTE" (SCRIPTS.md §2). 20.0 s / 600 frames, 1080 × 1920. */
import {
  ShortShell,
  type FootageKey,
  type ScreenKey,
  type ShortBaseProps,
  type Shot,
} from '../scenes';
import { seed } from '../seed';

export const SHORT01_FOOTAGE: readonly FootageKey[] = ['arrivals', 'screen01', 'lte', 'room01'];
export const SHORT01_SCREENS: readonly ScreenKey[] = ['landing', 'verify', 'install-ios'];

export type Short01Props = ShortBaseProps & {
  /** S6 was cut S6a → S6b: show the Chivo Mono elapsed note (SCRIPTS.md §2 S6). */
  s6Cut: boolean;
  /** In-points (frames) of S2–S5 inside the one subject-phone screen recording. */
  screenIn: { s2: number; s3: number; s4: number; s5: number };
  /** In-points (frames) of S2–S5 inside the headless captures (landing, verify, verify, install-ios). */
  headlessIn: { s2: number; s3: number; s4: number; s5: number };
};

export const short01Defaults: Short01Props = {
  footage: {},
  s6Cut: false,
  screens: {},
  screenIn: { s2: 0, s3: 70, s4: 180, s5: 285 },
  headlessIn: { s2: 75, s3: 30, s4: 140, s5: 15 },
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
      screen: { key: 'landing', trimBefore: p.headlessIn.s2 },
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
      // Headless: the product's local-mode "Simulated World ID" stands where World App's own sheet will be.
      screen: { key: 'verify', trimBefore: p.headlessIn.s3 },
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
      // SCRIPTS.md §2 allowed a RENDERED IssuingSequence here; the real /plan issuing rows replace it.
      screen: { key: 'verify', trimBefore: p.headlessIn.s4 },
      picture: 'Issuing rows, odometer 0 → 300, usage as of, Expires in … IST.',
      mustSee: ['the HashScan hash row', 'the Arkiv ent:… row', 'usage as of HH:MM'],
    },
    {
      id: 'S5',
      from: 345,
      to: 420,
      type: 'REAL SR /install → iOS Settings',
      clip: 'screen01',
      trimBefore: p.screenIn.s5,
      screen: { key: 'install-ios', trimBefore: p.headlessIn.s5 },
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
      mustSee: [
        'LTE / 5G',
        'the carrier name',
        `the push text (${seed.short01.push})`,
        'the clock on both sides of any cut',
      ],
    },
  ];
  return (
    <ShortShell
      composition="Short01NoService"
      shots={shots}
      endFrom={540}
      endId="S7"
      room="room01"
      flags={{ s6Cut: p.s6Cut }}
      {...p}
    />
  );
}
