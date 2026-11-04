/**
 * A real capture as a video layer (SCRIPTS.md §8 "Real footage"). Order of preference: the human team's capture
 * (`clip`), else the headless recording of the same route in the real PWA (`screen`, labelled SEED DATA when it
 * shows local-stack hashes/keys/PINs), else a labelled placeholder slate. Availability comes from
 * calculateMetadata's probe, so a render never requests a missing file.
 */
import { type ReactNode } from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile } from 'remotion';

import {
  FOOTAGE,
  footagePath,
  SCREENS,
  screenFile,
  screenPath,
  type FootageAvailability,
  type FootageKey,
  type ScreenAvailability,
  type ScreenKey,
  type ScreenTheme,
} from '../footage/manifest';
import { PlaceholderSlate, type SlateInfo } from './PlaceholderSlate';
import { SeedTag } from './SeedTag';

export interface ScreenUse {
  key: ScreenKey;
  /** In-point inside the headless capture, in frames. */
  trimBefore?: number;
}

export interface FootageSources {
  footage: FootageAvailability;
  screens: ScreenAvailability;
  theme: ScreenTheme;
}

function Clip({ src, trimBefore, muted }: { src: string; trimBefore: number; muted: boolean }) {
  return (
    <AbsoluteFill>
      <OffthreadVideo
        src={staticFile(src)}
        trimBefore={trimBefore}
        muted={muted}
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
      />
    </AbsoluteFill>
  );
}

export function Footage({
  clip,
  screen,
  sources,
  trimBefore = 0,
  muted = true,
  info,
  children,
}: {
  clip?: FootageKey;
  screen?: ScreenUse;
  sources: FootageSources;
  /** In-point inside the human clip, in frames (Remotion ≥ 4.0.319 name). */
  trimBefore?: number;
  muted?: boolean;
  info: SlateInfo;
  /** Shown inside the slate only (e.g. the expected push copy). */
  children?: ReactNode;
}) {
  if (clip && sources.footage[clip]) {
    return <Clip src={footagePath(clip)} trimBefore={trimBefore} muted={muted} />;
  }
  if (screen && sources.screens[screen.key]) {
    return (
      <>
        <Clip
          src={screenPath(screen.key, sources.theme)}
          trimBefore={screen.trimBefore ?? 0}
          muted
        />
        {SCREENS[screen.key].showsSeed ? <SeedTag /> : null}
      </>
    );
  }
  const file = clip ? FOOTAGE[clip].file : screen ? screenFile(screen.key, sources.theme) : '—';
  return (
    <PlaceholderSlate file={file} info={info}>
      {children}
    </PlaceholderSlate>
  );
}
