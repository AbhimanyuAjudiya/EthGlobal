import { Suspense } from 'react';

import {
  PrintSheet,
  type PrintCard,
  type PrintLayout,
  type PrintSide,
} from '@ethglobal/ui/components';

import { HOST, PINS, serialFor } from '../fixtures';
import { renderQrSlot } from '../qr-slot';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function cardsFor(count: number): PrintCard[] {
  return Array.from({ length: count }, (_, index) => {
    const serial = serialFor(index);
    return {
      mb: 300,
      sponsor: 'Hedera',
      validity: 'Mumbai · 7 days',
      pin: PINS[index % PINS.length] ?? PINS[0],
      serial,
      expires: 'Expires 30 Nov 2026',
      qrUrl: `${HOST}/card/${serial}`,
      sponsorPaid: '$0.50',
      networkFee: '$0.00',
    };
  });
}

async function Sheet({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const requested = Number.parseInt(first(params.count) ?? '10', 10);
  const count = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), PINS.length) : 10;
  const side: PrintSide =
    first(params.side) === 'back' ? 'back' : first(params.side) === 'keyline' ? 'keyline' : 'front';
  const layout: PrintLayout = first(params.layout) === 'single' ? 'single' : 'a4';
  return (
    <>
      <p className="print-chrome m-0 px-4 py-2 font-mono text-12 text-ink-tertiary">
        TOOLING · print sheet · {count} cards · {side} ·{' '}
        {layout === 'a4' ? '10 per A4' : '91.6 × 59.98 mm'} · demo PINs, not redeemable
      </p>
      <PrintSheet cards={cardsFor(count)} side={side} layout={layout} renderQr={renderQrSlot} />
    </>
  );
}

/** /ui/print?count=10&side=front|back|keyline&layout=a4|single — tooling for print.css and the PDF test. */
export default function PrintRoute({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={null}>
      <Sheet searchParams={searchParams} />
    </Suspense>
  );
}
