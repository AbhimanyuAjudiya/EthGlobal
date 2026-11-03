/**
 * The EIP-712 messages the API verifies (INTERFACES §1.12). Protocol only defines them: the web signs
 * with these objects and the API verifies with viem `verifyTypedData` against the same objects. Token
 * (EIP-3009) typed data is not here: it lives in `@ethglobal/eip3009`, which takes the token's domain
 * `name`/`version` as parameters (Circle USDC is "USD Coin" on mainnet but "USDC" on Base Sepolia).
 */

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

export const AGENT_POLICY_TYPES = {
  AgentPolicy: [
    { name: 'entitlementKey', type: 'string' },
    { name: 'owner', type: 'address' },
    { name: 'policyHash', type: 'bytes32' }, // keccak256(utf8(canonicalJson(policy)))
    { name: 'issuedAt', type: 'uint256' },
  ],
} as const;

/** SponsorLogin.issuedAt validity (ms). */
export const SPONSOR_LOGIN_TTL_MS = 3_600_000;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function canonical(value: unknown, path: string): Json | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number at ${path}`);
    return value;
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (typeof value === 'bigint') {
    throw new TypeError(`canonicalJson: bigint at ${path}; put money on the wire as a digit string`);
  }
  if (Array.isArray(value)) return value.map((item, i) => canonical(item, `${path}[${i}]`) ?? null);
  const out: Record<string, Json> = {};
  for (const key of Object.keys(value as object).sort()) {
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
