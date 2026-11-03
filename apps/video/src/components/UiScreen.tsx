/**
 * The PWA's narrowest layout, 360 × 640 CSS px, scaled to the pane by an integer-friendly factor (3× fills
 * 1080 × 1920; 1.6875× fills the judge video's 608 × 1080 PhoneInset). Full-bleed: no bezel, no notch, no
 * device mockup (design-references.md §7 #11).
 */
import { type ReactNode } from 'react';
import { AbsoluteFill } from 'remotion';

import { v } from '../theme';

import { usePaneSize } from './pane';

export const SCREEN = { width: 360, height: 640 } as const;

export function UiScreen({ children, theme }: { children: ReactNode; theme?: 'light' | 'dark' }) {
  const { width } = usePaneSize();
  const scale = width / SCREEN.width;
  return (
    <AbsoluteFill style={{ background: v.canvas }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: SCREEN.width,
          height: SCREEN.height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          background: v.canvas,
          color: v.text,
          overflow: 'hidden',
          ...(theme ? { colorScheme: theme } : {}),
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
}
