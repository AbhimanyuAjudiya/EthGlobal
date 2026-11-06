/**
 * The in-process harness (wave2-api-agent.md §0): buildDeps(MODE=local, mock rail, mock reseller) + MemoryDataDrop +
 * fakeClock + app.request(). Every request gets its own X-Forwarded-For (TRUST_PROXY=1) unless a test pins one, so
 * rate limits only bite where a test asks for them. Logs are captured for the T-50 scans.
 */
import { randomUUID } from 'node:crypto';

import { namehash } from 'viem';

import type { MockConsensusLog, MockReseller, MockTreasury } from '@ethglobal/adapters';
import {
  anvilAccounts,
  anvilKeys,
  anvilRoles,
  fakeClock,
  fixtureProof,
  T0,
  TEST_USDC,
} from '@ethglobal/adapters/testing';
import { bytesToHex, generateSessionKeypair, type SessionKeypair } from '@ethglobal/crypto';
import { PLAN_MB, type Hex } from '@ethglobal/protocol/ids';
import type {
  ChallengeWire,
  EntitledResponse,
  GiftResponse,
  PaymentRequirements,
} from '@ethglobal/protocol/schemas';
import { decodePaymentRequired, PAYMENT_SIGNATURE_HEADER } from '@ethglobal/protocol/x402';

import { storedCampaign } from './campaign.js';
import {
  addressOf,
  paymentHeader,
  scopedCampaignId,
  signGiftClaim,
  signGiftReclaim,
} from './client.js';
import { createApp } from '../../src/app.js';
import { buildDeps, type Deps, type DepsOverrides } from '../../src/deps.js';
import { createLogger } from '../../src/logger.js';
import { MemoryDataDrop } from '../doubles/datadrop.js';

export const SPONSOR = anvilAccounts[anvilRoles.sponsor];
export const SPONSOR_KEY = anvilKeys[anvilRoles.sponsor];
export const HUMAN_KEY = anvilKeys[anvilRoles.human];
export const STRANGER_KEY = anvilKeys[anvilRoles.stranger];
export const DAY = 86_400_000;
export const SECRET = `0x${'07'.repeat(32)}`;

export interface HarnessOptions {
  env?: Record<string, string>;
  overrides?: DepsOverrides;
  campaign?: { claimsPerHour?: number; budget?: bigint; paused?: boolean; expiresInMs?: number };
}

export type Harness = Awaited<ReturnType<typeof harness>>;

