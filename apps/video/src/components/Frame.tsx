/**
 * Root of every composition (SCRIPTS.md §8): the product's data-type, theme and colour-scheme, so tokens,
 * fonts and light-dark() resolve exactly as in the PWA. Holds the render until the self-hosted faces are
 * loaded and the font guard passes; a failed guard cancels the render.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { AbsoluteFill, cancelRender, continueRender, delayRender } from 'remotion';

import { loadFonts } from '../fonts/load-fonts';
import { v } from '../theme';
import '../styles/video.css';

export type Theme = 'light' | 'dark';

export function Frame({
  theme = 'light',
  children,
  style,
}: {
  theme?: Theme;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const [handle] = useState(() => delayRender('fonts: Anek Devanagari, Chivo Mono, Baloo 2'));
  useEffect(() => {
    loadFonts().then(
      (report) => {
        // Visible in the render log with --log=verbose; scripts/font-proof.sh reads it from the probe still.
        console.log(`font guard ok: ${report.checks.map((c) => c.family).join(', ')}`);
        continueRender(handle);
      },
      (err: unknown) => cancelRender(err),
    );
  }, [handle]);

  return (
    <AbsoluteFill
      data-type="bazaar"
      data-theme={theme}
      lang="en"
      style={{
        background: v.canvas,
        color: v.text,
        colorScheme: theme,
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}
