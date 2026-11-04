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

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Sheet({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const expected = process.env.PRINT_TOKEN ?? '';
  // proxy.ts already 404s; this is the second lock for any path that skips it
  if (expected.length < 16 || first(params.token) !== expected) notFound();
  const host = (await headers()).get('host') ?? 'localhost';
  const scheme = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  const requested = Number.parseInt(first(params.count) ?? '', 10);
  const all = readCards();
  const cards: PrintCard[] = (Number.isFinite(requested) && requested > 0 ? all.slice(0, requested) : all).map(
    (c) => ({
      mb: c.mb,
      ...(c.sponsor ? { sponsor: c.sponsor } : {}),
      validity: 'Mumbai · 7 days',
      pin: c.pin,
      serial: c.serial,
      expires: c.expires ?? 'Expires 30 Nov 2026',
      qrUrl: `${scheme}://${host}/card/${c.serial}`,
      sponsorPaid: c.sponsorPaid ?? '$0.50',
      networkFee: '$0.00',
    }),
  );
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
