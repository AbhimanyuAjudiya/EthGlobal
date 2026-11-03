/**
 * RENDERED fallback for Video 01 S4 (SCRIPTS.md §2 "Rendered shots"): the issuing rows of /plan/[key]
 * turning tertiary → primary, the odometer 0 → 300 once, the meter once, then static.
 * Timeline (frames relative to the shot): Verified f0 → Sponsor paid f24 → Arkiv f48 → odometer f60–f72 →
 * meter f63–f72. Colour changes are cross-fades of two text layers (opacity only).
 * Mirrors the presentational PlanView; wave 3 swaps this for the real `PlanView` once apps/web ships it.
 */
import { type ReactNode } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

import { TestnetStrip } from '../components/TestnetStrip';
import { type EntitlementSeed } from '../seed';
import { ease, frames, v } from '../theme';
import { MbMeter, UsageAsOf } from './MbMeter';
import { Odometer } from './Odometer';

export const ISSUING_TIMELINE = { verified: 0, sponsor: 24, arkiv: 48, odometer: 60, meter: 63 };

function Row({ at, children }: { at: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const on = interpolate(frame, [at, at + frames.state], [0, 1], {
    easing: ease.standard,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const line = (color: string, opacity: number) => (
    <div style={{ position: 'absolute', inset: 0, color, opacity }}>{children}</div>
  );
  return (
    <div
      style={{
        position: 'relative',
        height: 28,
        fontSize: 14,
        lineHeight: '28px',
        borderBottom: `1px solid ${v.borderSubtle}`,
      }}
    >
      {line(v.textTertiary, 1 - on)}
      {line(v.text, on)}
    </div>
  );
}

export function IssuingSequence({
  entitlement,
  claimTx,
  sponsorName,
}: {
  entitlement: EntitlementSeed;
  claimTx: string;
  sponsorName: string;
}) {
  const t = ISSUING_TIMELINE;
  const remaining = (entitlement.mbTotal - entitlement.mbUsed) / entitlement.mbTotal;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 54 }} />
      <TestnetStrip />
      <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', gap: 0 }}>
        <Row at={t.verified}>Verified</Row>
        <Row at={t.sponsor}>
          Sponsor paid · <span className="mono">{claimTx}</span> ↗ HashScan
        </Row>
        <Row at={t.arkiv}>
          Plan written to Arkiv · <span className="mono">{entitlement.key}</span>
        </Row>
      </div>
      <div style={{ padding: '36px 20px 0' }}>
        <div
          style={{
            fontSize: 64,
            lineHeight: 1,
            fontVariationSettings: "'wdth' 110, 'wght' 700",
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
          }}
        >
          <Odometer value={entitlement.mbTotal} from={t.odometer} fontSize={64} />
          <span style={{ fontSize: 24 }}>MB</span>
        </div>
        <div style={{ marginTop: 8, fontSize: 14, color: v.textSecondary }}>
          from {sponsorName} · because you&rsquo;re human
        </div>
        <div style={{ marginTop: 20 }}>
          <MbMeter toFraction={remaining} start={t.meter} />
        </div>
        <div style={{ marginTop: 8 }}>
          <UsageAsOf time={entitlement.usageAsOf} />
        </div>
        <div style={{ marginTop: 16, fontSize: 14 }}>
          Expires in <span className="mono">{entitlement.expiresIn}</span> · {entitlement.expiresAt}
        </div>
      </div>
    </div>
  );
}
