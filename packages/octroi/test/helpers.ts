/**
 * Shared fixtures for the octroi suites. Builds OctroiDeps from the local adapter bundle with
 * `expectSignal: true`; payload builders and the clock come from `@ethglobal/adapters/testing` (never copied).
 */
import { createAdapters, type Ledger, type Personhood } from '@ethglobal/adapters';
import {
  anvilAccounts,
  anvilRoles,
  fakeClock,
  fixtureProof,
  T0,
  TEST_USDC,
} from '@ethglobal/adapters/testing';
import { keccak256 } from '@ethglobal/crypto';
import {
  hourBucket,
  NETWORKS,
  USDC_ASSET,
  USDC_EIP712_DOMAIN,
  WORLD_ACTION,
  type Hex,
} from '@ethglobal/protocol/ids';
import type { AcceptTemplate, Entitlement, Gift, Receipt } from '@ethglobal/protocol/schemas';

import {
  challenge,
  type Campaign,
  type CampaignCounters,
  type Challenge,
  type DecideRequest,
  type OctroiDeps,
} from '../src/index.js';

export const SECRET = new Uint8Array(32).fill(7);
export const OTHER_SECRET = new Uint8Array(32).fill(9);
export const SPK: Hex = `0x${'5a'.repeat(32)}`;
export const OTHER_SPK: Hex = `0x${'6b'.repeat(32)}`;
export const CAMPAIGN_ID: Hex = `0x${'ab'.repeat(32)}`;
export const NULLIFIER: Hex = `0x${'c3'.repeat(32)}`;
export const H: Hex = `0x${'11'.repeat(32)}`;
export { T0 };

export const resource = {
  url: 'http://127.0.0.1:8787/claim',
  description: 'welcome bundle',
  mimeType: 'application/json',
};

export const EVM_TEMPLATE: AcceptTemplate = {
  scheme: 'exact',
  network: NETWORKS.anvil,
  asset: TEST_USDC,
  payTo: anvilAccounts[anvilRoles.payout],
  maxTimeoutSeconds: 300,
  extra: { ...USDC_EIP712_DOMAIN[NETWORKS.anvil] },
};
export const HEDERA_TEMPLATE: AcceptTemplate = {
  scheme: 'exact',
  network: NETWORKS.hederaTestnet,
  asset: USDC_ASSET[NETWORKS.hederaTestnet],
  payTo: '0.0.12345',
  maxTimeoutSeconds: 180,
  extra: { feePayer: '0.0.9185802' },
};

export const campaign = (over: Partial<Campaign> = {}): Campaign => ({
  id: CAMPAIGN_ID,
  sponsor: anvilAccounts[3],
  name: 'Demo sponsor',
  bundleMb: { orb: 300, document: 300, device: 0 },
  pricePerClaimUsd6: 500_000n,
  maxClaims: 1000,
  claimsPerHour: 5,
  validityDays: 7,
  wholesaleUsd6PerGb: 1_140_000n,
  idResaleUsd6: 500_000n,
  planId: 'in-1gb-7d',
  network: NETWORKS.anvil,
  contract: anvilAccounts[9],
  createdAt: T0,
  expiresAt: T0 + 7 * 86_400_000,
  ...over,
});

export const counters = (over: Partial<CampaignCounters> = {}): CampaignCounters => ({
  paused: false,
  budgetUsd6: 500_000_000n,
  spentUsd6: 0n,
  claimsThisHour: 0,
  hourBucket: hourBucket(T0),
  claimed: false,
  ...over,
});

export type TestDeps = OctroiDeps & { clock: ReturnType<typeof fakeClock> };

export function deps(over: Partial<OctroiDeps> = {}, clock = fakeClock()): TestDeps {
  const a = createAdapters('local', { now: clock.now, personhood: { expectSignal: true } });
  return {
    ledger: a.ledger,
    personhood: a.personhood,
    payments: a.payments,
    secret: SECRET,
    now: clock.now,
    action: WORLD_ACTION,
    priceUsd6PerStep: 400_000n,
    stepMb: 100,
    maxMbPerPurchase: 3000,
    validityDays: 7,
    accepts: [EVM_TEMPLATE, HEDERA_TEMPLATE],
    keccak256,
    ...over,
    clock,
  };
}

