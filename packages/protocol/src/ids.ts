/** Identifiers, networks, assets, protocol constants and logical ledger keys (INTERFACES §1.1). */
export type Hex = `0x${string}`;
export type Address = `0x${string}`;

const HEX_PATTERN = /^0x[0-9a-fA-F]*$/;
/** `0x`-prefixed hex of any (including zero) length. */
export const isHex = (value: unknown): value is Hex =>
  typeof value === 'string' && HEX_PATTERN.test(value);

export const NETWORKS = {
  anvil: 'eip155:31337',
  baseSepolia: 'eip155:84532',
  baseMainnet: 'eip155:8453',
  hederaTestnet: 'hedera:testnet',
  hederaMainnet: 'hedera:mainnet',
} as const;
export type Network = (typeof NETWORKS)[keyof typeof NETWORKS];
export const isEvmNetwork = (network: string): boolean => network.startsWith('eip155:');
export const isHederaNetwork = (network: string): boolean => network.startsWith('hedera:');
/** Networks the API may ever advertise in accepts[] while SALES_ENABLED is false (T-52). */
export const TESTNET_NETWORKS: readonly string[] = [
  NETWORKS.anvil,
  NETWORKS.baseSepolia,
  NETWORKS.hederaTestnet,
];

export const USDC_DECIMALS = 6;
/** Asset ids per network. Anvil's MockUSDC3009 comes from deploy/addresses.anvil.json at runtime. */
export const USDC_ASSET = {
  [NETWORKS.baseSepolia]: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  [NETWORKS.baseMainnet]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  [NETWORKS.hederaTestnet]: '0.0.429274', // HTS id, 6 decimals (A-20); EVM long-zero alias 0x0000000000000000000000000000000000068cDa (EIP-55; viem getAddress)
  [NETWORKS.hederaMainnet]: '0.0.456858', // HTS id, 6 decimals; EVM long-zero alias 0x000000000000000000000000000000000006f89a
} as const;
/** USDC_ASSET by any network string; undefined where no USDC is pinned (Anvil's comes from the deploy file). */
export const usdcAssetFor = (network: string): string | undefined =>
  (USDC_ASSET as Record<string, string>)[network];
/**
 * EIP-712 domain of USDC per EVM network (A-21). Circle's Base Sepolia USDC signs as name "USDC"; Ethereum, Base mainnet and
 * World Chain sign as "USD Coin"; version is "2" everywhere. The API copies this into accepts[].extra and every EVM signer takes
 * the domain from accepts[].extra — never from a literal. readDomain() cross-checks it wherever an RPC is reachable.
 */
export const USDC_EIP712_DOMAIN: Readonly<Record<string, { name: string; version: string }>> = {
  [NETWORKS.anvil]: { name: 'USD Coin', version: '2' }, // MockUSDC3009 (§6.2)
  [NETWORKS.baseSepolia]: { name: 'USDC', version: '2' }, // 0x036CbD53842c5426634e7929541eC2318f3dCF7e
  [NETWORKS.baseMainnet]: { name: 'USD Coin', version: '2' }, // Base mainnet; never advertised while SALES_ENABLED=false
};
/** Hedera transactions are valid for at most 180 s (A-20): accepts[].maxTimeoutSeconds on hedera:* never exceeds this. */
export const HEDERA_MAX_TIMEOUT_S = 180;

export const WORLD_ACTION = 'recharge-welcome';
export const AUDIENCE = 'recharge';
export const CHALLENGE_PATHS = [
  '/claim',
  '/gift/claim',
  '/gift/reclaim',
  '/card/redeem',
  '/plan/cancel',
] as const;
export type ChallengePath = (typeof CHALLENGE_PATHS)[number];

export const STEP_MB = 100;
/**
 * The product unit (founder decision, 6 Nov 2026): the smallest India eSIM the reseller sells is 1 GB / 7 days and its
 * top-ups start at 1 GB, so a new plan, a top-up and a paid gift are each exactly PLAN_MB — still priced per STEP_MB
 * (1 GB = 10 steps = $4.00 at $0.40). GET /plans publishes it (`paid.sizesMb`, `gift.sizesMb`).
 */
