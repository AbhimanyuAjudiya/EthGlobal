/**
 * The frame every vertical short shares: Frame (theme, fonts guard), the shot table, the RENDERED end card
 * (one line and the name, SCRIPTS.md §7 #9) on the final frames, and the caption track mounted in the safe
 * area. Each short passes only its own shots, captions and flags.
 */
import { useVideoConfig } from 'remotion';

import { captionFiles, CaptionTrack, type CaptionedComposition } from '../captions';
import { EndCard } from './EndCard';
import { Frame } from '../components/Frame';
import { ShotTrack, type Shot } from '../components/ShotTrack';
import {
  type FootageAvailability,
  type FootageKey,
  type ScreenAvailability,
} from '../footage/manifest';

// Remotion composition props must be a type alias (an interface does not satisfy Record<string, unknown>).
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type ShortBaseProps = {
  footage: FootageAvailability;
  /** Headless captures of the PWA present for `theme` (calculateMetadata). */
  screens: ScreenAvailability;
  endLine: string;
  theme: 'light' | 'dark';
};

export function ShortShell({
  composition,
  shots,
  endFrom,
  endId,
  footage,
  screens,
  endLine,
  theme,
  room,
  flags,
}: ShortBaseProps & {
  composition: CaptionedComposition;
  shots: readonly Shot[];
  /** First frame of the end card. */
  endFrom: number;
  /** Shot id of the end card in the SCRIPTS.md table (e.g. "S7"). */
  endId: string;
  room?: FootageKey;
  flags?: Readonly<Record<string, boolean>>;
}) {
  const { durationInFrames } = useVideoConfig();
  const all: Shot[] = [
    ...shots,
    {
      id: endId,
      from: endFrom,
      to: durationInFrames,
      type: 'RENDERED',
      name: 'EndCard',
      render: <EndCard line={endLine} />,
    },
  ];
  return (
    <Frame theme={theme}>
      <ShotTrack
        shots={all}
        sources={{ footage, screens, theme }}
        {...(room ? { room } : {})}
      />
      <CaptionTrack captions={captionFiles[composition].captions} {...(flags ? { flags } : {})} />
    </Frame>
  );
}
