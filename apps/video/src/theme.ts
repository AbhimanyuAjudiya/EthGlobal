/**
 * The product's motion and type values, translated into frames for a 30 fps render.
 * Durations and easings come from @ethglobal/ui (mirrors tokens.css); nothing here invents a value.
 * Colours are never restated in TS: components reference the CSS custom properties from tokens.css.
 */
import { motion } from '@ethglobal/ui';
import { Easing } from 'remotion';

export const FPS = 30;

/** Milliseconds → whole frames at 30 fps (100 ms → 3, 260 ms → 8, 400 ms → 12). */
export function msToFrames(ms: number): number {
  return Math.round((ms / 1000) * FPS);
}

function bezierFromCss(css: string): (t: number) => number {
  const match = /cubic-bezier\(([^)]+)\)/.exec(css);
  const parts = match?.[1]?.split(',').map((n) => Number(n.trim())) ?? [];
  const [x1, y1, x2, y2] = parts;
  if (
    parts.length !== 4 ||
    x1 === undefined ||
    y1 === undefined ||
    x2 === undefined ||
    y2 === undefined
  ) {
    throw new Error(`theme: cannot parse easing ${css}`);
  }
  return Easing.bezier(x1, y1, x2, y2);
}

/** --ease-standard and --ease-exit. There is no bounce, overshoot or spring anywhere in the video package. */
export const ease = {
  standard: bezierFromCss(motion.easing.standard),
  exit: bezierFromCss(motion.easing.exit),
} as const;

export const frames = {
  /** Caption dissolve in/out (100 ms). */
  dissolve: msToFrames(motion.duration.micro),
  /** Row colour change (180 ms state change → 5 frames). */
  state: msToFrames(motion.duration.state),
  /** Sheet/card entry (260 ms). */
  spatialIn: msToFrames(motion.duration.spatialIn),
  /** Odometer, the one permitted flourish (400 ms). */
  odometer: msToFrames(motion.duration.odometerMax),
  /** End-of-video audio fade. */
  endFade: 4,
} as const;

/** CSS custom properties from packages/ui/tokens.css, referenced by name only. */
export const v = {
  canvas: 'var(--bg-canvas)',
  surface: 'var(--bg-surface)',
  sunken: 'var(--bg-sunken)',
  raised: 'var(--bg-raised)',
  borderSubtle: 'var(--border-subtle)',
  borderStrong: 'var(--border-strong)',
  borderInput: 'var(--border-input)',
  text: 'var(--text-primary)',
  textSecondary: 'var(--text-secondary)',
  textTertiary: 'var(--text-tertiary)',
  accent: 'var(--accent)',
  onAccent: 'var(--on-accent)',
  accentSubtle: 'var(--accent-subtle)',
  warning: 'var(--warning)',
  fontDisplay: 'var(--font-display)',
  fontText: 'var(--font-text)',
  fontMono: 'var(--font-mono)',
} as const;

/** Variation settings used by the product (DECISION §8.3). */
export const variation = {
  headline: "'wdth' 110, 'wght' 700",
  hook: "'wdth' 100, 'wght' 700",
  body: "'wdth' 100, 'wght' 500",
  bodyRegular: "'wdth' 100, 'wght' 400",
} as const;

export const numeric = "'tnum', 'zero'";

/** Safe zones for 1080 × 1920 (SCRIPTS.md §1). */
export const safe = {
  top: 250,
  bottom: 420,
  x: 64,
  maxWidth: 952,
  hookY: 440,
  lowerY: 1380,
  statusBar: 160,
} as const;