export const PLAN_MB = 1000;
/** A sponsor's free bundle is at most one eSIM (bundleMb.orb / .document ≤ this). */
export const MAX_BUNDLE_MB = PLAN_MB;
export const MAX_MB_PER_PURCHASE = 3000;
export const DEFAULT_VALIDITY_DAYS = 7;
export const CHALLENGE_TTL_S = 120;
/**
 * Lifetime of a consumed-nonce entity (A-37, RT-O-04): ≥ the longest acceptance window (TTL + 5 s skew guard) plus
 * margin for a fast ledger clock (block drift, T-35). 2.5 × TTL = 300 s.
 */
export const NONCE_TTL_S = 300;
export const PAYMENT_VALIDITY_S = 300;
export const WEBHOOK_WINDOW_S = 300;
export const ENTITLEMENT_CACHE_S = 60;
/** The escrow entity's expiresIn: after this the gift cannot be claimed. */
export const GIFT_CLAIM_WINDOW_S = 7 * 86_400;
/** After claimBy the sender may reclaim while the gift receipt still exists. */
export const GIFT_RECLAIM_WINDOW_S = 30 * 86_400;
/**
 * Receipts must outlive the whole gift life: claim window + reclaim window + 1 day of margin (T-71e, A-36), so a
 * reclaim on day 37 still finds its 'gift' receipt.
 */
export const RECEIPT_TTL_S = GIFT_CLAIM_WINDOW_S + GIFT_RECLAIM_WINDOW_S + 86_400;
export const AGENT_POLICY_TTL_S = 30 * 86_400;
export const KEY_VERSION = 'v1';

export const ENTITY_TYPES = [
  'entitlement',
  'campaign',
  'gift',
  'nonce',
  'receipt',
  'agentpolicy',
  /** Claim locks and settlement markers (A-33): `{ v, scope }`, key = `claim:` + an opaque hash. */
  'claim',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Annotation (Arkiv attribute) names. Never a secret, a nullifier, an ICCID, a PIN or an LPA (T-37). */
export const ANN = {
  type: 'type',
  key: 'key',
  kind: 'kind',
  status: 'status',
  tier: 'tier',
  campaignId: 'campaignId',
  sponsor: 'sponsor',
  iccidHash: 'iccidHash',
  namehash: 'namehash',
  pinKey: 'pinKey',
  serial: 'serial',
  state: 'state',
  nonce: 'nonce',
  entitlementKeyHash: 'entitlementKeyHash',
  receiptKind: 'receiptKind',
  day: 'day',
  owner: 'owner',
  expiresAt: 'expiresAt', // numeric; T-35 reads min(ledger expiry, this)
} as const;

/** Logical key prefixes (INTERFACES §9). */
export const KEY_PREFIXES = {
  entitlementFree: `ent:${KEY_VERSION}:`,
  entitlementPaid: 'paid:',
  entitlementGift: 'giftent:',
  gift: 'gift:',
  nonce: 'nonce:',
  receipt: 'rcpt:',
  campaign: 'camp:',
  agentPolicy: 'policy:',
  claim: 'claim:',
} as const;

const P = KEY_PREFIXES;
/** Logical keys. The ledger assigns its own entity key; stores index by ANN.key = one of these. */
export const keys = {
  entitlementFree: (quotaKey: Hex) => `${P.entitlementFree}${quotaKey}`,
  entitlementPaid: (payer: string, nonce: Hex) =>
    `${P.entitlementPaid}${payer.toLowerCase()}:${nonce.toLowerCase()}`,
  entitlementGift: (giftId: Hex) => `${P.entitlementGift}${giftId.toLowerCase()}`,
  gift: (giftId: Hex) => `${P.gift}${giftId.toLowerCase()}`,
  nonce: (nonce: Hex) => `${P.nonce}${nonce.toLowerCase()}`,
  receipt: (network: string, tx: string) => `${P.receipt}${network}:${tx.toLowerCase()}`,
  campaign: (id: Hex) => `${P.campaign}${id.toLowerCase()}`,
  agentPolicy: (entitlementKey: string) => `${P.agentPolicy}${entitlementKey}`,
  /** `digest` is already an opaque hash (HMAC or sha256): claim keys never carry an identifier in clear. */
  claim: (digest: Hex) => `${P.claim}${digest.toLowerCase()}`,
} as const;

/** UTC day bucket for the agent's daily cap (T-30: "day is UTC and stated"). */
export const dayBucket = (nowMs: number): number => Math.floor(nowMs / 86_400_000);
/** On-chain hour bucket mirror of DataDrop (seconds / 3600). */
export const hourBucket = (nowMs: number): number => Math.floor(nowMs / 3_600_000);
