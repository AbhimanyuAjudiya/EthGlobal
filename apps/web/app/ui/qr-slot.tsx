import type { CouponQrSlot } from '@ethglobal/ui/components';

/**
 * Gallery stand-in for the QR render prop: a labelled keyline where the app's encoder draws the code.
 * ui ships no encoder on purpose; this is visibly a slot, not a fake code.
 */
export function QrSlot({ url, label }: CouponQrSlot) {
  return (
    <svg viewBox="0 0 22 22" role="img" aria-label={label} data-qr-url={url}>
      <rect
        x="0.5"
        y="0.5"
        width="21"
        height="21"
        fill="none"
        stroke="var(--text-tertiary)"
        strokeWidth="0.3"
        strokeDasharray="1 0.8"
      />
      <text
        x="11"
        y="12.2"
        textAnchor="middle"
        fontSize="3"
        fill="var(--text-tertiary)"
        fontFamily="var(--font-mono)"
      >
        QR slot
      </text>
    </svg>
  );
}

export const renderQrSlot = (slot: CouponQrSlot) => <QrSlot {...slot} />;
