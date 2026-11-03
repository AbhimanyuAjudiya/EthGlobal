/**
 * QA probe for the font guard (SCRIPTS.md §8 QA #3). Draws known glyphs — Latin, a slashed zero, ₹, and
 * Devanagari — in the product faces (`mode: 'product'`) or in the generic fallbacks (`mode: 'fallback'`).
 * scripts/font-proof.sh renders both as stills and compares pixel hashes; `mode: 'sabotage'` asks the guard
 * to accept a family that is not registered, and the render must fail.
 */
import { useEffect, useState } from 'react';
import { AbsoluteFill, cancelRender, continueRender, delayRender } from 'remotion';

import { Frame } from '../components/Frame';
import { assertFacePaints, fontGuard, loadFonts, type FontGuardReport } from '../fonts/load-fonts';
import { v } from '../theme';

// Remotion composition props must be a type alias (an interface does not satisfy Record<string, unknown>).
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type FontProbeProps = { mode: 'product' | 'fallback' | 'sabotage' };

const SAMPLES = [
  { text: 'Recharge 300 MB ₹0', product: "'Anek Devanagari'", fallback: 'serif', size: 72 },
  { text: 'क्योंकि आप इंसान हैं', product: "'Anek Devanagari'", fallback: 'sans-serif', size: 64 },
  { text: '0x1a2b 4821 9930', product: "'Chivo Mono'", fallback: 'monospace', size: 64 },
  { text: 'यहाँ रगड़ें', product: "'Baloo 2'", fallback: 'serif', size: 64 },
] as const;

function Report() {
  const [report, setReport] = useState<FontGuardReport | null>(null);
  const [handle] = useState(() => delayRender('font probe report'));
  useEffect(() => {
    loadFonts().then(
      () => {
        setReport(fontGuard());
        continueRender(handle);
      },
      (err: unknown) => cancelRender(err),
    );
  }, [handle]);
  if (!report) return null;
  return (
    <div className="mono" style={{ fontSize: 28, color: v.textSecondary, lineHeight: 1.5 }}>
      {report.checks.map((c) => (
        <div key={c.text}>
          {c.family}: loaded {c.loaded ? 'yes' : 'NO'} · paints{' '}
          {c.differsFromFallback ? 'yes' : 'NO'}
        </div>
      ))}
    </div>
  );
}

function Sabotage() {
  const [handle] = useState(() => delayRender('font probe sabotage'));
  useEffect(() => {
    loadFonts().then(
      () => {
        try {
          assertFacePaints('Anek Devanagari Missing', '700', 'Recharge');
          continueRender(handle);
        } catch (err) {
          cancelRender(err);
        }
      },
      (err: unknown) => cancelRender(err),
    );
  }, [handle]);
  return null;
}

export function FontProbe({ mode }: FontProbeProps) {
  return (
    <Frame>
      <AbsoluteFill style={{ padding: 64, gap: 16 }}>
        {SAMPLES.map((s) => (
          <div
            key={s.text}
            lang={/[ऀ-ॿ]/.test(s.text) ? 'hi' : 'en'}
            style={{
              fontFamily: mode === 'fallback' ? s.fallback : s.product,
              fontSize: s.size,
              lineHeight: 1.6,
              fontVariationSettings: "'wdth' 100, 'wght' 700",
              fontWeight: 700,
              fontFeatureSettings: "'tnum', 'zero'",
            }}
          >
            {s.text}
          </div>
        ))}
        {mode === 'product' ? <Report /> : null}
        {mode === 'sabotage' ? <Sabotage /> : null}
      </AbsoluteFill>
    </Frame>
  );
}
