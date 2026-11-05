import { readFileSync } from 'node:fs';

import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod';

import { isValidPin } from '@ethglobal/protocol/pin';
import { PrintSheet, type PrintCard } from '@ethglobal/ui/components';

import { renderQr } from '../../../components/QrCode';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The one-time server-side file scripts/print-cards.ts writes (PRINT_CARDS_FILE); PINs never come from a route. */
const cardsFileSchema = z
  .array(
    z.object({
      serial: z.string().regex(/^[0-9a-f]{8}$/),
      pin: z.string().regex(/^\d{16}$/),
      mb: z.number().int().positive(),
      sponsor: z.string().max(64).optional(),
      expires: z.string().max(40).optional(),
      /** "Mumbai · 14 days" from the campaign; omitted rather than guessed (RT-W-09). */
      validity: z.string().max(40).optional(),
      sponsorPaid: z.string().max(16).optional(),
    }),
  )
  .max(1000);

function readCards(): z.infer<typeof cardsFileSchema> {
  const file = process.env.PRINT_CARDS_FILE;
  if (!file) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    const list = Array.isArray(parsed) ? parsed : (parsed as { cards?: unknown }).cards;
    return cardsFileSchema.parse(list).filter((c) => isValidPin(c.pin));
  } catch {
    return [];
  }
}

/**
 * The origin the printed QR encodes (`<origin>/card/<serial>`): NEXT_PUBLIC_PUBLIC_ORIGIN, the public host the
 * cards are handed out for. Only MODE=local falls back to the request host (a local print run encodes 127.0.0.1).
 */
async function printOrigin(): Promise<string | undefined> {
  const configured = process.env.NEXT_PUBLIC_PUBLIC_ORIGIN;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      return undefined;
    }
  }
  if (process.env.NEXT_PUBLIC_MODE !== 'local') return undefined;
  const host = (await headers()).get('host') ?? 'localhost';
  return `${host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'}://${host}`;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Sheet({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const expected = process.env.PRINT_TOKEN ?? '';
  // proxy.ts already 404s; this is the second lock for any path that skips it
  if (expected.length < 16 || first(params.token) !== expected) notFound();
  const origin = await printOrigin();
  if (!origin)
    return (
      <p className="print-chrome">
        Set NEXT_PUBLIC_PUBLIC_ORIGIN: the QR must point at the public host.
      </p>
    );
  const requested = Number.parseInt(first(params.count) ?? '', 10);
  const all = readCards();
  const cards: PrintCard[] = (
    Number.isFinite(requested) && requested > 0 ? all.slice(0, requested) : all
  ).map((c) => ({
    mb: c.mb,
    ...(c.sponsor ? { sponsor: c.sponsor } : {}),
    ...(c.validity ? { validity: c.validity } : {}),
    pin: c.pin,
    serial: c.serial,
    // expiry and price come from the minted batch (print-cards.ts); nothing is guessed on a real card
    ...(c.expires ? { expires: c.expires } : {}),
    qrUrl: `${origin}/card/${c.serial}`,
    ...(c.sponsorPaid ? { sponsorPaid: c.sponsorPaid } : {}),
    networkFee: '$0.00',
  }));
  if (cards.length === 0) return <p className="print-chrome">No cards in PRINT_CARDS_FILE.</p>;
  return (
    <>
      <PrintSheet cards={cards} side="front" layout="single" renderQr={renderQr} />
      <PrintSheet cards={cards.slice(0, 1)} side="keyline" layout="single" />
    </>
  );
}

/** `/print/cards?token=&count=` — N coupon pages (91.6 × 59.98 mm, bleed included) + 1 keyline page. */
export default function PrintCards({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={null}>
      <Sheet searchParams={searchParams} />
    </Suspense>
  );
}