export const claimChallenge = (d: Pick<OctroiDeps, 'now'>, spk: Hex = SPK): Challenge =>
  challenge('recharge', '/claim', spk, d.now(), SECRET);

/** Request overrides; an explicit `undefined` removes the field. */
export type ReqOver = { [K in keyof DecideRequest]?: DecideRequest[K] | undefined };

/** A complete free-lane request for an orb proof bound to `ch`. */
export function freeReq(d: TestDeps, over: ReqOver = {}, seed = 'fixture'): DecideRequest {
  const ch = over.challenge ?? claimChallenge(d);
  const merged = {
    resource,
    mb: 0,
    proof: fixtureProof('orb', ch.signal, seed),
    challenge: ch,
    sessionPubKey: SPK,
    campaign: campaign(),
    counters: counters(),
    existingEntitlement: null,
    ...over,
  };
  return Object.fromEntries(
    Object.entries(merged).filter(([, v]) => v !== undefined),
  ) as unknown as DecideRequest;
}

/** A verifier that accepts anything as `level` for `nullifierHash` (the permissive World action, O1). */
export const permissive = (
  level: 'orb' | 'device' = 'orb',
  nullifierHash = NULLIFIER,
): Personhood => ({
  verify: async () => ({ nullifierHash, level }),
});

/**
 * A ledger with some methods replaced, the rest delegated. (Object.create(base) does not work:
 * InMemoryLedger keeps its state in #private fields, which an inheriting object does not have.)
 */
export function ledgerWith(base: Ledger, methods: Partial<Ledger>): Ledger {
  return {
    put: (input) => base.put(input),
    get: (key) => base.get(key),
    query: (query) => base.query(query),
    update: (key, patch, expiresIn) => base.update(key, patch, expiresIn),
    ...methods,
  };
}
export const failing = async (): Promise<never> => {
  throw new Error('arkiv rpc down');
};

export const entitlement = (over: Partial<Entitlement> = {}): Entitlement => ({
  v: 1,
  key: 'ent:v1:x',
  kind: 'free',
  status: 'ready',
  tier: 'orb',
  planId: 'p',
  mbTotal: 300,
  mbUsed: 250,
  usageAsOf: T0,
  usageSource: 'webhook',
  createdAt: T0,
  expiresAt: T0 + 3 * 86_400_000,
  ...over,
});

export const GIFT_ID: Hex = `0x${'9f'.repeat(32)}`;
export const gift = (over: Partial<Gift> = {}): Gift => ({
  v: 1,
  giftId: GIFT_ID,
  kind: 'gift',
  state: 'open',
  namehash: `0x${'4e'.repeat(32)}`,
  to: anvilAccounts[6],
  mb: 1000,
  validityDays: 7,
  pinKey: `0x${'7c'.repeat(32)}`,
  serial: GIFT_ID.slice(2, 10),
  fundedBy: 'payment',
  payer: anvilAccounts[5],
  usd6: '4000000',
  network: NETWORKS.anvil,
  createdAt: T0,
  claimBy: T0 + 7 * 86_400_000,
  ...over,
});

export const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  v: 1,
  key: 'rcpt:eip155:31337:0xabc',
  kind: 'gift',
  entitlementKeyHash: H,
  mb: 1000,
  usd6: '4000000',
  network: NETWORKS.anvil,
  tx: '0xabc',
  payer: anvilAccounts[5],
  at: T0,
  ...over,
});

/** Writes an entity straight to the ledger, bypassing the stores: a forgery or a corruption under test. */
export const forge = (
  ledger: Ledger,
  annotations: Record<string, string | number>,
  payload: unknown,
  expiresIn?: number,
) =>
  ledger.put({
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    annotations,
    ...(expiresIn === undefined ? {} : { expiresIn }),
  });
