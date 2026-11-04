/**
 * Stand-in for a REAL capture that is not in footage/ yet. It must never be mistaken for footage: a dark
 * slate, a dashed frame, and the word PLACEHOLDER in Chivo Mono, with the capture brief for the shot so the
 * editor and the shooter read the same thing. A seeded reference (e.g. the push copy) may sit inside it;
 * it is still labelled as a placeholder.
 */
import { type ReactNode } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

import { v } from '../theme';
import { usePaneSize } from './pane';

export interface SlateInfo {
  shot: string;
  type: string;
  /** e.g. "0.0–2.0 s". */
  time: string;
  picture: string;
  mustSee?: readonly string[];
}

export function PlaceholderSlate({
  file,
  info,
  children,
}: {
  /** The capture this slate stands in for, relative to footage/. */
  file: string;
  info: SlateInfo;
  children?: ReactNode;
}) {
  const frame = useCurrentFrame();
  const { width, height } = usePaneSize();
  // Scale type to the slate's own frame: full 1080 × 1920, or a judge-video pane.
  const unit = Math.min(width, height) / 1080;
  const pad = 64 * unit;
  return (
    <AbsoluteFill
      style={{
        colorScheme: 'dark',
        background: v.sunken,
        color: v.textSecondary,
        border: `${Math.max(2, 6 * unit)}px dashed ${v.borderStrong}`,
        padding: pad,
        // Portrait: start below the hook-caption band (y ≈ 380–520) so captions never sit on slate text.
        paddingTop: height > width ? 560 * unit : pad,
        display: 'flex',
        flexDirection: 'column',
        gap: 24 * unit,
      }}
    >
      <div className="mono" style={{ fontSize: 36 * unit, color: v.text, letterSpacing: 0 }}>
        PLACEHOLDER · REAL capture missing
      </div>
      <div className="mono" style={{ fontSize: 28 * unit }}>
        {info.shot} · {info.type} · {info.time}
      </div>
      <div className="mono" style={{ fontSize: 28 * unit, color: v.text }}>
        footage/{file}
      </div>
      <div style={{ fontSize: 32 * unit, lineHeight: 1.35, maxWidth: 900 * unit }}>
        {info.picture}
      </div>
      {info.mustSee && info.mustSee.length > 0 ? (
        <div style={{ fontSize: 26 * unit, lineHeight: 1.4 }}>
          Must be visible: {info.mustSee.join(' · ')}
        </div>
      ) : null}
      {children ? <div style={{ marginTop: 24 * unit }}>{children}</div> : null}
      <div
        className="mono"
        style={{ position: 'absolute', right: pad, bottom: pad, fontSize: 24 * unit }}
      >
        f{frame}
      </div>
    </AbsoluteFill>
  );
}
