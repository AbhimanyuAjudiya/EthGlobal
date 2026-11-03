/**
 * The one permitted flourish (design-foundations.md §6): the hero number rolls once over 400 ms (12 frames)
 * with --ease-standard, digit columns translating, then stops. Transform and opacity only.
 */
import { interpolate, useCurrentFrame } from 'remotion';

import { ease, frames } from '../theme';

export function Odometer({
  value,
  from: start,
  fontSize,
  lineHeight = 1,
}: {
  value: number;
  /** Frame the roll starts (relative to the enclosing Sequence). */
  from: number;
  fontSize: number;
  lineHeight?: number;
}) {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [start, start + frames.odometer], [0, 1], {
    easing: ease.standard,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const digits = String(Math.round(value)).split('').map(Number);
  const cell = fontSize * lineHeight;
  return (
    <span
      className="num"
      style={{ display: 'inline-flex', height: cell, overflow: 'hidden', lineHeight }}
      aria-label={String(value)}
    >
      {digits.map((d, i) => {
        const leading = i < digits.length - 1;
        const roll = progress * d;
        // A leading column that has not left 0 yet is not drawn, so the start state reads "0", not "000".
        const opacity = leading ? interpolate(roll, [0, 0.2], [0, 1], { extrapolateRight: 'clamp' }) : 1;
        return (
          <span
            key={i}
            style={{
              display: 'inline-flex',
              flexDirection: 'column',
              transform: `translateY(${-roll * cell}px)`,
              opacity,
            }}
          >
            {Array.from({ length: 10 }, (_, n) => (
              <span key={n} style={{ height: cell }}>
                {n}
              </span>
            ))}
          </span>
        );
      })}
    </span>
  );
}
