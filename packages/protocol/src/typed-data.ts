/**
 * The EIP-712 messages the API verifies (INTERFACES §1.12). Protocol only defines them: the web signs
 * with these objects and the API verifies with viem `verifyTypedData` against the same objects. Token
 * (EIP-3009) typed data is not here: it lives in `@ethglobal/eip3009`, which takes the token's domain
 * `name`/`version` as parameters (Circle USDC is "USD Coin" on mainnet but "USDC" on Base Sepolia).
 */
import { AUDIENCE, type Hex } from './ids.js';

export const RECHARGE_DOMAIN_NAME = 'Recharge';
export const RECHARGE_DOMAIN_VERSION = '1';

export const rechargeDomain = (chainId: number) =>
  ({ name: RECHARGE_DOMAIN_NAME, version: RECHARGE_DOMAIN_VERSION, chainId }) as const;

export const GIFT_CLAIM_TYPES = {
  GiftClaim: [
    { name: 'giftId', type: 'bytes32' },
    { name: 'namehash', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'audience', type: 'string' },
    { name: 'nonce', type: 'bytes32' }, // challenge nonce: one-shot (T-53)
  ],
} as const;

export const GIFT_RECLAIM_TYPES = {
  GiftReclaim: [
    { name: 'giftId', type: 'bytes32' },
    { name: 'payer', type: 'address' },
    { name: 'nonce', type: 'bytes32' }, // challenge nonce: one-shot
  ],
} as const;

export const SPONSOR_LOGIN_TYPES = {
  SponsorLogin: [
    { name: 'campaignId', type: 'bytes32' },
    { name: 'sponsor', type: 'address' },
    { name: 'issuedAt', type: 'uint256' }, // ms; valid 1 h
  ],
} as const;

