/**
 * One line of display type: Anek Devanagari, `wdth 110 / wght 700` by default (DECISION §8.3). Used by the
 * end cards and the judge video's rendered panes. Revealed as a block (opacity over 3 frames), never typed.
 */
import { type CSSProperties } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

import { ease, frames, variation } from '../theme';

export function Title({
  children,
  size = 64,
  weight = 'headline',
  revealAt,
  style,
  lang = 'en',
}: {
  children: string;
  size?: number;
  weight?: keyof typeof variation;
  /** Frame to dissolve in from; omit for a still. */
  revealAt?: number;
  style?: CSSProperties;
  lang?: 'en' | 'hi';
}) {
  const frame = useCurrentFrame();
  const opacity =
    revealAt === undefined
      ? 1
      : interpolate(frame, [revealAt, revealAt + frames.dissolve], [0, 1], {
          easing: ease.standard,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
  return (
    <div
      lang={lang}
      className="num"
      style={{
        fontSize: size,
        lineHeight: lang === 'hi' ? 1.6 : 1.15,
        fontVariationSettings: variation[weight],
        opacity,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
