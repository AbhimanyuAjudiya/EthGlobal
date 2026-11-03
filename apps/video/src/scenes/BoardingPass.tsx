/**
 * The gift as a boarding pass addressed to a name (DECISION §8.7 `/gift`; SCRIPTS.md §5 S3). Landscape card,
 * a perforation, 11 px labels, and a stub with the PIN in 4 × 4 Chivo Mono and the QR of /card/<serial>.
 * Paper-light in both themes. CSS px; sits inside UiScreen. The size is the frame's one accent.
 */
import { type CSSProperties } from 'react';

import { type PassSeed } from '../seed';
import { v } from '../theme';

import { Qr } from './Qr';
import { useEntry } from './Receipt';

const label: CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.04em',
  color: v.textTertiary,
  fontVariationSettings: "'wdth' 100, 'wght' 600",
};
const value: CSSProperties = {
  fontSize: 15,
  fontVariationSettings: "'wdth' 100, 'wght' 600",
  color: v.text,
};

function Field({ name, children }: { name: string; children: string }) {
  return (
    <div>
      <div style={label}>{name}</div>
      <div style={value}>{children}</div>
    </div>
  );
}

const NOTCH = 12;

export function BoardingPass({ pass, enterAt = 0 }: { pass: PassSeed; enterAt?: number }) {
  const entry = useEntry(enterAt);
  return (
    <div
      style={{
        ...entry,
        colorScheme: 'light',
        position: 'relative',
        display: 'flex',
        background: v.surface,
        border: `1px solid ${v.borderSubtle}`,
        borderRadius: 6,
        color: v.text,
      }}
    >
      <div
        style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Field name="TO">{pass.to}</Field>
          <div style={{ textAlign: 'right' }}>
            <div style={label}>SIZE</div>
            <div
              style={{
                fontSize: 26,
                lineHeight: 1,
                color: v.accent,
                fontVariationSettings: "'wdth' 110, 'wght' 700",
              }}
              className="num"
            >
              {pass.size}
            </div>
          </div>
        </div>
        <Field name="FROM">{pass.from}</Field>
        <div style={{ display: 'flex', gap: 18 }}>
          <Field name="CITY">{pass.city}</Field>
          <Field name="VALID UNTIL">{pass.validUntil}</Field>
        </div>
      </div>
      {/* Perforation: a dashed rule with two notches cut from the canvas colour. */}
      <div style={{ position: 'relative', width: 0, borderLeft: `1px dashed ${v.borderStrong}` }}>
        {[-NOTCH / 2, undefined].map((top, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: -NOTCH / 2 - 0.5,
              ...(top === undefined ? { bottom: -NOTCH / 2 } : { top }),
              width: NOTCH,
              height: NOTCH,
              borderRadius: NOTCH,
              background: v.canvas,
              border: `1px solid ${v.borderSubtle}`,
            }}
          />
        ))}
      </div>
      <div
        style={{
          width: 108,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Qr data={pass.cardUrl} size={72} />
        <div className="mono" style={{ fontSize: 11, lineHeight: 1.4, textAlign: 'center' }}>
          {pass.pinGroups[0]} {pass.pinGroups[1]}
          <br />
          {pass.pinGroups[2]} {pass.pinGroups[3]}
        </div>
        <div className="mono" style={{ fontSize: 9, color: v.textTertiary }}>
          {pass.serial}
        </div>
      </div>
    </div>
  );
}
