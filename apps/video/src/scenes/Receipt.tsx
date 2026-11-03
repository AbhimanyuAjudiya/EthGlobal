/**
 * The three-line receipt (DECISION §8.2): header, You / Sponsor / Network fee on ruled lines, and a
 * disclosure row of hash · HCS sequence · Arkiv key. State words come from @ethglobal/ui's
 * onchainActionStates vocabulary (`finalized` reads "Final"). Enters once — translateY 24 → 0 and opacity
 * over 8 frames, --ease-standard — then is still. CSS px; sits inside UiScreen.
 */
import { type OnchainActionState } from '@ethglobal/ui';
import { interpolate, useCurrentFrame } from 'remotion';

import { ease, frames, v } from '../theme';

export const STATE_LABEL: Record<OnchainActionState, string> = {
  idle: 'Review',
  signing: 'Approve in wallet',
  submitted: 'Sending',
  pending: 'Sending',
  confirmed: 'Confirmed',
  finalized: 'Final',
  failed: 'Failed',
  replaced: 'Replaced',
};

export interface ReceiptProps {
  mb: number;
  /** Header date, e.g. "Sat 7 Nov 03:12". */
  when: string;
  rail: string;
  state: OnchainActionState;
  you: string;
  sponsor: string;
  fee: string;
  hash: string;
  hcsSequence: number | string;
  arkivKey: string;
  /** Frame the card enters, relative to the enclosing Sequence. */
  enterAt?: number;
}

/** Card entry used by every rendered card: translateY 24 → 0 plus opacity, 260 ms, standard easing. */
export function useEntry(enterAt = 0): { opacity: number; transform: string } {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [enterAt, enterAt + frames.spatialIn], [0, 1], {
    easing: ease.standard,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return { opacity: t, transform: `translateY(${(1 - t) * 24}px)` };
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '10px 0',
        borderBottom: `1px solid ${v.borderSubtle}`,
        fontSize: 16,
      }}
    >
      <span>{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}

export function Receipt({ enterAt = 0, ...r }: ReceiptProps) {
  const entry = useEntry(enterAt);
  return (
    <div
      style={{
        ...entry,
        background: v.surface,
        border: `1px solid ${v.borderSubtle}`,
        borderRadius: 4,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 14, fontVariationSettings: "'wdth' 100, 'wght' 600" }}>
        <span className="mono">+{r.mb}</span> MB · {r.when} · {r.rail} · {STATE_LABEL[r.state]}
      </div>
      <div style={{ marginTop: 8, borderTop: `1px solid ${v.borderSubtle}` }}>
        <Line label="You" value={r.you} />
        <Line label="Sponsor" value={r.sponsor} />
        <Line label="Network fee" value={r.fee} />
      </div>
      <div
        className="mono"
        style={{ marginTop: 12, fontSize: 11, color: v.textSecondary, lineHeight: 1.5 }}
      >
        {r.hash} · HCS seq {r.hcsSequence} · {r.arkivKey}
      </div>
    </div>
  );
}
