/** A real, scannable QR of the card URL as crisp SVG modules (no raster, no decoration). */
import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

import { v } from '../theme';

export function Qr({ data, size }: { data: string; size: number }) {
  const { count, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(data);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
    return { count: n, path: d };
  }, [data]);
  const quiet = 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${count + quiet * 2} ${count + quiet * 2}`}
      shapeRendering="crispEdges"
      style={{ display: 'block', background: v.surface }}
      aria-label={data}
    >
      <path d={path} fill={v.text} />
    </svg>
  );
}
