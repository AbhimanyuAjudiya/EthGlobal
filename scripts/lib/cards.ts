/**
 * Pure helpers of the print run (scripts/print-cards.ts), importable by tests without starting anything.
 */
import { rechargeDomain, SPONSOR_CARDS_TYPES } from '@ethglobal/protocol/typed-data';

/** The EIP-712 JSON `cast wallet sign --data` expects (EIP712Domain spelled out, uint256 as decimal strings). */
export function sponsorCardsTypedData(m: {
  chainId: number;
  campaignId: string;
  sponsor: string;
  count: number;
  mb: number;
  nonce: string;
  issuedAt: number;
}) {
  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      ...SPONSOR_CARDS_TYPES,
    },
    primaryType: 'SponsorCards' as const,
    domain: rechargeDomain(m.chainId),
    message: {
      campaignId: m.campaignId,
      sponsor: m.sponsor,
      count: String(m.count),
      mb: String(m.mb),
      nonce: m.nonce,
      issuedAt: String(m.issuedAt),
    },
  };
}

/** The origin every printed QR encodes (`<origin>/card/<serial>`); set before the web build, which can inline it. */
export const PUBLIC_ORIGIN_VAR = 'NEXT_PUBLIC_PUBLIC_ORIGIN';

/**
 * The origin the sheet's QR codes must carry. Real cards (`--mint`, `--input`) need an https:// one before anything
 * is minted; a `--count` proof may run without it (the sheet then encodes the loopback host it was rendered on).
 */
export function qrOrigin(value: string | undefined, required: boolean): string | undefined {
  let origin: string | undefined;
  try {
    const parsed = value ? new URL(value).origin : undefined;
    origin = parsed === 'null' ? undefined : parsed;
  } catch {
    origin = undefined;
  }
  if (required && origin?.startsWith('https://') !== true)
    throw new Error(
      `${PUBLIC_ORIGIN_VAR} must be the https:// origin the cards' QR codes encode (got ${JSON.stringify(value ?? '')}): ` +
        'set it in .env, pnpm -r run build, export it, retry',
    );
  return origin;
}

/** Every QR on the rendered sheet must start with `<origin>/card/`; 127.0.0.1 there is a server that never saw it. */
export function assertQrUrls(urls: readonly string[], origin: string): void {
  const want = `${origin}/card/`;
  const bad = urls.find((url) => !url.startsWith(want));
  if (urls.length === 0 || bad !== undefined)
    throw new Error(
      `QR encodes ${bad ?? 'nothing'}, want ${want}<serial>: the apps/web server never saw ${PUBLIC_ORIGIN_VAR} ` +
        '(set it in .env, pnpm -r run build, export it, retry)',
    );
}

/** "Expires 30 Nov 2026": the mint's claimBy as a calendar day in Asia/Kolkata. */
export function expiresLabel(claimBy: number, timeZone = 'Asia/Kolkata'): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).formatToParts(claimBy);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `Expires ${part('day')} ${part('month')} ${part('year')}`;
}
