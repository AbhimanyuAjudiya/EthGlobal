import { encode } from 'uqr';

import type { CouponQrSlot } from '@ethglobal/ui/components';

/**
 * A real QR code (uqr, ECC M) drawn as one SVG path in currentColor — the encoder ui leaves to the app.
 * The quiet zone is part of the viewBox so it prints at 22 × 22 mm without clipping.
 */
export function QrCode({ url, label, sizeMm }: CouponQrSlot) {
  const qr = encode(url, { ecc: 'M', border: 2 });
  let d = '';
  qr.data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    <svg
      className="qr-code"
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      role="img"
      aria-label={label}
      data-qr-url={url}
      shapeRendering="crispEdges"
      style={{ width: `${sizeMm}mm`, height: `${sizeMm}mm` }}
    >
      <rect width={qr.size} height={qr.size} fill="var(--qr-paper, white)" />
      <path d={d} fill="var(--qr-ink, black)" />
    </svg>
  );
}

export const renderQr = (slot: CouponQrSlot) => <QrCode {...slot} />;
