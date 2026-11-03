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
  const shown = progress * value;
  return (
    <span className="num" style={{ display: 'inline-flex', lineHeight }} aria-label={String(value)}>
      {digits.map((d, i) => {
        const place = 10 ** (digits.length - 1 - i);
        // A leading column is drawn once the rolling value reaches its place, so the start reads "0", not "000".
        const opacity =
          place === 1
            ? 1
            : interpolate(shown, [place * 0.5, place], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              });
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              height: cell,
              overflow: 'hidden',
              clipPath: 'inset(0)',
              opacity,
            }}
          >
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                transform: `translateY(${-progress * d * cell}px)`,
              }}
            >
              {Array.from({ length: 10 }, (_, n) => (
                <span key={n} style={{ display: 'block', height: cell, lineHeight: `${cell}px` }}>
                  {n}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