export async function harness(opts: HarnessOptions = {}) {
  const clock = fakeClock(T0);
  const lines: string[] = [];
  const logger = createLogger('info', { write: (line: string) => void lines.push(line) });
  const dataDrop = new MemoryDataDrop(clock.now);
  const env = {
    MODE: 'local',
    X402_FACILITATOR: 'mock',
    RESELLER: 'mock',
    TRUST_PROXY: '1',
    USDC_ADDRESS: TEST_USDC,
    OCTROI_SECRET: SECRET,
    RESELLER_PLAN_ID: 'in-1gb-7d',
    ...opts.env,
  };
  const overrides: DepsOverrides = {
    now: clock.now,
    logger,
    dataDrop,
    anvilAnswers: async () => false,
    ...opts.overrides,
  };
  const deps: Deps = await buildDeps(env, overrides);
  /**
   * A process restart: fresh deps and app (every in-process map, cache and limiter empty) over the SAME external
   * services — ledger, reseller, blobs, chain, clock — and the same STATE_FILE when the test set one.
   */
  const restart = async () => {
    const next = await buildDeps(env, { ...overrides, adapters: deps.adapters });
    if (deps.seedCampaignId) next.seedCampaignId = deps.seedCampaignId;
    return { deps: next, app: createApp(next) };
  };
  const campaignId = scopedCampaignId(SPONSOR, 1n);
  const expiresAt = T0 + (opts.campaign?.expiresInMs ?? 30 * DAY);
  dataDrop.create(campaignId, {
    sponsor: SPONSOR,
    pricePerClaim: 500_000n,
    budget: opts.campaign?.budget ?? 1_000_000_000n,
    spent: 0n,
    claimsPerHour: opts.campaign?.claimsPerHour ?? 120,
    expiresAt,
    paused: opts.campaign?.paused ?? false,
  });
  await deps.stores.campaigns.put(
    storedCampaign({
      id: campaignId,
      sponsor: SPONSOR,
      claimsPerHour: opts.campaign?.claimsPerHour ?? 120,
      contract: dataDrop.address,
      createdAt: T0,
      expiresAt,
    }),
  );
  deps.seedCampaignId = campaignId;
  const app = createApp(deps);
  let ipCounter = 0;
  const nextIp = () => `198.51.${Math.floor(++ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;

  const request = (path: string, init: RequestInit & { ip?: string; socket?: string } = {}) => {
    const { ip, socket, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', ip ?? nextIp());
    return app.request(
      path,
      { ...rest, headers },
      socket ? { incoming: { socket: { remoteAddress: socket } } } : undefined,
    );
  };
  const json = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
    method = 'POST',
  ) =>
    request(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const get = (path: string, headers: Record<string, string> = {}) => request(path, { headers });

  async function challengeFor(path: string, sessionPubKey: Hex): Promise<ChallengeWire> {
    const res = await json('/challenge', { audience: 'recharge', path, sessionPubKey });
    if (res.status !== 200) throw new Error(`challenge ${res.status}`);
    return (await res.json()) as ChallengeWire;
  }

  /** challenge → rp-context → IDKit-shaped proof → /claim, the PWA's order. */
  async function claim(
    o: {
      seed?: string;
      level?: 'orb' | 'document' | 'device';
      keys?: SessionKeypair;
      campaignId?: Hex;
      headers?: Record<string, string>;
    } = {},
  ) {
    const keys = o.keys ?? generateSessionKeypair();
    const spk = bytesToHex(keys.publicKey);
    const challenge = await challengeFor('/claim', spk);
    await json('/world/rp-context', { audience: 'recharge', path: '/claim' });
    const proof = fixtureProof(o.level ?? 'orb', challenge.signal as Hex, o.seed ?? 'human-1');
    const res = await json(
      '/claim',
      { proof, campaignId: o.campaignId ?? campaignId, challenge, sessionPubKey: spk },
      o.headers,
    );
    return { res, keys, spk, challenge, proof };
  }

  /** Reads the 402 from `res` and builds a signed PAYMENT-SIGNATURE for accepts[0] (or a tampered copy). */
  async function payFor(
    res: Response,
    o: {
      key?: Hex;
      sessionPubKey?: Hex;
      nonce?: Hex;
      mutate?: (r: PaymentRequirements) => PaymentRequirements;
      value?: string;
    } = {},
  ) {
    const required = decodePaymentRequired(res.headers.get('PAYMENT-REQUIRED') ?? '');
    const accepted = o.mutate ? o.mutate(required.accepts[0]!) : required.accepts[0]!;
    const header = await paymentHeader(o.key ?? HUMAN_KEY, accepted, {
      now: clock.now(),
      ...(o.sessionPubKey ? { sessionPubKey: o.sessionPubKey } : {}),
      ...(o.nonce ? { nonce: o.nonce } : {}),
      ...(o.value ? { value: o.value } : {}),
    });
    return { [PAYMENT_SIGNATURE_HEADER]: header };
  }

  return {
    app,
    deps,
    clock,
    dataDrop,
    lines,
    campaignId,
    restart,
    request,
    json,
    get,
    challengeFor,
    claim,
    payFor,
    reseller: deps.adapters.reseller as MockReseller,
    consensus: deps.adapters.consensus as MockConsensusLog,
    treasury: deps.adapters.treasury as MockTreasury,
    adapters: deps.adapters,
  };
}

/** The HCS messages of the deployment topic, parsed. */
export const hcsMessages = (h: Harness): { t: string; [k: string]: unknown }[] =>
  h.consensus.messages(h.deps.env.HCS_TOPIC_ID).map((m) => JSON.parse(m) as { t: string });

/** A ready free entitlement (Orb tier) for `seed`. */
export async function provisioned(h: Harness, seed = 'human-1') {
  const claim = await h.claim({ seed });
  if (claim.res.status !== 201)
    throw new Error(`claim ${claim.res.status}: ${await claim.res.text()}`);
  const body = (await claim.res.json()) as EntitledResponse;
  return {
    ...claim,
    body,
    key: body.entitlementKey,
    path: encodeURIComponent(body.entitlementKey),
  };
}

/** GET /esim/topup → 402 → pay → retry; returns both responses. */
export async function topUp(
  h: Harness,
  key: string,
  o: { mb?: number; payKey?: Hex; headers?: Record<string, string> } = {},
) {
  const path = `/esim/topup?key=${encodeURIComponent(key)}&mb=${o.mb ?? PLAN_MB}`;
  const quote = await h.get(path);
  const pay = await h.payFor(quote, { key: o.payKey ?? HUMAN_KEY });
  const paid = await h.get(path, { ...pay, ...o.headers });
  return { quote, pay, paid, path };
}

/** POST /gift → 402 → pay → 201. */
export async function buyGift(
  h: Harness,
  name = 'bob.eth',
  mb = PLAN_MB,
  headers: Record<string, string> = {},
) {
  headers = { 'idempotency-key': randomUUID(), ...headers };
  const quote = await h.json('/gift', { name, mb }, headers);
  const res = await h.json('/gift', { name, mb }, { ...(await h.payFor(quote)), ...headers });
  if (res.status !== 201) throw new Error(`gift ${res.status}: ${await res.text()}`);
  return (await res.json()) as GiftResponse;
}

/** The /gift/reclaim challenge "session key" is the payer address padded to 32 bytes. */
export const payerSessionKey = (payer: string): Hex =>
  `0x${payer.slice(2).toLowerCase().padStart(64, '0')}`;

export async function reclaimGift(
  h: Harness,
  giftId: string,
  key: Hex = HUMAN_KEY,
  o: { payer?: string; signFor?: string } = {},
) {
  const payer = o.payer ?? addressOf(key);
  const challenge = await h.challengeFor('/gift/reclaim', payerSessionKey(payer));
  const signature = await signGiftReclaim(key, h.deps.chainId, {
    giftId: (o.signFor ?? giftId) as Hex,
    nonce: challenge.nonce as Hex,
  });
  return h.json('/gift/reclaim', { giftId, payer, signature, challenge });
}

/** POST /gift/claim by signature of `key` for a gift to `name`. */
export async function claimGiftBySignature(h: Harness, giftId: string, key: Hex, name = 'bob.eth') {
  const spk = bytesToHex(generateSessionKeypair().publicKey);
  const challenge = await h.challengeFor('/gift/claim', spk);
  const signature = await signGiftClaim(key, h.deps.chainId, {
    giftId: giftId as Hex,
    namehash: namehash(name),
    nonce: challenge.nonce as Hex,
  });
  return h.json('/gift/claim', {
    giftId,
    signature,
    recipient: addressOf(key),
    challenge,
    sessionPubKey: spk,
  });
}

/** POST /card/redeem (or the PIN path of /gift/claim) with a fresh session key. */
export async function redeemPin(
  h: Harness,
  pin: string,
  path: '/card/redeem' | '/gift/claim' = '/card/redeem',
  ip?: string,
) {
  const spk = bytesToHex(generateSessionKeypair().publicKey);
  const challenge = await h.challengeFor(path, spk);
  return h.request(path, {
    method: 'POST',
    ...(ip === undefined ? {} : { ip }),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin, challenge, sessionPubKey: spk }),
  });
}

/** A local seed card (X-Seed-Card-Campaign). */
export async function seedCard(
  h: Harness,
  mb = 300,
): Promise<{ giftId: string; serial: string; pin: string; claimBy: number }> {
  const res = await h.json('/gift', { name: 'card', mb }, { 'x-seed-card-campaign': h.campaignId });
  if (res.status !== 201) throw new Error(`seed card ${res.status}`);
  return (await res.json()) as { giftId: string; serial: string; pin: string; claimBy: number };
}

/** A mock-signed webhook for `iccid` (MockReseller.signedWebhook) and its delivery. */
export function webhook(
  h: Harness,
  iccid: string,
  usedMb: number,
  o: { at?: number; totalMb?: number } = {},
) {
  const at = o.at ?? h.clock.now();
  const delivery = h.reseller.signedWebhook(
    [
      {
        provider: 'mock',
        eventId: `ev-${usedMb}-${at}`,
        iccid,
        usedMb,
        totalMb: o.totalMb ?? 300,
        asOf: at,
      },
    ],
    at,
  );
  const send = (d = delivery) =>
    h.request('/webhooks/reseller/mock', { method: 'POST', headers: d.headers, body: d.body });
  return { delivery, send };
}

export const iccidOf = (h: Harness, key: string): string => {
  const order = h.reseller.orders().find((o) => o.idempotencyKey === key);
  if (!order) throw new Error(`no order for ${key}`);
  return order.profile.iccid;
};

export const errorOf = async (res: Response): Promise<string> =>
  ((await res.clone().json()) as { error: string }).error;

/** [status, details.reason] of an error response (reclaim verdicts). */
export const reasonOf = async (res: Response): Promise<[number, string | undefined]> => [
  res.status,
  ((await res.clone().json()) as { details?: { reason?: string } }).details?.reason,
];

/** GET /esim/provision → 402 → a payment bound to a fresh session key (unless `bind: false`) → the response. */
export async function provisionPaid(h: Harness, o: { mb?: number; bind?: boolean } = {}) {
  const keys = generateSessionKeypair();
  const spk = bytesToHex(keys.publicKey);
  const url = `/esim/provision?mb=${o.mb ?? PLAN_MB}`;
  const quote = await h.get(url, { 'x-session-pubkey': spk });
  const pay = await h.payFor(quote, o.bind === false ? {} : { sessionPubKey: spk });
  const res = await h.get(url, { 'x-session-pubkey': spk, ...pay });
  return { res, quote, keys, spk };
}
