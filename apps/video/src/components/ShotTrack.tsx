/**
 * A video as its shot table (SCRIPTS.md §2–§6): every shot is a Sequence on a hard cut. REAL shots play the
 * conformed capture or fall back to a seeded RENDERED stand-in or a labelled placeholder slate; RENDERED
 * shots draw a scene. Room sound: a continuous NN-room.wav when present (then every clip is muted), else the
 * OTS clips carry their own camera-phone audio and screen recordings stay muted.
 */
import { type ReactNode } from 'react';
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useVideoConfig } from 'remotion';

import { footagePath, type FootageAvailability, type FootageKey } from '../footage/manifest';
import { FPS, frames } from '../theme';
import { Footage } from './Footage';

interface ShotBase {
  id: string;
  from: number;
  to: number;
}

export interface RealShot extends ShotBase {
  type: `REAL ${string}`;
  clip: FootageKey;
  /** In-point inside the clip, in frames. */
  trimBefore?: number;
  /** OTS/macro clips carry the room; screen recordings do not. */
  ownAudio?: boolean;
  picture: string;
  mustSee?: readonly string[];
  fallback?: ReactNode;
  reference?: ReactNode;
}

export interface RenderedShot extends ShotBase {
  type: 'RENDERED';
  name: string;
  render: ReactNode;
}

export type Shot = RealShot | RenderedShot;

const seconds = (f: number) => (f / FPS).toFixed(1);

export function ShotTrack({
  shots,
  footage,
  room,
}: {
  shots: readonly Shot[];
  footage: FootageAvailability;
  room?: FootageKey;
}) {
  const roomPresent = room !== undefined && Boolean(footage[room]);
  return (
    <AbsoluteFill>
      {shots.map((shot) => (
        <Sequence
          key={shot.id}
          from={shot.from}
          durationInFrames={shot.to - shot.from}
          name={`${shot.id} ${shot.type === 'RENDERED' ? shot.name : shot.clip}`}
        >
          {shot.type === 'RENDERED' ? (
            shot.render
          ) : (
            <Footage
              clip={shot.clip}
              available={footage}
              trimBefore={shot.trimBefore ?? 0}
              muted={roomPresent || !shot.ownAudio}
              info={{
                shot: shot.id,
                type: shot.type,
                time: `${seconds(shot.from)}–${seconds(shot.to)} s`,
                picture: shot.picture,
                ...(shot.mustSee ? { mustSee: shot.mustSee } : {}),
              }}
              fallback={shot.fallback}
              reference={shot.reference}
            />
          )}
        </Sequence>
      ))}
      {roomPresent ? <RoomTrack clip={room} /> : null}
    </AbsoluteFill>
  );
}

/** The continuous room track, with the 4-frame fade at the very end so the end card never clicks. */
export function RoomTrack({ clip }: { clip: FootageKey }) {
  const { durationInFrames } = useVideoConfig();
  return (
    <Audio
      src={staticFile(footagePath(clip))}
      volume={(f) =>
        interpolate(f, [durationInFrames - frames.endFade, durationInFrames], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      }
    />
  );
}
