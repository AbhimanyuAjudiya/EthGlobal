/**
 * A video as its shot table (SCRIPTS.md §2–§6): every shot is a Sequence on a hard cut. REAL shots play the
 * human capture, else the headless recording of the same route (`screen`), else a labelled placeholder slate.
 * SCREEN shots were RENDERED look-alikes and are now the headless recording of the real PWA. RENDERED shots
 * draw a scene (end cards only). Room sound: a continuous NN-room.wav when present (then every clip is muted),
 * else the OTS clips carry their own camera-phone audio and screen recordings stay muted.
 */
import { type ReactNode } from 'react';
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useVideoConfig } from 'remotion';

import { footagePath, type FootageKey } from '../footage/manifest';
import { FPS, frames } from '../theme';
import { Footage, type FootageSources, type ScreenUse } from './Footage';

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
  /** The headless capture of the same route, used until the human capture exists. */
  screen?: ScreenUse;
  picture: string;
  mustSee?: readonly string[];
}

export interface ScreenShot extends ShotBase {
  type: 'SCREEN';
  screen: ScreenUse;
  picture: string;
}

export interface RenderedShot extends ShotBase {
  type: 'RENDERED';
  name: string;
  render: ReactNode;
}

export type Shot = RealShot | ScreenShot | RenderedShot;

const seconds = (f: number) => (f / FPS).toFixed(1);

function shotName(shot: Shot): string {
  switch (shot.type) {
    case 'RENDERED':
      return shot.name;
    case 'SCREEN':
      return `screen/${shot.screen.key}`;
    default:
      return shot.clip;
  }
}

export function ShotTrack({
  shots,
  sources,
  room,
}: {
  shots: readonly Shot[];
  sources: FootageSources;
  room?: FootageKey;
}) {
  const roomPresent = room !== undefined && Boolean(sources.footage[room]);
  return (
    <AbsoluteFill>
      {shots.map((shot) => (
        <Sequence
          key={shot.id}
          from={shot.from}
          durationInFrames={shot.to - shot.from}
          name={`${shot.id} ${shotName(shot)}`}
        >
          {shot.type === 'RENDERED' ? (
            shot.render
          ) : (
            <Footage
              {...(shot.type === 'SCREEN' ? {} : { clip: shot.clip })}
              {...(shot.screen ? { screen: shot.screen } : {})}
              sources={sources}
              trimBefore={shot.type === 'SCREEN' ? 0 : (shot.trimBefore ?? 0)}
              muted={roomPresent || shot.type === 'SCREEN' || !shot.ownAudio}
              info={{
                shot: shot.id,
                type: shot.type,
                time: `${seconds(shot.from)}–${seconds(shot.to)} s`,
                picture: shot.picture,
                ...(shot.type !== 'SCREEN' && shot.mustSee ? { mustSee: shot.mustSee } : {}),
              }}
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
