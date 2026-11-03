/**
 * A real capture as a video layer (SCRIPTS.md §8 "Real footage"), or its fallback when the file is absent.
 * `available` comes from calculateMetadata's probe, so a render never requests a missing file.
 */
import { type ReactNode } from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile } from 'remotion';

import { footagePath, type FootageAvailability, type FootageKey } from '../footage/manifest';

import { PlaceholderSlate, type SlateInfo } from './PlaceholderSlate';

export function Footage({
  clip,
  available,
  trimBefore = 0,
  muted = true,
  info,
  fallback,
  reference,
}: {
  clip: FootageKey;
  available: FootageAvailability;
  /** In-point inside the clip, in frames (Remotion ≥ 4.0.319 name). */
  trimBefore?: number;
  muted?: boolean;
  info: SlateInfo;
  /** A RENDERED fallback seeded with real values (e.g. IssuingSequence); used instead of the slate. */
  fallback?: ReactNode;
  /** Reference shown inside the slate (e.g. the expected push copy). */
  reference?: ReactNode;
}) {
  if (available[clip]) {
    return (
      <AbsoluteFill>
        <OffthreadVideo
          src={staticFile(footagePath(clip))}
          trimBefore={trimBefore}
          muted={muted}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </AbsoluteFill>
    );
  }
  if (fallback) return <AbsoluteFill>{fallback}</AbsoluteFill>;
  return (
    <PlaceholderSlate clip={clip} info={info}>
      {reference}
    </PlaceholderSlate>
  );
}
