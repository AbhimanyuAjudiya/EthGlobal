/**
 * Native-style burned-in captions (SCRIPTS.md §1, §8 "Captions"). Each entry is a Sequence whose opacity
 * dissolves in over 3 frames with --ease-standard and out over 3 with --ease-exit. Opacity only: nothing
 * scales, slides, bounces or types itself, and there is no word-by-word highlight.
 */
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from 'remotion';

import { ease, frames, numeric, safe, v, variation } from '../theme';

import type { Caption, CaptionStyle } from './types';

/** Shadow for over-footage text: 1 px, 60 % black (SCRIPTS.md §1). Not a glow: zero blur. */
const FOOTAGE_SHADOW = '0 1px 0 rgb(0 0 0 / 0.6)';

const STYLE: Record<CaptionStyle, CSSProperties> = {
  hook: {
    top: safe.hookY - 60,
    fontSize: 60,
    lineHeight: 1.15,
    fontVariationSettings: variation.hook,
    color: v.canvas,
    textShadow: FOOTAGE_SHADOW,
    colorScheme: 'light',
  },
  footage: {
    top: safe.lowerY,
    fontSize: 48,
    lineHeight: 1.2,
    fontVariationSettings: variation.body,
    color: v.canvas,
    textShadow: FOOTAGE_SHADOW,
    whiteSpace: 'nowrap',
    colorScheme: 'light',
  },
  ui: {
    top: safe.lowerY,
    fontSize: 48,
    lineHeight: 1.2,
    fontVariationSettings: variation.body,
    whiteSpace: 'nowrap',
  },
  note: {
    top: safe.lowerY,
    fontSize: 36,
    lineHeight: 1.2,
    color: v.canvas,
    textShadow: FOOTAGE_SHADOW,
    colorScheme: 'light',
  },
};

/** Splits `text` so the listed substrings render in Chivo Mono with tabular, slashed-zero figures. */
export function withMono(text: string, mono: readonly string[] = []): ReactNode[] {
  if (mono.length === 0) return [text];
  const escaped = mono.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(${escaped.join('|')})`));
  return parts.map((part, i) =>
    mono.includes(part) ? (
      <span key={i} className="mono" style={{ fontFeatureSettings: numeric }}>
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function CaptionLine({ caption }: { caption: Caption }) {
  const frame = useCurrentFrame();
  const dur = caption.to - caption.from;
  const d = frames.dissolve;
  const opacity =
    frame < d
      ? interpolate(frame, [0, d], [0, 1], { easing: ease.standard, extrapolateRight: 'clamp' })
      : interpolate(frame, [dur - d, dur], [1, 0], {
          easing: ease.exit,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
  const isUi = caption.style === 'ui';
  const text = (
    <span lang={caption.lang} style={caption.lang === 'hi' ? { lineHeight: 1.6 } : undefined}>
      {withMono(caption.text, caption.mono)}
    </span>
  );
  return (
    <AbsoluteFill style={{ opacity, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: safe.x,
          maxWidth: safe.maxWidth,
          ...STYLE[caption.style],
        }}
        className={caption.style === 'note' ? 'mono' : undefined}
      >
        {isUi ? (
          <div
            style={{
              display: 'inline-block',
              background: v.sunken,
              color: v.text,
              border: `3px solid ${v.borderSubtle}`,
              padding: '24px 36px',
            }}
          >
            {text}
          </div>
        ) : (
          text
        )}
      </div>
    </AbsoluteFill>
  );
}

function isVisible(c: Caption, flags: Readonly<Record<string, boolean>>): boolean {
  if (!c.when) return true;
  return c.when.startsWith('!') ? !flags[c.when.slice(1)] : Boolean(flags[c.when]);
}

export function CaptionTrack({
  captions,
  flags = {},
}: {
  captions: readonly Caption[];
  flags?: Readonly<Record<string, boolean>>;
}) {
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {captions
        .filter((c) => isVisible(c, flags))
        .map((c) => (
          <Sequence
            key={`${c.from}-${c.text}`}
            from={c.from}
            durationInFrames={c.to - c.from}
            layout="none"
            name={`caption: ${c.text}`}
          >
            <CaptionLine caption={c} />
          </Sequence>
        ))}
    </AbsoluteFill>
  );
}
