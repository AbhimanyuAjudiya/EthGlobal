/**
 * ENSv2 campaign names (ens/README.md), read by the browser straight from Sepolia, not through our API:
 * `<slug>.re-charge.eth` resolves with plain viem `getEnsText` (viem's default Universal Resolver 0xeeee…eeee, which
 * ENS points at UniversalResolverV2) and the expiry is the UserRegistry's. A name counts only when its
 * `recharge.pool` is our DataDrop and it has not expired: anyone can point a look-alike name at any text.
 */
import {
  createPublicClient,
  encodeFunctionData,
  http,
  labelhash,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';
import { packetToBytes } from 'viem/ens';

import { ENS_SLUG_PATTERN, ENS_SPONSOR_TEXT_KEYS } from '@ethglobal/protocol/ids';

import { config } from './env';

export const ENS_CHAIN_ID = sepolia.id;
/** The same default as lib/csp.ts `connect-src`. */
export const ENS_RPC_URL =
  process.env.NEXT_PUBLIC_ENS_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
export const ENS_PARENT = process.env.NEXT_PUBLIC_ENS_PARENT ?? 're-charge.eth';
/** re-charge.eth's UserRegistry on ENSv2 Sepolia (ens/SPIKE.md). */
export const ENS_USER_REGISTRY = (process.env.NEXT_PUBLIC_ENS_USER_REGISTRY ??
  '0x297320862052B1d0e069502c0D5DE12841E2EA41') as Address;

export const ensAppUrl = (name: string): string => `https://sepolia.app.ens.domains/${name}`;
export const etherscanTx = (hash: string): string => `https://sepolia.etherscan.io/tx/${hash}`;
export const etherscanAddress = (address: string): string =>
  `https://sepolia.etherscan.io/address/${address}`;
/** ENS's own avatar service (ENSIP-12) renders the record; the only image host the CSP allows for it. */
export const ensAvatarUrl = (name: string): string =>
  `https://metadata.ens.domains/sepolia/avatar/${name}`;

/** The keys the claim page reads: Recharge's and the sponsor's. */
export const CAMPAIGN_TEXT_KEYS = [
  'recharge.campaign',
  'recharge.pool',
  'recharge.bundle',
  ...ENS_SPONSOR_TEXT_KEYS,
] as const;
export type CampaignTexts = Partial<Record<(typeof CAMPAIGN_TEXT_KEYS)[number], string>>;

const REGISTRY_ABI = parseAbi(['function getExpiry(uint256 anyId) view returns (uint64)']);
const RESOLVER_ABI = parseAbi([
  'function setText(bytes name, string key, string value)',
  'function multicall(bytes[] calls) returns (bytes[] results)',
]);

let client: ReturnType<typeof createPublicClient> | undefined;
export const ensClient = () =>
  (client ??= createPublicClient({ chain: sepolia, transport: http(ENS_RPC_URL) }));

/** The raw facts for `<slug>.<parent>`; throws when Sepolia does not answer (that is not "ended"). */
export async function readCampaignName(
  slug: string,
): Promise<{ name: string; texts: CampaignTexts; expiry: bigint }> {
  const name = `${slug}.${ENS_PARENT}`;
  if (!ENS_SLUG_PATTERN.test(slug)) return { name, texts: {}, expiry: 0n };
  const c = ensClient();
  const [expiry, ...texts] = await Promise.allSettled([
    c.readContract({
      address: ENS_USER_REGISTRY,
      abi: REGISTRY_ABI,
      functionName: 'getExpiry',
      args: [BigInt(labelhash(slug))],
    }),
    ...CAMPAIGN_TEXT_KEYS.map((key) => c.getEnsText({ name, key })),
  ]);
  if (expiry?.status === 'rejected') throw expiry.reason;
  return {
    name,
    expiry: expiry?.status === 'fulfilled' ? expiry.value : 0n,
    texts: Object.fromEntries(
      CAMPAIGN_TEXT_KEYS.flatMap((key, i) => {
        const r = texts[i];
        return r?.status === 'fulfilled' && r.value ? [[key, r.value]] : [];
      }),
    ),
  };
}

export type CampaignName =
  | {
      ok: true;
      name: string;
      campaignId: Hex;
      expiresAt: number;
      bundle?: string;
      avatar?: string;
      description?: string;
      twitter?: string;
    }
  | { ok: false; name: string; reason: 'unknown' | 'expired' | 'foreign' };

/** `eip155:<chain>:<DataDrop>`: the pool a name must point at to be ours. */
export const ourPool = (): string => `eip155:${config.chainId}:${config.dataDropAddress}`;

/** A name is a live Recharge campaign only when it points at our DataDrop and has not expired. */
export function checkCampaignName(
  facts: { name: string; texts: CampaignTexts; expiry: bigint },
  now: number,
  pool = ourPool(),
): CampaignName {
  const { name, texts, expiry } = facts;
  const id = texts['recharge.campaign'];
  if (expiry === 0n) return { ok: false, name, reason: 'unknown' };
  if (Number(expiry) * 1000 <= now) return { ok: false, name, reason: 'expired' };
  if (id === undefined) return { ok: false, name, reason: 'unknown' };
  if (!/^0x[0-9a-fA-F]{64}$/.test(id) || !/^eip155:\d+:0x[0-9a-fA-F]{40}$/.test(pool))
    return { ok: false, name, reason: 'foreign' };
  if (texts['recharge.pool']?.toLowerCase() !== pool.toLowerCase())
    return { ok: false, name, reason: 'foreign' };
  const handle = texts['com.twitter'] ? xHandle(texts['com.twitter']) : undefined;
  return {
    ok: true,
    name,
    campaignId: id as Hex,
    expiresAt: Number(expiry) * 1000,
    ...(texts['recharge.bundle'] ? { bundle: texts['recharge.bundle'].slice(0, 40) } : {}),
    ...(texts.avatar ? { avatar: texts.avatar } : {}),
    // the sponsor's own text: shown as text, clamped; the handle only when it is one
    ...(texts.description ? { description: texts.description.slice(0, 280) } : {}),
    ...(handle ? { twitter: handle } : {}),
  };
}

/** "@Acme", "x.com/acme", "https://twitter.com/acme" → "acme"; undefined when it is not a handle. */
export function xHandle(input: string): string | undefined {
  const handle = input
    .trim()
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '')
    .replace(/^(x|twitter)\.com\//i, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '');
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : undefined;
}

/**
 * The sponsor's branding edit, signed by the sponsor on Sepolia straight to its campaign's resolver: one setText,
 * or several in one `multicall` (msg.sender stays the sponsor; the resolver's EAC allows only the sponsor keys).
 */
export function brandingCall(
  resolver: Address,
  name: string,
  changes: readonly (readonly [string, string])[],
): { to: Address; data: Hex } {
  const node = toHex(packetToBytes(name));
  const calls = changes.map(([key, value]) =>
    encodeFunctionData({ abi: RESOLVER_ABI, functionName: 'setText', args: [node, key, value] }),
  );
  const [only] = calls;
  return {
    to: resolver,
    data:
      calls.length === 1 && only
        ? only
        : encodeFunctionData({ abi: RESOLVER_ABI, functionName: 'multicall', args: [calls] }),
  };
}
