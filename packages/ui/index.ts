/**
 * Typed index of the tokens declared in tokens.css / fonts.css. CSS is the source of truth;
 * tokens.test.ts fails when a name listed here is missing from the stylesheet.
 */

export const surfaceTokens = [
  'bg-canvas',
  'bg-surface',
  'bg-sunken',
  'bg-raised',
  'bg-overlay',
] as const;
export const borderTokens = ['border-subtle', 'border-strong', 'border-input'] as const;
export const textTokens = [
  'text-primary',
  'text-secondary',
  'text-tertiary',
  'text-disabled',
] as const;
export const accentTokens = [
  'accent',
  'accent-hover',
  'accent-subtle',
  'on-accent',
  'focus',
] as const;
export const semanticTokens = [
  'positive',
  'positive-subtle',
  'negative',
  'negative-subtle',
  'warning',
  'warning-subtle',
] as const;
export const seriesTokens = [
  'series-1',
  'series-2',
  'series-3',
  'series-4',
  'series-5',
  'series-6',
] as const;

export const colorTokens = [
  ...surfaceTokens,
  ...borderTokens,
  ...textTokens,
  ...accentTokens,
  ...semanticTokens,
  ...seriesTokens,
] as const;
export type ColorToken = (typeof colorTokens)[number];

export const typeScale = [11, 12, 13, 14, 16, 20, 24, 32, 44, 64] as const;
export type TypeScaleStep = (typeof typeScale)[number];
export const leading = { display: 1.15, text: 1.45, devanagari: 1.6 } as const;

export const typePairings = ['ledger', 'terminal', 'bazaar'] as const;
export type TypePairing = (typeof typePairings)[number];
export const fontTokens = ['font-display', 'font-text', 'font-mono'] as const;
export type FontToken = (typeof fontTokens)[number];

export const themes = ['light', 'dark'] as const;
export type Theme = (typeof themes)[number];

/** Milliseconds / CSS easings, mirrored from tokens.css for JS-driven animation (springs, odometers). */
export const motion = {
  duration: { micro: 100, state: 180, spatialIn: 260, spatialOut: 208, odometerMax: 400 },
  easing: { standard: 'cubic-bezier(0.2, 0, 0, 1)', exit: 'cubic-bezier(0.3, 0, 1, 1)' },
  spring: { stiffness: 400, damping: 35 },
} as const;
export const motionTokens = [
  'duration-micro',
  'duration-state',
  'duration-spatial-in',
  'duration-spatial-out',
  'duration-odometer',
  'ease-standard',
  'ease-exit',
  'spring-stiffness',
  'spring-damping',
] as const;
export type MotionToken = (typeof motionTokens)[number];

export type Token = ColorToken | FontToken | MotionToken | `text-${TypeScaleStep}`;

/** `cssVar('accent')` → `var(--accent)`. */
export function cssVar(token: Token): `var(--${Token})` {
  return `var(--${token})`;
}

/**
 * Onchain action state machine (README.md → "Onchain action states"). The web app implements the
 * component; this is the vocabulary it must use.
 */
export const onchainActionStates = [
  'idle',
  'signing',
  'submitted',
  'pending',
  'confirmed',
  'finalized',
  'failed',
  'replaced',
] as const;
export type OnchainActionState = (typeof onchainActionStates)[number];

export const onchainActionTransitions: Readonly<
  Record<OnchainActionState, readonly OnchainActionState[]>
> = {
  idle: ['signing'],
  signing: ['submitted', 'idle', 'failed'],
  submitted: ['pending', 'failed', 'replaced'],
  pending: ['confirmed', 'failed', 'replaced'],
  confirmed: ['finalized', 'pending'],
  finalized: [],
  failed: ['idle'],
  replaced: [],
};

export function canTransition(from: OnchainActionState, to: OnchainActionState): boolean {
  return onchainActionTransitions[from].includes(to);
}