/** Write authorization for one exact set of private ticket passes. */
export const SPONSOR_TICKETS_TYPES = {
  SponsorTickets: [
    { name: 'campaignId', type: 'bytes32' },
    { name: 'sponsor', type: 'address' },
    { name: 'ticketsHash', type: 'bytes32' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint256' },
  ],
} as const;
export const SPONSOR_TICKETS_TTL_MS = 600_000;

/** Ticket references are opaque, case-sensitive IDs from the organizer's confirmed attendee list. */
export function canonicalTicketRefs(refs: readonly string[]): string[] {
  if (refs.length < 1 || refs.length > 200)
    throw new TypeError('Provide 1 to 200 ticket references');
  const values = refs.map((ref) => ref.normalize('NFKC').trim());
  if (
    values.some(
      (ref) =>
        ref.length < 1 ||
        ref.length > 128 ||
        Array.from(ref).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
    )
  )
    throw new TypeError('Invalid ticket reference');
  return [...new Set(values)].sort();
}

/** Browser/server-identical SHA-256; the raw ticket list is not put into an on-chain transaction. */
export async function sponsorTicketsHash(refs: readonly string[]): Promise<Hex> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalTicketRefs(refs)));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `0x${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The sponsor's WRITE credential for minting campaign-funded scratch cards (A-43, RT-P-08): a fresh signature over
 * exactly this batch. A captured SponsorLogin (the dashboard's read bearer) cannot mint; `nonce` is one-shot.
 */
export const SPONSOR_CARDS_TYPES = {
  SponsorCards: [
    { name: 'campaignId', type: 'bytes32' },
    { name: 'sponsor', type: 'address' },
    { name: 'count', type: 'uint256' },
    { name: 'mb', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' }, // random per batch; a replay is 409
    { name: 'issuedAt', type: 'uint256' }, // ms; valid 10 min
  ],
} as const;

export const AGENT_POLICY_TYPES = {
  AgentPolicy: [
    { name: 'entitlementKey', type: 'string' },
    { name: 'owner', type: 'address' },
    { name: 'policyHash', type: 'bytes32' }, // keccak256(utf8(canonicalJson(policy)))
    { name: 'issuedAt', type: 'uint256' },
  ],
} as const;

/**
 * POST /plan/cancel: the payer of an unused paid plan cancels it; the refund goes to the plan's recorded payer only.
 * `nonce` binds the signature to one consumed /plan/cancel challenge, so a captured signature is one-shot.
 */
export const CANCEL_PLAN_TYPES = {
  CancelPlan: [
    { name: 'entitlementKey', type: 'string' },
    { name: 'payer', type: 'address' },
    { name: 'nonce', type: 'bytes32' }, // challenge nonce: one-shot
    { name: 'issuedAt', type: 'uint256' }, // ms; valid PLAN_CANCEL_TTL_MS
  ],
} as const;
/** CancelPlan.issuedAt validity (ms). */
export const PLAN_CANCEL_TTL_MS = 600_000;

type NativeNetwork = 'hedera:testnet' | 'hedera:mainnet';

function nativeIdentity(network: NativeNetwork, payer: string): void {
  if (
    !['hedera:testnet', 'hedera:mainnet'].includes(network) ||
    !/^0\.0\.[1-9]\d{0,11}$/.test(payer)
  )
    throw new TypeError('invalid native Hedera identity');
}

/** SHA-256 this canonical string to obtain the payer-bound /plan/cancel challenge session key. */
export function nativePayerBinding(network: NativeNetwork, payer: string): string {
  nativeIdentity(network, payer);
  return `recharge:native-payer:v1:${network}:${payer}`;
}

/** HIP-820 signs this message; it carries a plan hash instead of the private entitlement capability. */
export function nativeCancelMessage(input: {
  network: NativeNetwork;
  payer: string;
  entitlementHash: Hex;
  nonce: Hex;
  issuedAt: number;
}): string {
  const { network, payer, entitlementHash, nonce, issuedAt } = input;
  nativeIdentity(network, payer);
  if (
    !/^0x[0-9a-fA-F]{64}$/.test(entitlementHash) ||
    !/^0x[0-9a-fA-F]{64}$/.test(nonce) ||
    !Number.isSafeInteger(issuedAt) ||
    issuedAt < 0 ||
    !Number.isSafeInteger(issuedAt + PLAN_CANCEL_TTL_MS)
  )
    throw new TypeError('invalid native cancellation message');
  return [
    'Recharge: cancel unused eSIM',
    'Version: 1',
    `Audience: ${AUDIENCE}`,
    'Action: /plan/cancel',
    `Network: ${network}`,
    `Payer: ${payer}`,
    `Plan SHA-256: ${entitlementHash.toLowerCase()}`,
    `Nonce: ${nonce.toLowerCase()}`,
    `Issued at (ms): ${issuedAt}`,
    `Expires at (ms): ${issuedAt + PLAN_CANCEL_TTL_MS}`,
    'Refund only to the original payer on the original payment network.',
  ].join('\n');
}

/** SponsorLogin.issuedAt validity (ms). */
export const SPONSOR_LOGIN_TTL_MS = 3_600_000;
/** SponsorCards.issuedAt validity (ms): a write credential lives minutes, not an hour. */
export const SPONSOR_CARDS_TTL_MS = 600_000;
/** At most this many cards per POST /sponsor/:id/cards (one print run is 200). */
export const SPONSOR_CARDS_MAX = 200;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function canonical(value: unknown, path: string): Json | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number at ${path}`);
    return value;
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol')
    return undefined;
  if (typeof value === 'bigint') {
    throw new TypeError(
      `canonicalJson: bigint at ${path}; put money on the wire as a digit string`,
    );
  }
  if (Array.isArray(value)) return value.map((item, i) => canonical(item, `${path}[${i}]`) ?? null);
  const out: Record<string, Json> = {};
  for (const key of Object.keys(value).sort()) {
    const item = canonical((value as Record<string, unknown>)[key], `${path}.${key}`);
    if (item !== undefined) out[key] = item;
  }
  return out;
}

/**
 * Sorted keys (UTF-16 code-unit order, recursively), no whitespace; the only canonicaliser. Same rules as
 * JSON.stringify for undefined (dropped in objects, null in arrays); throws on bigint and non-finite numbers.
 */
export function canonicalJson(value: unknown): string {
  const result = canonical(value, '$');
  if (result === undefined) throw new TypeError('canonicalJson: value is not serialisable');
  return JSON.stringify(result);
}
