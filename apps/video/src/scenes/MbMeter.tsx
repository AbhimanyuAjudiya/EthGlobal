/**
 * The plan meter (DECISION §8.5 #4, Revolut): remaining MB as a filled bar. It fills once over 9 frames,
 * standard easing, then never moves on a data tick. Fill is the accent; at ≥ 80 % used it is the warning hue.
 * CSS px; meant to sit inside UiScreen. Animated with transform (scaleX), not width.
 */
import { interpolate, useCurrentFrame } from 'remotion';

import { ease, v } from '../theme';

export const METER_FILL_FRAMES = 9;

export function MbMeter({
  fromFraction = 0,
  toFraction,
  start,
  height = 8,
}: {
  /** Remaining fraction before the change (0 for a new plan). */
  fromFraction?: number;
  /** Remaining fraction after the change. */
  toFraction: number;
  /** Frame the fill starts, relative to the enclosing Sequence. */
  start: number;
  height?: number;
}) {
  const frame = useCurrentFrame();
  const fraction = interpolate(
    frame,
    [start, start + METER_FILL_FRAMES],
    [fromFraction, toFraction],
    { easing: ease.standard, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const low = toFraction <= 0.2;
  return (
    <div
      role="meter"
      aria-valuenow={Math.round(toFraction * 100)}
      style={{
        position: 'relative',
        height,
        background: v.sunken,
        border: `1px solid ${v.borderSubtle}`,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: low ? v.warning : v.accent,
          transform: `scaleX(${fraction})`,
          transformOrigin: 'left center',
        }}
      />
    </div>
  );
}

/** "usage as of 14:02" — printed on every balance (DECISION §8.2). */
export function UsageAsOf({ time, simulated = false }: { time: string; simulated?: boolean }) {
  return (
    <div style={{ fontSize: 12, color: v.textTertiary }}>
      {simulated ? 'simulated usage · ' : ''}usage as of <span className="mono">{time}</span>
    </div>
  );
}
