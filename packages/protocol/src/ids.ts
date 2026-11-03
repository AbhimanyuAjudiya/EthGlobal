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
  hederaTestnet: 'hedera:testnet',
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
  [NETWORKS.hederaTestnet]: '0.0.429274', // HTS id, 6 decimals (A-20); EVM long-zero alias 0x0000000000000000000000000000000000068cDA
} as const;
/**
 * EIP-712 domain of USDC per EVM network (A-21). Circle's Base Sepolia USDC signs as name "USDC"; Ethereum, Base mainnet and
 * World Chain sign as "USD Coin"; version is "2" everywhere. The API copies this into accepts[].extra and every EVM signer takes
 * the domain from accepts[].extra — never from a literal. readDomain() cross-checks it wherever an RPC is reachable.
 */
export const USDC_EIP712_DOMAIN: Readonly<Record<string, { name: string; version: string }>> = {
  [NETWORKS.anvil]: { name: 'USD Coin', version: '2' }, // MockUSDC3009 (§6.2)
  [NETWORKS.baseSepolia]: { name: 'USDC', version: '2' }, // 0x036CbD53842c5426634e7929541eC2318f3dCF7e
  'eip155:8453': { name: 'USD Coin', version: '2' }, // Base mainnet; never advertised while SALES_ENABLED=false
};
/** Hedera transactions are valid for at most 180 s (A-20): accepts[].maxTimeoutSeconds on hedera:* never exceeds this. */
export const HEDERA_MAX_TIMEOUT_S = 180;

export const WORLD_ACTION = 'recharge-welcome';
export const AUDIENCE = 'recharge';
export const CHALLENGE_PATHS = ['/claim', '/gift/claim', '/gift/reclaim', '/card/redeem'] as const;
export type ChallengePath = (typeof CHALLENGE_PATHS)[number];

export const STEP_MB = 100;
export const MAX_BUNDLE_MB = 300;
export const MAX_MB_PER_PURCHASE = 3000;
export const DEFAULT_VALIDITY_DAYS = 7;
export const CHALLENGE_TTL_S = 120;
export const PAYMENT_VALIDITY_S = 300;
export const WEBHOOK_WINDOW_S = 300;
export const ENTITLEMENT_CACHE_S = 60;
/** The escrow entity's expiresIn: after this the gift cannot be claimed. */
export const GIFT_CLAIM_WINDOW_S = 7 * 86_400;
/** After claimBy the sender may reclaim while the gift receipt still exists. */
export const GIFT_RECLAIM_WINDOW_S = 30 * 86_400;
export const RECEIPT_TTL_S = 30 * 86_400;
export const AGENT_POLICY_TTL_S = 30 * 86_400;
export const KEY_VERSION = 'v1';

export const ENTITY_TYPES = [
  'entitlement',
  'campaign',
  'gift',
  'nonce',
  'receipt',
  'agentpolicy',
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
} as const;

/** UTC day bucket for the agent's daily cap (T-30: "day is UTC and stated"). */
export const dayBucket = (nowMs: number): number => Math.floor(nowMs / 86_400_000);
/** On-chain hour bucket mirror of DataDrop (seconds / 3600). */
export const hourBucket = (nowMs: number): number => Math.floor(nowMs / 3_600_000);
