/**
 * Rendered panes of the judge video (SCRIPTS.md §6): ChapterRail, PathLabel, MechanismPanes, and the
 * line lists TierTable, ThreeReads and ThreeLines. Paper canvas, Anek for words, Chivo Mono for paths.
 * Sizes are CSS px multiplied by the judge layout scale `s` (JudgeVideo.tsx), so "12 px" stays 12 px of a
 * 960 px-wide laptop viewport at 2×.
 */
import { AbsoluteFill, useCurrentFrame } from 'remotion';

import { v } from '../theme';
import { useEntry } from './Receipt';
import { Title } from './Title';

export interface Chapter {
  label: string;
  /** "0:30". */
  time: string;
  from: number;
}

export function ChapterRail({ chapters, s }: { chapters: readonly Chapter[]; s: number }) {
  const frame = useCurrentFrame();
  const current = [...chapters].reverse().find((c) => frame >= c.from);
  return (
    <div
      className="mono"
      style={{
        position: 'absolute',
        top: 24,
        left: 120,
        fontSize: 12 * s,
        display: 'flex',
        gap: 8 * s,
        color: v.textTertiary,
      }}
    >
      {chapters.map((c, i) => (
        <span key={c.label} style={{ color: c === current ? v.text : undefined }}>
          {c.label} {c.time}
          {i < chapters.length - 1 ? ' ·' : ''}
        </span>
      ))}
    </div>
  );
}

/** A lower-third label: the one sentence in Anek, or a file path / formula in Chivo Mono. */
export function PathLabel({
  children,
  mono = false,
  s,
  revealAt = 0,
}: {
  children: string;
  mono?: boolean;
  s: number;
  revealAt?: number;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 120,
        right: 120,
        bottom: 48,
        background: v.sunken,
        border: `1px solid ${v.borderSubtle}`,
        padding: `${8 * s}px ${12 * s}px`,
      }}
    >
      {mono ? (
        <div className="mono" style={{ fontSize: 14 * s }}>
          {children}
        </div>
      ) : (
        <Title size={16 * s} weight="body" revealAt={revealAt}>
          {children}
        </Title>
      )}
    </div>
  );
}

function PaneCard({ head, line, enterAt }: { head: string; line: string; enterAt: number }) {
  const entry = useEntry(enterAt);
  return (
    <div
      style={{
        ...entry,
        flex: 1,
        background: v.surface,
        border: `1px solid ${v.borderSubtle}`,
        padding: 32,
      }}
    >
      <Title size={44} style={{ marginBottom: 16 }}>
        {head}
      </Title>
      <div style={{ fontSize: 32, lineHeight: 1.35, color: v.textSecondary }}>{line}</div>
    </div>
  );
}

export interface MechanismPane {
  head: string;
  line: string;
}

/** identity · World → money · Hedera → entitlement · Arkiv, entering 24 frames apart, then still. */
export function MechanismPanes({
  panes,
  strip,
  s,
}: {
  panes: readonly MechanismPane[];
  strip: string;
  s: number;
}) {
  return (
    <AbsoluteFill style={{ background: v.canvas, padding: '160px 120px 120px' }}>
      <div style={{ display: 'flex', gap: 48, alignItems: 'stretch' }}>
        {panes.map((p, i) => (
          <PaneCard key={p.head} head={p.head} line={p.line} enterAt={i * 24} />
        ))}
      </div>
      <div
        className="mono"
        style={{
          position: 'absolute',
          left: 120,
          bottom: 120,
          fontSize: 12 * s,
          color: v.textSecondary,
          borderTop: `1px solid ${v.borderSubtle}`,
          paddingTop: 12,
        }}
      >
        {strip}
      </div>
    </AbsoluteFill>
  );
}

export interface PaneLine {
  text: string;
  /** Optional file path shown under the line in Chivo Mono. */
  path?: string;
}

/** TierTable / ThreeReads / ThreeLines: ruled lines on paper, each entering 12 frames after the last. */
export function LinesPane({
  lines,
  s,
  size = 22,
}: {
  lines: readonly PaneLine[];
  s: number;
  size?: number;
}) {
  return (
    <AbsoluteFill style={{ background: v.canvas, padding: '180px 120px', gap: 0 }}>
      {lines.map((l, i) => (
        <Line key={l.text} line={l} enterAt={i * 12} s={s} size={size} />
      ))}
    </AbsoluteFill>
  );
}

function Line({
  line,
  enterAt,
  s,
  size,
}: {
  line: PaneLine;
  enterAt: number;
  s: number;
  size: number;
}) {
  const entry = useEntry(enterAt);
  return (
    <div
      style={{ ...entry, padding: `${12 * s}px 0`, borderBottom: `1px solid ${v.borderSubtle}` }}
    >
      <Title size={size * s} weight="body">
        {line.text}
      </Title>
      {line.path ? (
        <div
          className="mono"
          style={{ marginTop: 4 * s, fontSize: 12 * s, color: v.textSecondary }}
        >
          {line.path}
        </div>
      ) : null}
    </div>
  );
}
